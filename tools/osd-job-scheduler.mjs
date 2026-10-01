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
import {runConvertedBatch, workQueuedBatch, workerSource} from "./osd-batch-runs.mjs";
import {drainJobOutbox} from "./osd-job-outbox.mjs";
import {msStamp, nextSchedule, periodMinutes, stampMs, successorIntentId} from "./osd-job-schedule.mjs";

const MAX_COUNT = 100000000;
const INTENT_INDEX = "zosd_job_identity_intent";

/** The successor's count, reserved atomically on its intent: the intent is
 *  a unique key of ZOSD_JOB_IDENTITY (a partial index; an open job has no
 *  intent yet), and a reservation is "insert, or return the row that is
 *  there", so two workers racing for one successor end with one count, and
 *  a restart finds it. Duplicates left by an earlier build converge first,
 *  on the count an import already used (`winnerOf`), else the lowest.
 *  `db` is a node:sqlite connection to the business database with no open
 *  transaction; `beforeInsert` is a test seam between the read and the
 *  write. */
export function reserveSuccessorCount(db, {client, jobname, owner, intentId},
  {candidate = () => randomInt(MAX_COUNT), winnerOf = () => undefined, beforeInsert} = {}) {
  const transaction = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try { const answer = work(); db.exec("COMMIT"); return answer; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  transaction(() => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(INTENT_INDEX)) return;
    const groups = db.prepare(`SELECT mandt, TRIM(intent_id) AS intent FROM zosd_job_identity
      WHERE TRIM(intent_id) <> '' GROUP BY mandt, TRIM(intent_id) HAVING COUNT(*) > 1`).all();
    for (const group of groups) {
      const counts = db.prepare(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
        WHERE mandt = ? AND TRIM(intent_id) = ? ORDER BY jobcount`).all(group.mandt, group.intent)
        .map((row) => row.count);
      const imported = winnerOf(group.intent);
      const winner = counts.includes(imported) ? imported : counts[0];
      db.prepare(`DELETE FROM zosd_job_identity WHERE mandt = ? AND TRIM(intent_id) = ?
        AND TRIM(jobcount) <> ?`).run(group.mandt, group.intent, winner);
    }
    db.exec(`CREATE UNIQUE INDEX ${INTENT_INDEX} ON zosd_job_identity (mandt, intent_id)
      WHERE intent_id <> ''`);
  });
  const existing = () => db.prepare(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
    WHERE mandt = ? AND intent_id = ?`).get(client, intentId)?.count;
  const found = existing();
  if (found) return found;
  beforeInsert?.();
  for (let attempt = 0; attempt < 64; attempt++) {
    const count = String(candidate()).padStart(8, "0");
    const answer = transaction(() => {
      db.prepare(`INSERT INTO zosd_job_identity (mandt, jobname, jobcount, owner, intent_id)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(client, jobname, count, owner, intentId);
      return existing(); // ours, or the one another worker reserved first
    });
    if (answer) return answer;
    // the count was taken by another job: draw again
  }
  throw new Error("could not allocate a job count for a periodic successor");
}

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
    this.beforeReserve = undefined; // test seam, see reserveSuccessorCount
    this.afterDueRead = undefined; // test seam, see releaseDue
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

  /** release every timed job whose start time has come. The decision is the
   *  store's WAITING -> RELEASING transition; only then is a periodic job's
   *  successor made, and then the job is queued. A crash after the decision
   *  leaves it RELEASING: the next pass finishes it (successor found again
   *  through its unique intent, never a second one) and never re-decides. */
  async releaseDue() {
    const stamp = msStamp(this.clock.now());
    const released = [];
    for (const run of this.store.dueTimed(stamp, workerSource())) {
      await this.afterDueRead?.(run); // test seam: a BP_JOB_DELETE may commit here
      if (!this.store.beginRelease(run.id, stamp)) continue; // deleted (or taken) meanwhile: no successor
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

  // JOB_OPEN's allocator (a random eight-digit count, retried on a taken
  // key), bound atomically to the successor's intent; see
  // reserveSuccessorCount.
  async #reserveCount(run, intentId) {
    return exclusive(async () => {
      const client = globalThis.abap?.context?.databaseConnections?.DEFAULT;
      if (!client?.db || !client.path || resolve(client.path) !== run.source_db) {
        throw new Error("periodic successor needs its own durable business database");
      }
      if (client.inTransaction) await client.commit();
      return reserveSuccessorCount(client.db, {client: run.source_client, jobname: run.job_name,
        owner: run.source_owner, intentId}, {candidate: this.candidate,
        winnerOf: (intent) => this.store.importedCount(intent), beforeInsert: this.beforeReserve});
    }, "periodic job successor");
  }

  #arm() {
    if (this.timer !== undefined) this.clock.clearTimer(this.timer);
    this.timer = undefined;
    if (this.stopped) return;
    const next = this.store.nextTimed(workerSource());
    if (next === undefined) return;
    const wait = Math.max(0, stampMs(next) - this.clock.now());
    this.timer = this.clock.setTimer(() => this.tick(), wait);
  }
}

const periodOf = (run) => ({mins: run.prd_mins ?? 0, hours: run.prd_hours ?? 0,
  days: run.prd_days ?? 0, weeks: run.prd_weeks ?? 0});
