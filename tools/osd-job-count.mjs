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
import {msStamp} from "./osd-job-schedule.mjs";

export const JOB_COUNT_EXHAUSTED = "No free JOBCOUNT for this job name this second";

export class JobCountExhausted extends Error {
  constructor(jobname, second) {
    super(`${JOB_COUNT_EXHAUSTED}: ${jobname} at ${second} already has counters 00 to 99`);
    this.code = "JOB_COUNT_EXHAUSTED";
  }
}

/** hhmmss of a moment, to the second */
export const secondOf = (ms) => msStamp(ms).slice(8);

/** The next free count for `jobname` in the second of `ms`. `db` is a
 *  node:sqlite connection that sees the caller's own uncommitted rows;
 *  `taken(count)` reports a count something else holds (a definition still
 *  in this LUW, an old count in the operations ledger). Returns
 *  {second, nn, count}; throws JobCountExhausted when NN would pass 99. */
export function nextJobCount(db, {client, jobname, ms, taken = () => false}) {
  const second = secondOf(ms);
  const used = new Set(db.prepare(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
    WHERE mandt = ? AND jobname = ? AND TRIM(jobcount) GLOB ?`)
    .all(client, jobname, `${second}[0-9][0-9]`).map((row) => row.count));
  let top = -1;
  for (const count of used) top = Math.max(top, Number(count.slice(6)));
  for (let nn = top + 1; nn <= 99; nn++) {
    const count = second + String(nn).padStart(2, "0");
    if (!used.has(count) && !taken(count)) return {second, nn, count};
  }
  throw new JobCountExhausted(jobname, second);
}
