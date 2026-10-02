// The one allocator of a JOBCOUNT, as a system makes it (measured on A4H,
// 2026-10-02): the creation time hhmmss in system time, then a two-digit
// counter NN that counts per (job name, second). Three opens of one name in
// one second are ...00, ...01, ...02; another name in that second starts at
// 00 again; so (jobname, jobcount) is the key and the count alone is not.
// Not measured: past NN = 99 for one name in one second. Here that is a
// refusal -- no wrap, no borrowing of the next second.
//
// JOB_OPEN (tools/osd-job-port.mjs) and the periodic successor
// (tools/osd-job-scheduler.mjs) both call nextJobCount(); neither makes a
// count of its own. The key stays unique in ZOSD_JOB_IDENTITY (client,
// jobname, jobcount); a proposal is only a proposal until that INSERT lands.
//
// The key has no date in it, as on a system, so the counter is "the next NN
// that no existing row of (name, hhmmss) holds", across days: two standard
// daily jobs that start at a fixed second went ...06 then ...07 and ...07
// then ...08 on consecutive days (TBTCO, 2026-10-02). Only a deleted job and
// the job reorganisation (tools/osd-job-reorg.mjs) free a pair; a name that
// starts at one fixed second every day would otherwise refuse after 100 days.
import {existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {msStamp} from "./osd-job-schedule.mjs";
import {operationsPath} from "./osd-batch-runs.mjs";
import {identity} from "./osd-identity.mjs";

export const JOB_COUNT_EXHAUSTED = "No free JOBCOUNT for this job name this second";

export class JobCountExhausted extends Error {
  constructor(jobname, second) {
    super(`${JOB_COUNT_EXHAUSTED}: ${jobname} at ${second} already has counters 00 to 99`);
    this.code = "JOB_COUNT_EXHAUSTED";
  }
}

/** hhmmss of a moment, to the second */
export const secondOf = (ms) => msStamp(ms).slice(8);

/** The next free count for `jobname` in the second of `ms`: the lowest NN
 *  that no identity row of this name and second holds (the caller's own
 *  uncommitted rows included) and `taken(count)` does not report (a
 *  definition still in this LUW, an old count in the operations ledger).
 *  `db` is a node:sqlite connection. Returns {second, nn, count}; throws
 *  JobCountExhausted when all of 00 to 99 are held. */
export function nextJobCount(db, {client, jobname, ms, taken = () => false}) {
  const second = secondOf(ms);
  const used = new Set(db.prepare(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
    WHERE mandt = ? AND jobname = ? AND TRIM(jobcount) GLOB ?`)
    .all(client, jobname, `${second}[0-9][0-9]`).map((row) => row.count));
  for (let nn = 0; nn <= 99; nn++) {
    const count = second + String(nn).padStart(2, "0");
    if (!used.has(count) && !taken(count)) return {second, nn, count};
  }
  throw new JobCountExhausted(jobname, second);
}

// Older outbox rows can have been acknowledged before the identity table was
// introduced, and their operations run row is then the only holder of the
// pair. The job reorganisation deletes a run only together with the
// identity row, and a run of that age is gone from here by then.
export function legacyCountUsed(root, env, sourceDb, client, name, count) {
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
