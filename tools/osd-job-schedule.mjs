// Start by date and time and periodic starts for the JOB_* facade: the
// arithmetic, in one place for the importer, the read model and the
// scheduler. A stamp is the system time JOB_CLOSE stored, YYYYMMDDHHMMSS,
// read as UTC (the sandbox measurement of 2026-10-01: SDLSTRTDT/TM are
// system time, and the system's time zone is UTC; this runtime's sy-datum
// and sy-uzeit are UTC as well).
import {createHash} from "node:crypto";

const STAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const MINUTE = 60 * 1000;
// The widths of TBTCO's period fields, which JOB_CLOSE checks as well.
export const PERIOD_LIMITS = Object.freeze({mins: 99, hours: 99, days: 999, weeks: 99});

/** milliseconds since the epoch of a valid stamp, else undefined */
export function stampMs(stamp) {
  const match = STAMP.exec(String(stamp ?? ""));
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return msStamp(ms) === stamp ? ms : undefined;
}

/** the stamp of a moment, to the second (the system's resolution) */
export function msStamp(ms) {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19).replace(/[-T:]/g, "");
}

export const isStamp = (stamp) => stampMs(stamp) !== undefined;

/** the period in minutes; 0 for a job that runs once */
export function periodMinutes(period) {
  if (period === undefined || period === null) return 0;
  return period.mins + 60 * period.hours + 24 * 60 * period.days + 7 * 24 * 60 * period.weeks;
}

/** a schedule as the importer accepts it, or a TypeError */
export function checkSchedule(schedule) {
  if (schedule === null || typeof schedule !== "object" ||
      Object.keys(schedule).sort().join(",") !== "last,period,start") {
    throw new TypeError("invalid job start schedule");
  }
  const {start, last, period} = schedule;
  if (!isStamp(start) || (last !== "" && (!isStamp(last) || last < start))) {
    throw new TypeError("invalid job start or latest start time");
  }
  if (period === null || typeof period !== "object" ||
      Object.keys(period).sort().join(",") !== "days,hours,mins,weeks" ||
      Object.entries(PERIOD_LIMITS).some(([key, max]) =>
        !Number.isSafeInteger(period[key]) || period[key] < 0 || period[key] > max)) {
    throw new TypeError("invalid job period");
  }
  return {start, last, period: {mins: period.mins, hours: period.hours, days: period.days, weeks: period.weeks}};
}

/** the JOB_CLOSE date/time and period columns of an outbox row: null for
 *  a row that is not timed, a TypeError for one that is invalid */
export function scheduleOfOutbox(row) {
  const text = (field) => String(row?.[field] ?? row?.[field.toUpperCase()] ?? "").trim();
  const fields = ["sdlstrtdt", "sdlstrttm", "laststrtdt", "laststrttm", "prdmins", "prdhours", "prddays", "prdweeks"];
  if (fields.every((field) => !text(field))) return null;
  const number = (field) => {
    const digits = text(field) || "0";
    if (!/^\d+$/.test(digits)) throw new TypeError(`invalid ${field}`);
    return Number(digits);
  };
  return checkSchedule({start: text("sdlstrtdt") + text("sdlstrttm"),
    last: text("laststrtdt") + text("laststrttm"),
    period: {mins: number("prdmins"), hours: number("prdhours"), days: number("prddays"), weeks: number("prdweeks")}});
}

/** the next instance of a periodic chain: the predecessor's *scheduled*
 *  time plus the period, never its actual start (sandbox, 2026-10-01:
 *  224501 -> 224701 for an instance that started at 22:45:51). The latest
 *  start keeps its distance to the start (an assumption: only the refusal
 *  at JOB_CLOSE was measured). */
export function nextSchedule(schedule) {
  const step = periodMinutes(schedule.period) * MINUTE;
  if (step <= 0) throw new Error("a job that runs once has no successor");
  return {start: msStamp(stampMs(schedule.start) + step),
    last: schedule.last ? msStamp(stampMs(schedule.last) + step) : "",
    period: {...schedule.period}};
}

/** the import payload of a time-scheduled job (version 7), the bytes the
 *  import ledger's digest is taken over and the read model checks */
export function scheduledPayload(base, steps, schedule, chainPred, tailEvent) {
  return JSON.stringify({version: 7, ...base, steps,
    schedule: {start: schedule.start, last: schedule.last, period: {mins: schedule.period.mins,
      hours: schedule.period.hours, days: schedule.period.days, weeks: schedule.period.weeks}},
    chainPred: chainPred ?? undefined, tailEvent: tailEvent ?? undefined});
}

/** the successor's intent ID is a function of its predecessor's run, so a
 *  retry after a crash finds the successor it already made instead of
 *  making a second one */
export function successorIntentId(predecessorRunId) {
  return createHash("sha256").update(`osd-job-successor\0${predecessorRunId}`).digest("hex").slice(0, 32);
}
