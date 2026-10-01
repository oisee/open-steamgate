// The time scheduler of the JOB_* facade: releases a timed job at its start
// time, makes a periodic job's successor when the instance is released, and
// runs what is queued -- every run an ABAP entry through the dialog step
// (tools/osd-dialog-step.mjs, via runConvertedBatch), so it commits when it
// ends and rolls back when it dumps, and takes the one work process.
//
// One injectable clock drives it: `clock.now()` in milliseconds and
// `clock.setTimer(fn, ms)` / `clock.clearTimer(handle)`. The default reads
// the ABAP clock (abap.statements.getTime, the hook the frozen clock of the
// .http regression cases replaces) and arms a real timer; a test passes
// manualClock() and moves time itself, and installAbapClock() makes ABAP's
// sy-datum/sy-uzeit read the same clock, so JOB_CLOSE and the scheduler
// never disagree about "now".
//
// What is measured (sandbox, 2026-10-01) and what is not is in
// docs/job-standard-fms.md, "Periodic jobs"; the known differences are in
// ANORMALIES.md (one work process: overlapping instances queue; no minute
// tick: a due job starts when the scheduler looks, not at hh:mm:51).
import {randomInt} from "node:crypto";
import {resolve} from "node:path";
import {exclusive, outsideStepContext} from "./osd-dialog-step.mjs";
import {runConvertedBatch, workQueuedBatch} from "./osd-batch-runs.mjs";
import {drainJobOutbox} from "./osd-job-outbox.mjs";
import {msStamp, nextSchedule, periodMinutes, stampMs, successorIntentId} from "./osd-job-schedule.mjs";

const MAX_COUNT = 100000000;
const sqlText = (text) => `'${String(text).replaceAll("'", "''")}'`;

/** the ABAP clock: what sy-datum/sy-uzeit would read now, to the second */
export function abapNow(abap = globalThis.abap) {
  const statements = abap?.statements;
  const sy = abap?.builtin?.sy;
  if (typeof statements?.getTime !== "function" || typeof sy?.clone !== "function") return Date.now();
  const scratch = sy.clone();
  statements.getTime({sy: scratch});
  const date = String(scratch.get().datum.get());
  const time = String(scratch.get().uzeit.get());
  return stampMs(date + time) ?? Date.now();
}

export const systemClock = Object.freeze({
  now: () => abapNow(),
  setTimer: (fn, ms) => {
    const handle = setTimeout(() => outsideStepContext(fn), Math.max(0, ms));
    handle.unref?.();
    return handle;
  },
  clearTimer: (handle) => clearTimeout(handle),
});

/** a clock a test moves: advance() fires the timers that come due, in
 *  order, and waits for each one's promise */
export function manualClock(start) {
  let now = typeof start === "number" ? start : Date.parse(start);
  if (!Number.isFinite(now)) throw new TypeError("manualClock needs a start time");
  let next = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(fn, ms) {
      const handle = next++;
      timers.set(handle, {at: now + Math.max(0, ms), fn});
      return handle;
    },
    clearTimer(handle) { timers.delete(handle); },
    pending: () => [...timers.values()].map((timer) => timer.at).sort((a, b) => a - b),
    set(ms) { now = ms; },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        await due[1].fn();
      }
      now = Math.max(now, until);
    },
  };
}

/** sy-datum, sy-uzeit and GET TIME STAMP read `clock` until the returned
 *  restore() is called; the same hook tools/osd-case-determinism.mjs uses */
export function installAbapClock(abap, clock) {
  const original = abap.statements.getTime;
  abap.statements.getTime = (options = {}) => {
    const sy = options.sy ?? abap.builtin.sy;
    const stamp = msStamp(clock.now());
    const date = stamp.slice(0, 8);
    const time = stamp.slice(8);
    sy.get().datum.set(date);
    sy.get().datlo.set(date);
    sy.get().uzeit.set(time);
    sy.get().timlo.set(time);
    options.field?.set(time);
    options.stamp?.set(date + time);
  };
  abap.statements.getTime({sy: abap.builtin.sy});
  return () => {
    abap.statements.getTime = original;
    original({sy: abap.builtin.sy});
  };
}

export class JobScheduler {
  constructor({root = process.cwd(), store, env = process.env, clock = systemClock,
    execute = runConvertedBatch, candidate = () => randomInt(MAX_COUNT)} = {}) {
    if (!store) throw new TypeError("JobScheduler needs the operations store");
    this.root = root;
    this.store = store;
    this.env = env;
    this.clock = clock;
    this.execute = execute;
    this.candidate = candidate;
    this.timer = undefined;
    this.stopped = false;
    this.running = undefined;
  }

