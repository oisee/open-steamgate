// The job reorganisation of this runtime: what the system's reorganisation
// of TBTCO does for it. A job key is (JOBNAME, JOBCOUNT) with no date in it
// and the count has two base-36 digits per (name, second), so a job that starts
// at a fixed second every day can reach ZZ after about 1296 days even with
// retention: the latest periodic instance is kept. Finished jobs leave here,
// after a retention period (default 14
// days, OSD_JOB_RETENTION_DAYS, "off" for never): their identity row, outbox
// and step rows in the business database, and their run, steps, log, import
// ledger entry and completion event in the operations store.
//
// Only a job in a final state goes (COMPLETED, FAILED, INTERRUPTED -- finished
// and aborted on a system -- or DELETED) and only when it ended before the
// cutoff. Never a job that is not final, never one a waiting job is chained
// behind (after-job), never the latest instance of a periodic chain (a final
// periodic run no later run names as its predecessor). Both stores go in one
// dialog step, the business rows first: a crash in between leaves a run
// without identity, which the next reorganisation picks up, and not an
// identity pointing at nothing.
//
// Known limits: the final run of a chain that ended (a deleted successor) is
// kept for good; an identity row of a JOB_OPEN that was never closed has no
// run and is not removed; legacyCountUsed opens the operations store once
// per candidate count.
import {resolve} from "node:path";
import {dialogStep} from "./osd-dialog-step.mjs";

export const DEFAULT_RETENTION_DAYS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;
const FINAL = "('COMPLETED', 'FAILED', 'INTERRUPTED', 'DELETED')";

/** days of retention: a number, or null for "keep everything" */
export function retentionDays(env = process.env, given) {
  if (given === null) return null;
  if (given !== undefined) return Number.isFinite(Number(given)) && Number(given) >= 0 ? Number(given) : retentionDays(env);
  const text = String(env.OSD_JOB_RETENTION_DAYS ?? "").trim().toLowerCase();
  if (text === "") return DEFAULT_RETENTION_DAYS;
  if (["off", "never", "none"].includes(text)) return null;
  const days = Number(text);
  if (Number.isFinite(days) && days >= 0) return days;
  console.warn(`osd-job-reorg: OSD_JOB_RETENTION_DAYS=${env.OSD_JOB_RETENTION_DAYS} is not a number of days; using ${DEFAULT_RETENTION_DAYS}`);
  return DEFAULT_RETENTION_DAYS;
}

const period = (column) => `CAST(COALESCE(NULLIF(${column}, ''), 0) AS INTEGER)`;

/** the runs of `sourceDb` that may leave, oldest first */
export function reorgCandidates(store, {sourceDb, cutoff}) {
  return store.db.prepare(`SELECT id, source_client AS client, job_name AS name, job_count AS count
    FROM batch_runs r
    WHERE source_db = ? AND state IN ${FINAL} AND job_name IS NOT NULL AND job_count IS NOT NULL
      AND COALESCE(NULLIF(ended_at, ''), NULLIF(started_at, ''), queued_at) < ?
      AND NOT (${period("prd_mins")} + ${period("prd_hours")} + ${period("prd_days")} + ${period("prd_weeks")} > 0
        AND NOT EXISTS (SELECT 1 FROM batch_runs s WHERE s.chain_pred = r.id))
      AND NOT EXISTS (SELECT 1 FROM batch_runs w WHERE w.state NOT IN ${FINAL}
        AND w.source_db = r.source_db AND w.after_job_name = r.job_name AND w.after_job_count = r.job_count)
    ORDER BY COALESCE(NULLIF(ended_at, ''), NULLIF(started_at, ''), queued_at), rowid`)
    .all(sourceDb, cutoff);
}

/** One reorganisation. `client` is the business database's connection
 *  (DatabaseSync at .db, its file at .path), `ms` the clock's now. */
export async function reorgJobs({store, client, ms, days}) {
  if (days === null || days === undefined || !client?.db || !client.path) return {removed: 0};
  const sourceDb = resolve(client.path); // every writer stores the resolved path
  const cutoff = new Date(ms - days * DAY_MS).toISOString();
  const runs = reorgCandidates(store, {sourceDb, cutoff});
  if (!runs.length) return {removed: 0};
  // One dialog step holds the work process over both stores, the business
  // rows first: the job reads of this runtime take the same process, so none
  // sees a run without its identity. (A crash between the two leaves such a
  // run; the next reorganisation picks it up, and a read of it before then
  // says the job predates retained identity.)
  await dialogStep(async () => {
    if (client.inTransaction) await client.commit();
    client.db.exec("BEGIN IMMEDIATE");
    try {
      for (const run of runs) {
        const intent = run.id.replaceAll("-", "");
        client.db.prepare(`DELETE FROM zosd_job_identity WHERE mandt = ? AND jobname = ? AND jobcount = ?
          AND TRIM(intent_id) = ?`).run(run.client, run.name, run.count, intent);
        client.db.prepare("DELETE FROM zosd_job_step WHERE mandt = ? AND intent_id = ?").run(run.client, intent);
        client.db.prepare("DELETE FROM zosd_job_outbox WHERE mandt = ? AND intent_id = ?").run(run.client, intent);
      }
      client.db.exec("COMMIT");
    } catch (error) { client.db.exec("ROLLBACK"); throw error; }
    store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const run of runs) {
        for (const table of ["batch_job_log", "batch_run_steps", "batch_job_events", "batch_imports"]) {
          store.db.prepare(`DELETE FROM ${table} WHERE run_id = ?`).run(run.id);
        }
        store.db.prepare(`DELETE FROM batch_runs WHERE id = ? AND state IN ${FINAL}`).run(run.id);
      }
      store.db.exec("COMMIT");
    } catch (error) { store.db.exec("ROLLBACK"); throw error; }
  }, "job reorganisation");
  return {removed: runs.length, jobs: runs.map((run) => ({name: run.name, count: run.count}))};
}
