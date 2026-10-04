// The one allocator of a JOBCOUNT, as a system makes it (measured on A4H,
// 2026-10-02): the creation time hhmmss in system time, then a two-character
// base-36 suffix that counts per (job name, second). Three opens of one name in
// one second are ...00, ...01, ...02; another name in that second starts at
// 00 again; so (jobname, jobcount) is the key and the count alone is not.
// Not measured: past ZZ for one name in one second. Here that is a
// refusal -- no wrap, no borrowing of the next second.
//
// JOB_OPEN (tools/osd-job-port.mjs) and the periodic successor
// (tools/osd-job-scheduler.mjs) both call nextJobCount(); neither makes a
// count of its own. The key stays unique in ZOSD_JOB_IDENTITY (client,
// jobname, jobcount); a proposal is only a proposal until that INSERT lands.
//
// The key has no date in it, as on a system, so the suffix is max+1 over
// existing rows of (name, hhmmss), across days: two standard
// daily jobs that start at a fixed second went ...06 then ...07 and ...07
// then ...08 on consecutive days (TBTCO, 2026-10-02). Only a deleted job and
// the job reorganisation (tools/osd-job-reorg.mjs) free a pair; a name that
// starts at one fixed second every day climbs even with retention because its
// latest instance stays, and can reach ZZ after about 1296 days.
import {existsSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {setupSqliteBusyTimeout} from "./sqlite-connection.mjs";
import {msStamp} from "./osd-job-schedule.mjs";
import {operationsPath} from "./osd-batch-runs.mjs";
import {identity} from "./osd-identity.mjs";

export const JOB_COUNT_EXHAUSTED = "No free JOBCOUNT for this job name this second";
export const JOB_COUNT_PATTERN = /^[0-9]{6}[0-9A-Z]{2}$/;
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CAPACITY = DIGITS.length ** 2;

export function suffixValue(suffix) {
  if (typeof suffix !== "string" || suffix.length !== 2) throw new TypeError("invalid JOBCOUNT suffix");
  const high = DIGITS.indexOf(suffix[0]), low = DIGITS.indexOf(suffix[1]);
  if (high < 0 || low < 0) throw new TypeError("invalid JOBCOUNT suffix");
  return high * DIGITS.length + low;
}

export function suffixOf(value) {
  if (!Number.isInteger(value) || value < 0 || value >= CAPACITY) throw new RangeError("JOBCOUNT suffix outside 00 to ZZ");
  return DIGITS[Math.floor(value / DIGITS.length)] + DIGITS[value % DIGITS.length];
}

export class JobCountExhausted extends Error {
  constructor(jobname, second) {
    super(`${JOB_COUNT_EXHAUSTED}: ${jobname} at ${second} reached ZZ`);
    this.code = "JOB_COUNT_EXHAUSTED";
  }
}

/** hhmmss of a moment, to the second */
export const secondOf = (ms) => msStamp(ms).slice(8);

/** The next count for `jobname` in the second of `ms`: max+1 over the
 *  existing identity rows of this name and second (the caller's own
 *  uncommitted rows included), skipping values `taken(count)` reports (a
 *  definition still in this LUW, an old count in the operations ledger).
 *  `db` is a node:sqlite connection. Returns {second, nn, count}; throws
 *  JobCountExhausted when the next value would be past ZZ. */
export function nextJobCount(db, {client, jobname, ms, taken = () => false}) {
  const second = secondOf(ms);
  const rows = db.prepare(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
    WHERE mandt = ? AND jobname = ? AND TRIM(jobcount) GLOB ?`)
    .all(client, jobname, `${second}[0-9A-Z][0-9A-Z]`);
  const used = new Set(rows.map((row) => row.count));
  const highest = rows.reduce((max, row) => Math.max(max, suffixValue(row.count.slice(6))), -1);
  for (let nn = highest + 1; nn < CAPACITY; nn++) {
    const count = second + suffixOf(nn);
    if (!used.has(count) && !taken(count)) return {second, nn, count};
  }
  throw new JobCountExhausted(jobname, second);
}

// Older outbox rows can have been acknowledged before the identity table was
// introduced, and their operations run row is then the only holder of the
// pair. A deleted run is a tombstone, not a holder of the pair. Reorganisation
// removes old runs and any corresponding identity rows together.
export function legacyCountUsed(root, env, sourceDb, client, name, count) {
  const path = operationsPath(root, env);
  if (!existsSync(path)) return false;
  const reader = new DatabaseSync(path, {readOnly: true});
  try {
    setupSqliteBusyTimeout(reader);
    const table = reader.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'batch_runs'").get();
    if (!table) return false;
    const columns = new Set(reader.prepare("PRAGMA table_info(batch_runs)").all().map((row) => row.name));
    if (!["source_db", "source_client", "source_sysid", "job_name", "job_count"]
      .every((column) => columns.has(column))) return false;
    return reader.prepare(`SELECT job_name FROM batch_runs WHERE source_db = ? AND source_client = ?
      AND source_sysid = ? AND job_count = ? AND state <> 'DELETED'`)
      .all(sourceDb, client, identity(env).sid, count)
      .some((row) => String(row.job_name ?? "").trim().toUpperCase() === name);
  } finally { reader.close(); }
}
