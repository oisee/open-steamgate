// Import committed ABAP intent into the operations store. The source query
// uses a separate SQLite reader so an unfinished caller LUW is invisible.
// The ledger in BatchRuns makes an import-before-ack crash safe to retry.
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {exclusive, currentStepToken} from "./osd-dialog-step.mjs";
import {identity} from "./osd-identity.mjs";
import {jobInputJson} from "./osd-job-input.mjs";
import {scheduleOfOutbox} from "./osd-job-schedule.mjs";

const value = (row, field) => String(row[field] ?? row[field.toUpperCase()] ?? "").trim();
const sql = (text) => `'${String(text).replaceAll("'", "''")}'`;

export async function drainJobOutbox(store, {env = process.env, afterImport} = {}) {
  if (currentStepToken() !== undefined) throw new Error("job outbox drain must run after the caller step commits");
  if (env.STG_DB !== "file") throw new Error("job outbox requires STG_DB=file");
  return exclusive(async () => {
    const client = globalThis.abap?.context?.databaseConnections?.DEFAULT;
    if (!client?.path || client.path === ":memory:") throw new Error("durable business database is unavailable");
    const sourceDb = resolve(client.path);
    const who = identity(env);
    const reader = new DatabaseSync(sourceDb, {readOnly: true});
    let rows, sourceInstanceOnDisk, hasTail, hasSchedule;
    try {
      reader.exec("BEGIN");
      const hasInput = reader.prepare("PRAGMA table_info(zosd_job_step)").all()
        .some((column) => column.name.toLowerCase() === "input_json");
      hasTail = reader.prepare("PRAGMA table_info(zosd_job_outbox)").all()
        .some((column) => column.name.toLowerCase() === "tail_event_id");
      hasSchedule = reader.prepare("PRAGMA table_info(zosd_job_outbox)").all()
        .some((column) => column.name.toLowerCase() === "sdlstrtdt");
      rows = reader.prepare("SELECT * FROM zosd_job_outbox WHERE mandt = ? ORDER BY created_on, created_at, intent_id")
        .all(who.client).map((row) => ({...row, steps: reader.prepare(
          `SELECT step_no, program, ${hasInput ? "input_json" : "'' AS input_json"} FROM zosd_job_step WHERE mandt = ? AND intent_id = ? ORDER BY step_no`)
          .all(who.client, value(row, "intent_id"))}));
      if (reader.prepare("SELECT 1 FROM sqlite_master WHERE name = 'zosd_job_source_instance'").get()) {
        sourceInstanceOnDisk = reader.prepare("SELECT id FROM zosd_job_source_instance LIMIT 1").get()?.id;
      }
      reader.exec("COMMIT");
    } finally {
      reader.close();
    }
    let imported = 0;
    for (const row of rows) {
      const intent = {
        intentId: value(row, "intent_id"), sourceDb: value(row, "source_db"),
        client: value(row, "mandt"), sysid: value(row, "sysid"),
        jobname: value(row, "jobname"), jobcount: value(row, "jobcount"),
        owner: value(row, "owner"), program: value(row, "program"),
        generation: value(row, "generation"),
        steps: row.steps.map((step) => ({number: Number(value(step, "step_no")), program: value(step, "program"),
          input: jobInputJson(step.input_json)})),
        stepCount: Number(value(row, "step_count")),
      };
      const predName = value(row, "pred_jobname");
      const predCount = value(row, "pred_jobcount");
      const predIntent = value(row, "pred_intent_id");
      const sourceInstance = value(row, "source_instance");
      const eventId = value(row, "event_id");
      const eventParam = value(row, "event_param");
      const tailId = value(row, "tail_event_id");
      const tailParam = value(row, "tail_event_param");
      const waitSeqText = value(row, "wait_seq");
      const waitSeq = Number(waitSeqText);
      if (predName || predCount || predIntent) {
        if (!predName || !predCount || !predIntent) throw new Error(`outbox ${intent.intentId} has incomplete predecessor`);
        intent.afterEvent = {jobname: predName, jobcount: predCount, intentId: predIntent};
      }
      if (intent.sourceDb !== sourceDb || intent.client !== who.client || intent.sysid !== who.sid) {
        throw new Error(`outbox ${intent.intentId} belongs to another business instance`);
      }
      if (sourceInstance && sourceInstance !== sourceInstanceOnDisk) {
        throw new Error(`outbox ${intent.intentId} belongs to another source instance`);
      }
      if (eventId || eventParam || waitSeq > 0) {
        if (!eventId || !sourceInstance || intent.afterEvent ||
            !Number.isSafeInteger(waitSeq) || waitSeq < 1) {
          throw new Error(`outbox ${intent.intentId} has invalid named event condition`);
        }
        intent.namedEvent = {id: eventId, param: eventParam, sourceInstance, seq: waitSeq};
      }
      let schedule;
      try { schedule = hasSchedule ? scheduleOfOutbox(row) : null; }
      catch { throw new Error(`outbox ${intent.intentId} has an invalid start time or period`); }
      if (schedule) {
        if (intent.afterEvent || intent.namedEvent) throw new Error(`outbox ${intent.intentId} has a timed start and another condition`);
        intent.schedule = schedule;
      }
      if (tailId || tailParam) {
        if (!tailId || !sourceInstance) throw new Error(`outbox ${intent.intentId} has invalid tail event`);
        intent.tailEvent = {id: tailId, param: tailParam, sourceInstance};
      }
      // A v1 one-step intent has no child rows or count. Preserve its old
      // import digest so an import-before-ack retry survives this upgrade.
      const legacy = intent.stepCount === 0 && intent.steps.length === 0;
      if (!legacy && (!Number.isInteger(intent.stepCount) || intent.stepCount < 1 || intent.stepCount > 16 ||
          intent.steps.length !== intent.stepCount || intent.steps.some((step, i) => step.number !== i + 1) ||
          intent.steps[0]?.program !== intent.program)) {
        throw new Error(`outbox ${intent.intentId} has invalid ordered steps`);
      }
      if (legacy) delete intent.steps;
      store.importIntent(intent);
      await afterImport?.(intent); // test seam: process exit here must be safe
      try {
        const idWhere = `mandt = ${sql(who.client)} AND intent_id = ${sql(intent.intentId)}`;
        if (!legacy) {
          let concurrent = false;
          for (const step of intent.steps) {
            const child = await client.delete({table: "zosd_job_step",
              where: `${idWhere} AND step_no = ${sql(String(step.number).padStart(2, "0"))} AND program = ${sql(step.program)}`});
            if (child.subrc === 0 && child.dbcnt === 1) continue;
            await client.rollback();
            const check = new DatabaseSync(sourceDb, {readOnly: true});
            let pending;
            try { pending = check.prepare(`SELECT 1 FROM zosd_job_outbox WHERE mandt = ? AND intent_id = ?
              UNION ALL SELECT 1 FROM zosd_job_step WHERE mandt = ? AND intent_id = ?`)
              .get(who.client, intent.intentId, who.client, intent.intentId); } finally { check.close(); }
            if (pending) throw new Error("outbox acknowledgement failed");
            concurrent = true;
            break;
          }
          if (concurrent) { imported += 1; continue; }
        }
        const changed = await client.delete({table: "zosd_job_outbox",
          where: `${idWhere} AND sysid = ${sql(intent.sysid)} AND source_db = ${sql(intent.sourceDb)}
            AND jobname = ${sql(intent.jobname)} AND jobcount = ${sql(intent.jobcount)}
            AND owner = ${sql(intent.owner)} AND program = ${sql(intent.program)}
            AND generation = ${sql(intent.generation)}${legacy ? "" : ` AND step_count = ${sql(String(intent.stepCount).padStart(2, "0"))}`}
            AND pred_jobname = ${sql(predName)} AND pred_jobcount = ${sql(predCount)}
            AND pred_intent_id = ${sql(predIntent)}
            AND COALESCE(source_instance, '') = ${sql(sourceInstance)}
            AND COALESCE(wait_seq, '') = ${sql(waitSeqText)}
            AND COALESCE(event_id, '') = ${sql(eventId)}
            AND COALESCE(event_param, '') = ${sql(eventParam)}${hasTail ? `
            AND COALESCE(tail_event_id, '') = ${sql(tailId)}
            AND COALESCE(tail_event_param, '') = ${sql(tailParam)}` : ""}${hasSchedule ? ["sdlstrtdt", "sdlstrttm",
              "laststrtdt", "laststrttm", "prdmins", "prdhours", "prddays", "prdweeks"].map((field) => `
            AND COALESCE(${field}, '') = ${sql(value(row, field))}`).join("") : ""}`});
        if (changed.subrc === 0 && changed.dbcnt === 1) {
          await client.commit();
        } else if (changed.subrc === 4) {
          // Another process may have acknowledged the same imported intent.
          // FileSqliteClient also returns 4 for SQL errors, so verify the
          // committed row independently after releasing this transaction.
          await client.rollback();
          const check = new DatabaseSync(sourceDb, {readOnly: true});
          let pending;
          try {
            pending = check.prepare(`SELECT 1 FROM zosd_job_outbox WHERE mandt = ? AND intent_id = ?
              UNION ALL SELECT 1 FROM zosd_job_step WHERE mandt = ? AND intent_id = ?`)
              .get(who.client, intent.intentId, who.client, intent.intentId);
          } finally { check.close(); }
          if (pending) throw new Error("outbox acknowledgement failed");
        } else {
          throw new Error("outbox acknowledgement failed");
        }
      } catch (error) {
        await client.rollback();
        throw error;
      }
      imported += 1;
    }
    return {imported};
  }, "committed job outbox drain");
}
