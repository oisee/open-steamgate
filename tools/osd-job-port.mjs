// Pending definitions for the narrow JOB_* ABAP facade. The private RFC
// destination uses the current dialog-step token; no definition is process
// global or allowed to survive COMMIT, ROLLBACK, WAIT, dump, or step exit.
import {randomUUID, randomInt} from "node:crypto";
import {existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {resolve} from "node:path";
import {currentStepToken, onStepLuwEnd} from "./osd-dialog-step.mjs";
import {givenText, fill} from "./osd-destination.mjs";
import {liveGeneration, operationsPath} from "./osd-batch-runs.mjs";
import {identity} from "./osd-identity.mjs";
import {readJobSnapshot} from "./osd-job-snapshot.mjs";

const pending = new WeakMap();
const keyOf = (name, count) => `${name}\0${count}`;
const statusFill = (signature, fields) => fill(signature, {
  EV_JOBCOUNT: "", EV_JOBNAME: "", EV_INTENT_ID: "", EV_PROGRAM: "",
  EV_GENERATION: "", EV_SOURCE_DB: "", EV_ERROR: "",
  EV_PHASE: "", EV_STATE: "", EV_RESULT_STATUS: "", EV_STEP_COUNT: "",
  EV_ERROR_CODE: "", ...fields,
});
export const MAX_JOB_STEPS = 16;
const MAX_COUNT = 100000000;

// Older outbox rows can have been acknowledged before the identity table was
// introduced. The operations run row currently has no retention policy and
// must be kept for these pre-upgrade counts. A future run retention change
// must first move those keys into the permanent business identity table.
function legacyCountUsed(root, env, sourceDb, client, name, count) {
  const path = operationsPath(root, env);
  if (!existsSync(path)) return false;
  const reader = new DatabaseSync(path, {readOnly: true});
  try {
    const table = reader.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'batch_runs'").get();
    if (!table) return false;
    const columns = new Set(reader.prepare("PRAGMA table_info(batch_runs)").all().map((row) => row.name));
    if (!["source_db", "source_client", "source_sysid", "job_name", "job_count"]
      .every((column) => columns.has(column))) return false;
    return reader.prepare(`SELECT job_name FROM batch_runs WHERE source_db = ? AND source_client = ?
      AND source_sysid = ? AND job_count = ?`)
      .all(sourceDb, client, identity(env).sid, count)
      .some((row) => String(row.job_name ?? "").trim().toUpperCase() === name);
  } finally { reader.close(); }
}

export class JobDestination {
  constructor(root = process.cwd(), env = process.env) {
    this.root = root;
    this.env = env;
    this.generation = liveGeneration(root);
    this.candidate = () => randomInt(MAX_COUNT);
  }

  async call(_name, signature) {
    const token = currentStepToken();
    if (token === undefined) throw new Error("JOB_* requires a dialog step");
    const command = givenText(signature, "IV_COMMAND").toUpperCase();
    const jobname = givenText(signature, "IV_JOBNAME").toUpperCase();
    const count = givenText(signature, "IV_JOBCOUNT");
    const program = givenText(signature, "IV_PROGRAM").toUpperCase();
    const stepNo = Number(givenText(signature, "IV_STEP_NO"));
    const owner = givenText(signature, "IV_OWNER").toUpperCase();
    const client = givenText(signature, "IV_CLIENT");
    const db = globalThis.abap?.context?.databaseConnections?.DEFAULT;
    if (this.env.STG_DB !== "file" || !db?.path || db.path === ":memory:") {
      if (command === "STATUS") statusFill(signature, {EV_ERROR_CODE: "UNAVAILABLE"});
      else fill(signature, {EV_ERROR: "JOB_* requires a durable STG_DB=file business database"});
      return;
    }
    if (command === "STATUS") {
      // Caller-supplied IV_OWNER and IV_CLIENT are deliberately ignored.
      // The configured identity also boots sy-uname/mandt/sysid in this host.
      const who = identity(this.env);
      const sourceDb = resolve(db.path);
      const name = jobname.trim().toUpperCase();
      if (!name || name.length > 32 || !/^\d{8}$/.test(count)) {
        statusFill(signature, {EV_ERROR_CODE: "BAD_KEY"});
        return;
      }
      const transient = pending.get(token)?.get(keyOf(name, count));
      if (transient) {
        statusFill(signature, {EV_ERROR_CODE: transient.owner === who.user && transient.client === who.client ?
          "UNCOMMITTED" : "FORBIDDEN"});
        return;
      }
      try {
        const snapshot = readJobSnapshot({sourceDb, jobName: name, jobCount: count,
          caller: {client: who.client, user: who.user, sid: who.sid},
          root: this.root, env: this.env});
        // The durable reader uses a second, read-only connection. Its absence
        // can mean an OPEN/CLOSE still staged in this caller's SQLite LUW.
        // Inspect the *existing* business connection without ending that LUW.
        const local = db.db.prepare(`SELECT owner, intent_id FROM zosd_job_identity
          WHERE mandt = ? AND jobname = ? AND jobcount = ?`).get(who.client, name, count);
        if (local && String(local.owner ?? "").trim() !== who.user) {
          statusFill(signature, {EV_ERROR_CODE: "FORBIDDEN"});
        } else if ((local && (!snapshot || String(local.intent_id ?? "").trim() !== (snapshot.intentId ?? ""))) ||
            (!local && snapshot)) {
          statusFill(signature, {EV_ERROR_CODE: "UNCOMMITTED"});
        } else if (!snapshot) {
          statusFill(signature, {EV_ERROR_CODE: "NOT_FOUND"});
        } else {
          statusFill(signature, {EV_PHASE: snapshot.phase, EV_STATE: snapshot.state,
            EV_RESULT_STATUS: snapshot.resultStatus ?? "", EV_STEP_COUNT: String(snapshot.steps.length)});
        }
      } catch (error) {
        let code = {
          JOB_READ_BAD_KEY: "BAD_KEY", JOB_READ_FORBIDDEN: "FORBIDDEN",
          JOB_SNAPSHOT_INCONSISTENT: "INCONSISTENT", JOB_LEGACY_UNSUPPORTED: "LEGACY",
        }[error?.code] ?? "UNAVAILABLE";
        // An unfinished caller update can make its local identity differ
        // from the committed one even when the latter's snapshot is broken.
        if (code === "INCONSISTENT") {
          try {
            const local = db.db.prepare(`SELECT owner, intent_id FROM zosd_job_identity
              WHERE mandt = ? AND jobname = ? AND jobcount = ?`).get(who.client, name, count);
            const reader = new DatabaseSync(sourceDb, {readOnly: true});
            let committed;
            try {
              committed = reader.prepare(`SELECT owner, intent_id FROM zosd_job_identity
                WHERE mandt = ? AND jobname = ? AND jobcount = ?`).get(who.client, name, count);
            } finally { reader.close(); }
            const same = (row) => row && ["owner", "intent_id"].map((key) =>
              String(row[key] ?? "").trim()).join("\0");
            if (same(local) !== same(committed)) code = "UNCOMMITTED";
          } catch { code = "UNAVAILABLE"; }
        }
        statusFill(signature, {EV_ERROR_CODE: code});
      }
      return;
    }
    let jobs = pending.get(token);
    if (jobs === undefined) {
      jobs = new Map();
      pending.set(token, jobs);
      onStepLuwEnd(() => pending.delete(token));
    }
    let answer;
    switch (command) {
      case "OPEN": {
        if (!jobname || jobname.length > 32) { answer = {EV_ERROR: "Invalid job name"}; break; }
        let number;
        // A bounded search also handles deterministic collision probes and a
        // saturated namespace without trapping an ABAP caller indefinitely.
        for (let i = 0; i < 64; i++) {
          number = String(this.candidate()).padStart(8, "0");
          if (!jobs.has(keyOf(jobname, number)) &&
              !legacyCountUsed(this.root, this.env, resolve(db.path), client, jobname, number)) break;
          number = undefined;
        }
        if (!number) { answer = {EV_ERROR: "Could not allocate a job count"}; break; }
        jobs.set(keyOf(jobname, number), {jobname, count: number, owner, client, steps: []});
        answer = {EV_JOBCOUNT: number, EV_JOBNAME: jobname};
        break;
      }
      case "CANCEL": {
        const key = keyOf(jobname, count);
        const job = jobs.get(key);
        if (!job || job.owner !== owner || job.client !== client || job.closed || job.steps.length) {
          answer = {EV_ERROR: "Transient job candidate not found"}; break;
        }
        jobs.delete(key);
        answer = {};
        break;
      }
      case "SUBMIT": {
        const job = jobs.get(keyOf(jobname, count));
        if (!job || job.owner !== owner || job.client !== client) { answer = {EV_ERROR: "Job definition not found in this LUW"}; break; }
        if (job.closed || job.steps.length >= MAX_JOB_STEPS) { answer = {EV_ERROR: "Job step limit reached or definition closed"}; break; }
        job.steps.push(program);
        answer = {};
        break;
      }
      case "CLOSE": {
        const key = keyOf(jobname, count);
        const job = jobs.get(key);
        if (!job || job.owner !== owner || job.client !== client) { answer = {EV_ERROR: "Job definition not found in this LUW"}; break; }
        if (!job.steps.length || job.closed) { answer = {EV_ERROR: "Job has no open report steps"}; break; }
        if (resolve(db.path).length > 255) { answer = {EV_ERROR: "Business database path exceeds outbox field length"}; break; }
        const intentId = randomUUID().replaceAll("-", "");
        const savepoint = `osd_job_${intentId}`;
        // Open SQL uses this same FileSqliteClient. A statement failure can
        // leave SQLite changes behind (RAISE(FAIL)); only a savepoint can
        // undo the entire CLOSE without undoing earlier caller writes.
        try {
          await db.beginTransaction();
          db.db.exec(`SAVEPOINT ${savepoint}`);
        } catch {
          answer = {EV_ERROR: "Could not begin job close"}; break;
        }
        job.closed = true;
        job.intentId = intentId;
        job.savepoint = savepoint;
        answer = {
          EV_JOBNAME: jobname,
          EV_INTENT_ID: job.intentId,
          EV_PROGRAM: job.steps[0],
          EV_STEP_COUNT: String(job.steps.length),
          EV_GENERATION: this.generation,
          EV_SOURCE_DB: resolve(db.path),
        };
        break;
      }
      case "READ": {
        const job = jobs.get(keyOf(jobname, count));
        if (!job || !job.closed || job.owner !== owner || job.client !== client ||
            job.intentId !== givenText(signature, "IV_INTENT_ID") ||
            !Number.isInteger(stepNo) || stepNo < 1 || stepNo > job.steps.length) {
          answer = {EV_ERROR: "Closed job step not found"}; break;
        }
        answer = {EV_PROGRAM: job.steps[stepNo - 1]};
        break;
      }
      case "DONE": {
        const key = keyOf(jobname, count);
        const job = jobs.get(key);
        if (!job || !job.closed || !job.savepoint || job.owner !== owner || job.client !== client ||
            job.intentId !== givenText(signature, "IV_INTENT_ID")) {
          answer = {EV_ERROR: "Closed job not found"}; break;
        }
        db.db.exec(`RELEASE SAVEPOINT ${job.savepoint}`);
        jobs.delete(key);
        answer = {};
        break;
      }
      case "ABORT": {
        const key = keyOf(jobname, count);
        const job = jobs.get(key);
        if (!job || !job.closed || !job.savepoint || job.owner !== owner || job.client !== client ||
            job.intentId !== givenText(signature, "IV_INTENT_ID")) {
          // ABAP callers do not import EV_ERROR on a cleanup call. Throw so
          // an invalid cleanup cannot be mistaken for a handled CLOSE.
          throw new Error("Closed job savepoint not found");
        }
        db.db.exec(`ROLLBACK TO SAVEPOINT ${job.savepoint}`);
        db.db.exec(`RELEASE SAVEPOINT ${job.savepoint}`);
        jobs.delete(key);
        answer = {};
        break;
      }
      default: answer = {EV_ERROR: `Unknown job command ${command}`};
    }
    fill(signature, answer);
  }
}
