// Private, read-only technical job history. This is neither report list output
// nor BAL. A future BP_JOBLOG_READ facade must measure its ABAP signature.
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {operationsPath} from "./osd-batch-runs.mjs";
import {JobSnapshotError, readJobSnapshot} from "./osd-job-snapshot.mjs";

const MAX_ROWS = 2000;
const value = (row, key) => String(row?.[key] ?? "").trim();
const runIdOf = (id) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

export function readJobLog({sourceDb, jobName, jobCount, caller, root = process.cwd(), env = process.env} = {}) {
  const snapshot = readJobSnapshot({sourceDb, jobName, jobCount, caller, root, env});
  if (!snapshot) return undefined;
  if (snapshot.phase !== "OPERATIONS") return {phase: snapshot.phase, entries: [], historicalGap: false};
  const db = new DatabaseSync(operationsPath(root, env), {readOnly: true});
  try {
    db.exec("BEGIN");
    const id = runIdOf(snapshot.intentId);
    const ledger = db.prepare("SELECT run_id FROM batch_imports WHERE intent_id = ?")
      .get(snapshot.intentId);
    const run = db.prepare("SELECT * FROM batch_runs WHERE id = ?").get(id);
    if (ledger?.run_id !== id || !run || value(run, "source_db") !== resolve(sourceDb) ||
        value(run, "source_client") !== caller.client || value(run, "source_sysid") !== caller.sid ||
        value(run, "source_owner") !== caller.user ||
        value(run, "job_name").toUpperCase() !== snapshot.jobName ||
        value(run, "job_count") !== snapshot.jobCount) {
      throw new JobSnapshotError("JOB_SNAPSHOT_INCONSISTENT", "job log source differs from verified job identity");
    }
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'batch_job_log'").get();
    const rows = table ? db.prepare(`SELECT seq, step_no, occurred_at, event_code, severity, text
      FROM batch_job_log WHERE run_id = ? ORDER BY seq LIMIT ?`).all(id, MAX_ROWS + 1) : [];
    if (rows.length > MAX_ROWS) throw new JobSnapshotError("JOB_LOG_TOO_LARGE", "job log exceeds bounded private read");
    if (rows.some((row, index) => row.seq !== index + 1)) {
      throw new JobSnapshotError("JOB_SNAPSHOT_INCONSISTENT", "job log sequence has a gap");
    }
    const entries = rows.map((row) => ({sequence: row.seq, step: row.step_no,
      at: row.occurred_at, event: row.event_code, severity: row.severity, text: row.text}));
    return {phase: snapshot.phase, entries,
      historicalGap: entries[0]?.event !== "IMPORTED"};
  } finally {
    db.exec("ROLLBACK");
    db.close();
  }
}