  /** host start: every overdue released job starts once, then the timer
   *  for the next start time is armed */
  start() {
    this.stopped = false;
    return this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** one pass: import committed intents, release due timed jobs (making
   *  each periodic successor), run what is queued, re-arm. Passes do not
   *  overlap; a pass asked for while one runs follows it. */
  tick() {
    const pass = (this.running ?? Promise.resolve()).then(() => this.#pass());
    this.running = pass.catch(() => undefined);
    return pass;
  }

  async #pass() {
    const outcomes = [];
    if (this.env.STG_DB === "file") await drainJobOutbox(this.store, {env: this.env});
    for (;;) {
      await this.releaseDue();
      const outcome = await workQueuedBatch(this.root, this.store, this.execute);
      if (outcome.kind === "empty" || outcome.kind === "busy") break;
      outcomes.push(outcome);
    }
    this.#arm();
    return outcomes;
  }

  /** release every timed job whose start time has come; a periodic one gets
   *  its successor first, so a crash between the two leaves a job that is
   *  still due and a successor that is found again, never a second one */
  async releaseDue() {
    const stamp = msStamp(this.clock.now());
    const released = [];
    for (const run of this.store.dueTimed(stamp)) {
      if (periodMinutes(periodOf(run)) > 0) await this.ensureSuccessor(run);
      const result = this.store.releaseTimed(run.id, stamp, new Date(this.clock.now()).toISOString());
      if (result.kind !== "unchanged") released.push({id: run.id, kind: result.kind});
    }
    return released;
  }

  /** the successor of a periodic instance: a new job of the same name and
   *  steps, a count from the usual allocator, status S, start = this
   *  instance's scheduled time + period */
  async ensureSuccessor(run) {
    const intentId = successorIntentId(run.id);
    if (this.store.successorOf(run.id)) return;
    const jobcount = await this.#reserveCount(run, intentId);
    const full = this.store.get(run.id, {revealInput: true});
    const schedule = nextSchedule({start: run.sdl_at, last: run.last_at ?? "", period: periodOf(run)});
    this.store.importIntent({intentId, sourceDb: run.source_db, client: run.source_client,
      sysid: run.source_sysid, jobname: run.job_name, jobcount, owner: run.source_owner,
      program: run.program, generation: run.generation,
      steps: full.steps.map((step) => ({number: step.number, program: step.program, input: step.input})),
      schedule, chainPred: run.id,
      ...(run.tail_event_id ? {tailEvent: {id: run.tail_event_id, param: run.tail_event_param ?? "",
        sourceInstance: run.source_instance}} : {})});
  }

  // JOB_OPEN's allocator: a random eight-digit count, retried on a taken
  // key, bound to the successor's intent in ZOSD_JOB_IDENTITY. A retry
  // finds the row it bound before instead of taking a second count.
  async #reserveCount(run, intentId) {
    return exclusive(async () => {
      const client = globalThis.abap?.context?.databaseConnections?.DEFAULT;
      if (!client?.db || !client.path || resolve(client.path) !== run.source_db) {
        throw new Error("periodic successor needs its own durable business database");
      }
      const found = client.db.prepare(`SELECT jobcount FROM zosd_job_identity
        WHERE mandt = ? AND jobname = ? AND intent_id = ?`).get(run.source_client, run.job_name, intentId);
      if (found) return String(found.jobcount).trim();
      for (let attempt = 0; attempt < 64; attempt++) {
        const count = String(this.candidate()).padStart(8, "0");
        const inserted = await client.insert({table: "zosd_job_identity",
          columns: ["mandt", "jobname", "jobcount", "owner", "intent_id"],
          values: [run.source_client, run.job_name, count, run.source_owner, intentId].map(sqlText)});
        if (inserted.subrc === 0) {
          await client.commit();
          return count;
        }
      }
      await client.rollback();
      throw new Error("could not allocate a job count for a periodic successor");
    }, "periodic job successor");
  }

  #arm() {
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const next = this.store.nextTimed();
    if (next === undefined) return;
    const wait = Math.max(0, stampMs(next) - this.clock.now());
    this.timer = this.clock.setTimer(() => this.tick(), wait);
  }
}

const periodOf = (run) => ({mins: run.prd_mins ?? 0, hours: run.prd_hours ?? 0,
  days: run.prd_days ?? 0, weeks: run.prd_weeks ?? 0});
