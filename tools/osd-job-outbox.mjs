// Import committed ABAP intent into the operations store. The source query
// uses a separate SQLite reader so an unfinished caller LUW is invisible.
// The ledger in BatchRuns makes an import-before-ack crash safe to retry.
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {exclusive, currentStepToken} from "./osd-dialog-step.mjs";
import {identity} from "./osd-identity.mjs";

const value = (row, field) => String(row[field] ?? row[field.toUpperCase()] ?? "").trim();

export async function drainJobOutbox(store, {env = process.env, afterImport} = {}) {
  if (currentStepToken() !== undefined) throw new Error("job outbox drain must run after the caller step commits");
  if (env.STG_DB !== "file") throw new Error("job outbox requires STG_DB=file");
  return exclusive(async () => {
    const client = globalThis.abap?.context?.databaseConnections?.DEFAULT;
    if (!client?.path || client.path === ":memory:") throw new Error("durable business database is unavailable");
    const sourceDb = resolve(client.path);
    const who = identity(env);
    const reader = new DatabaseSync(sourceDb, {readOnly: true});
    let rows;
    try {
      rows = reader.prepare("SELECT * FROM zosd_job_outbox WHERE mandt = ? ORDER BY created_on, created_at, intent_id")
        .all(who.client);
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
      };
      if (intent.sourceDb !== sourceDb || intent.client !== who.client || intent.sysid !== who.sid) {
        throw new Error(`outbox ${intent.intentId} belongs to another business instance`);
      }
      store.importIntent(intent);
      await afterImport?.(intent); // test seam: process exit here must be safe
      try {
        const quoted = intent.intentId.replaceAll("'", "''");
        const changed = await client.delete({table: "zosd_job_outbox",
          where: `mandt = '${who.client}' AND intent_id = '${quoted}'`});
        // FileSqliteClient reports subrc=4 for both no matching row and SQL
        // errors (including an aborting trigger). Neither proves the ack.
        if (changed.subrc !== 0 || changed.dbcnt !== 1) throw new Error("outbox acknowledgement failed");
        await client.commit();
      } catch (error) {
        await client.rollback();
        throw error;
      }
      imported += 1;
    }
    return {imported};
  }, "committed job outbox drain");
}
