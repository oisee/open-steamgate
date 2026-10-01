// The timed-job half of the operations store (BatchRuns): start by date
// and time, periodic chains and BP_JOB_DELETE. Carved out of
// tools/osd-batch-runs.mjs (the size budget, #407); BatchRuns installs these
// methods on itself, so callers see one store and one API. Nothing here
// imports osd-batch-runs.mjs.
import {resolve} from "node:path";
import {checkSchedule} from "./osd-job-schedule.mjs";

// Only a source's own timed jobs: the operations store can be shared by
// several business databases, and another's job is not this worker's to
// start (its successor's count belongs to that database).
const sourceScope = `AND source_db = ? AND source_client = ? AND source_sysid = ? AND source_owner = ?
      AND (source_instance IS NULL OR source_instance = ?)`;
const sourceParams = (source) => [source.db, source.client, source.sysid, source.owner, source.instance ?? null];

/** the timed columns and indexes of batch_runs; called inside the store's
 *  schema transaction */
export function migrateTimedColumns(db) {
  // Start by date and time (sdl_at, last_at: system-time stamps), the
  // period, and the chain: chain_pred is the run whose start made this one.
  for (const [column, type] of [["sdl_at", "TEXT"], ["last_at", "TEXT"], ["prd_mins", "INTEGER"],
    ["prd_hours", "INTEGER"], ["prd_days", "INTEGER"], ["prd_weeks", "INTEGER"], ["chain_pred", "TEXT"]]) {
    if (!db.prepare("PRAGMA table_info(batch_runs)").all().some((item) => item.name === column)) {
      db.exec(`ALTER TABLE batch_runs ADD COLUMN ${column} ${type}`);
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS batch_runs_due ON batch_runs (state, sdl_at)");
  db.exec("CREATE INDEX IF NOT EXISTS batch_runs_chain ON batch_runs (chain_pred)");
}

/** the business source this process works for: its business database,
 *  client, system, user and source instance. Undefined without a durable
 *  business database. The worker claims, and the scheduler releases, only
 *  this source's jobs: another source's are not its business. */
export function workerSource() {
  const businessClient = globalThis.abap?.context?.databaseConnections?.DEFAULT;
  const businessDb = businessClient?.path;
  const sy = globalThis.abap?.builtin?.sy?.get?.();
  let instance;
  try {
    if (businessClient?.db?.prepare("SELECT 1 FROM sqlite_master WHERE name = 'zosd_job_source_instance'").get()) {
      instance = businessClient.db.prepare("SELECT id FROM zosd_job_source_instance LIMIT 1").get()?.id;
    }
  } catch { instance = undefined; }
  return businessDb && businessDb !== ":memory:" && sy ?
    {db: resolve(businessDb), client: String(sy.mandt.get()).trim(), sysid: String(sy.sysid.get()).trim(),
      owner: String(sy.uname.get()).trim(), instance} : undefined;
}

/** the schedule and periodic predecessor of an intent BatchRuns imports:
 *  both undefined for a job that is not timed, else checked */
export function timedIntent(intent, steps, after, named) {
  let schedule;
  if (intent.schedule !== undefined) {
    if (!steps || after !== undefined || named !== undefined) throw new TypeError("a timed job has no other start condition");
    schedule = checkSchedule(intent.schedule);
  }
  const chainPred = intent.chainPred;
  if (chainPred !== undefined && (schedule === undefined ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(String(chainPred)))) {
    throw new TypeError("invalid periodic predecessor");
  }
  return {schedule, chainPred};
}

/** batch_runs' sdl_at, last_at, prd_mins, prd_hours, prd_days, prd_weeks,
 *  chain_pred for an import */
export function timedColumns(schedule, chainPred) {
  return [schedule?.start ?? null, schedule ? schedule.last : null, schedule?.period.mins ?? null,
    schedule?.period.hours ?? null, schedule?.period.days ?? null, schedule?.period.weeks ?? null,
    chainPred ?? null];
}

let appendJobLog;

class TimedJobs {
  /** released time jobs of `source` whose start time has come, oldest
   *  first, and any whose release a crash interrupted (RELEASING) */
  dueTimed(nowStamp, source) {
    if (!source) return [];
    return this.readSnapshot(() => this.db.prepare(`SELECT id, job_name, job_count, source_db,
      source_client, source_sysid, source_owner, program, generation, sdl_at, last_at,
      prd_mins, prd_hours, prd_days, prd_weeks, tail_event_id, tail_event_param, source_instance
      FROM batch_runs WHERE state IN ('WAITING', 'RELEASING') AND sdl_at IS NOT NULL AND sdl_at <= ?
      ${sourceScope} ORDER BY sdl_at, rowid`).all(nowStamp, ...sourceParams(source)));
  }

  /** the earliest start time of `source` still waiting, for the next timer */
  nextTimed(source) {
    if (!source) return undefined;
    return this.readSnapshot(() => this.db.prepare(`SELECT MIN(sdl_at) AS at FROM batch_runs
      WHERE state IN ('WAITING', 'RELEASING') AND sdl_at IS NOT NULL ${sourceScope}`)
      .get(...sourceParams(source))?.at ?? undefined);
  }

  /** the job count of the run imported for an intent, if any */
  importedCount(intentId) {
    return this.readSnapshot(() => this.db.prepare(`SELECT r.job_count FROM batch_imports i
      JOIN batch_runs r ON r.id = i.run_id WHERE i.intent_id = ?`).get(intentId)?.job_count);
  }

  /** the run a periodic predecessor's start made, if any */
  successorOf(id) {
    return this.readSnapshot(() => this.db.prepare(`SELECT id FROM batch_runs WHERE chain_pred = ?
      ORDER BY rowid LIMIT 1`).get(id)?.id);
  }

  /** The decision to start a due time job, taken once: WAITING ->
   *  RELEASING in one conditional update. Only a job that wins it gets a
   *  successor; a job BP_JOB_DELETE took first does not, so deleting the
   *  waiting instance ends the chain (sandbox, 2026-10-01). A job already
   *  RELEASING (a crash after the decision) answers true again: recovery
   *  finishes the decision and never takes it twice. */
  beginRelease(id, nowStamp) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare("SELECT state, sdl_at FROM batch_runs WHERE id = ?").get(id);
      let decided = run?.state === "RELEASING";
      if (run?.state === "WAITING" && run.sdl_at && run.sdl_at <= nowStamp) {
        decided = this.db.prepare(`UPDATE batch_runs SET state = 'RELEASING'
          WHERE id = ? AND state = 'WAITING'`).run(id).changes === 1;
      }
      this.db.exec("COMMIT");
      return decided;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** RELEASING -> QUEUED, or FAILED when the latest start has passed (an
   *  assumption: the sandbox measured only the refusal at JOB_CLOSE, not a
   *  latest start reached while waiting) */
  releaseTimed(id, nowStamp, at = new Date().toISOString()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare(`SELECT state, sdl_at, last_at, step_count FROM batch_runs WHERE id = ?`).get(id);
      if (!run || run.state !== "RELEASING" || !run.sdl_at || run.sdl_at > nowStamp) {
        this.db.exec("COMMIT");
        return {kind: "unchanged"};
      }
      if (run.last_at && nowStamp > run.last_at) {
        const detail = "Latest start time passed before the job could start";
        this.db.prepare(`UPDATE batch_run_steps SET state = CASE WHEN step_no = 1 THEN 'FAILED' ELSE 'SKIPPED' END,
          ended_at = ?, result_status = CASE WHEN step_no = 1 THEN 'EXPIRED' ELSE NULL END,
          detail = CASE WHEN step_no = 1 THEN ? ELSE NULL END WHERE run_id = ? AND state = 'PENDING'`)
          .run(at, detail, id);
        this.db.prepare(`UPDATE batch_runs SET state = 'FAILED', ended_at = ?, result_status = 'EXPIRED',
          detail = ? WHERE id = ? AND state = 'RELEASING'`).run(at, detail, id);
        appendJobLog(this, id, 1, "STEP_FAILED", at);
        appendJobLog(this, id, null, "JOB_FAILED", at);
        this.db.exec("COMMIT");
        return {kind: "expired"};
      }
      const ready = this.db.prepare(`UPDATE batch_run_steps SET state = 'READY'
        WHERE run_id = ? AND step_no = 1 AND state = 'PENDING'`).run(id).changes;
      if (run.step_count < 1 || ready !== 1) throw new Error(`timed job ${id} has no first pending step`);
      this.db.prepare("UPDATE batch_runs SET state = 'QUEUED', queued_at = ? WHERE id = ? AND state = 'RELEASING'")
        .run(at, id);
      this.db.exec("COMMIT");
      return {kind: "released"};
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** BP_JOB_DELETE: a job that waits or has ended leaves the read model; a
   *  queued or running one stays. The row is kept as DELETED, so the import
   *  ledger, the job log and a periodic chain's link still have their run. */
  deleteJob(id) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.db.prepare("SELECT state FROM batch_runs WHERE id = ?").get(id);
      let kind;
      if (!run || run.state === "DELETED") kind = "missing";
      else if (run.state === "QUEUED" || run.state === "RUNNING" || run.state === "RELEASING") kind = "running";
      else {
        this.db.prepare("UPDATE batch_runs SET state = 'DELETED' WHERE id = ?").run(id);
        kind = "deleted";
      }
      this.db.exec("COMMIT");
      return kind;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

/** put the timed methods on BatchRuns.prototype, as non-enumerable methods
 *  like its own; `log(store, id, step, event, at)` is its private job log */
export function installTimedJobs(BatchRuns, log) {
  appendJobLog = log;
  for (const name of Object.getOwnPropertyNames(TimedJobs.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(BatchRuns.prototype, name, Object.getOwnPropertyDescriptor(TimedJobs.prototype, name));
  }
}
