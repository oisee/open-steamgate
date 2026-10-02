// Start by date and time and periodic jobs (0.6 should): the sandbox
// measurements of 2026-10-01 as fixtures (test/fixtures/jobs-periodic/
// contract.json, EXPECT = A4H), each driven through the real ABAP facade
// (JOB_OPEN/SUBMIT/CLOSE, BP_JOB_READ, SHOW_JOBSTATE, BP_JOB_SELECT,
// BP_JOB_DELETE) and the scheduler on one injectable clock.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns, liveGeneration, runConvertedBatch, workerSource} from "../tools/osd-batch-runs.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {JobScheduler, installAbapClock, manualClock, reserveSuccessorCount} from "../tools/osd-job-scheduler.mjs";
import {msStamp, stampMs, successorIntentId} from "../tools/osd-job-schedule.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {randomBytes} from "node:crypto";
import {jobHeaderType} from "./fixtures/job-header.mjs";

const root = resolve(".");
const contract = JSON.parse(readFileSync(join(root, "test/fixtures/jobs-periodic/contract.json"), "utf8"));

describe("periodic and time-scheduled background jobs", function () {
  this.timeout(120000);
  let dir, dbPath, beforeEnv, priorAbap, priorContext, abap, client, restoreClock;
  const box = (value = "") => new abap.types.String().set(value);
  const user = () => abap.builtin.sy.get().uname.get().trim();
  const readBusiness = (sql, ...args) => {
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try { return db.prepare(sql).all(...args); } finally { db.close(); }
  };
  const table = (row) => new abap.types.Table(row, {withHeader: false, keyType: "DEFAULT",
    primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-jobs-periodic-"));
    dbPath = join(dir, "business.sqlite");
    beforeEnv = Object.fromEntries(["STG_DB", "STG_DB_PATH", "OSD_OPERATIONS_DB"]
      .map((name) => [name, process.env[name]]));
    priorAbap = globalThis.abap;
    if (priorAbap?.context) priorContext = {
      databaseConnections: {...priorAbap.context.databaseConnections},
      RFCDestinations: {...priorAbap.context.RFCDestinations},
      osdGeneration: priorAbap.context.osdGeneration,
    };
    process.env.STG_DB = "file";
    process.env.STG_DB_PATH = dbPath;
    process.env.OSD_OPERATIONS_DB = join(dir, "operations-0.sqlite");
    const {initializeABAP} = await import("../output/init.mjs");
    await initializeABAP();
    abap = globalThis.abap;
    client = abap.context.databaseConnections.DEFAULT;
  });
  afterEach(() => { restoreClock?.(); restoreClock = undefined; });
  after(async () => {
    await client?.disconnect?.();
    if (priorAbap === abap && priorContext) {
      abap.context.databaseConnections = priorContext.databaseConnections;
      abap.context.RFCDestinations = priorContext.RFCDestinations;
      if (priorContext.osdGeneration === undefined) delete abap.context.osdGeneration;
      else abap.context.osdGeneration = priorContext.osdGeneration;
    }
    if (priorAbap !== undefined) globalThis.abap = priorAbap;
    for (const [name, value] of Object.entries(beforeEnv ?? {})) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (dir) rmSync(dir, {recursive: true, force: true});
  });

  // One world per case: its own clock, operations store and scheduler; the
  // business database is shared, so job names carry the case's prefix.
  let worlds = 0;
  function world(start, {execute} = {}) {
    worlds += 1;
    const clock = manualClock(start);
    restoreClock?.();
    restoreClock = installAbapClock(abap, clock);
    process.env.OSD_OPERATIONS_DB = join(dir, `operations-${worlds}.sqlite`);
    const w = {clock, t0: clock.now(), prefix: `P${worlds}_`, counts: {}};
    w.store = new BatchRuns(root, process.env);
    w.execute = execute ?? runConvertedBatch;
    w.scheduler = new JobScheduler({root, store: w.store, env: process.env, clock, execute: w.execute});
    w.name = (job) => w.prefix + job;
    w.at = (seconds) => msStamp(w.t0 + seconds * 1000);
    w.offset = (stamp) => (stampMs(stamp) - w.t0) / 1000;
    w.runs = (job, where = "1 = 1") => w.store.db.prepare(`SELECT * FROM batch_runs WHERE job_name = ?
      AND sdl_at IS NOT NULL AND ${where} ORDER BY sdl_at, rowid`).all(w.name(job));
    w.instances = (job) => w.runs(job, "started_at <> '' AND state <> 'WAITING'").map((run) => w.offset(run.sdl_at));
    w.waiting = (job) => w.runs(job, "state = 'WAITING'").map((run) => w.offset(run.sdl_at));
    w.aborted = (job) => w.runs(job, "started_at <> '' AND state = 'FAILED'").map((run) => w.offset(run.sdl_at));
    w.hostStart = async () => {
      w.scheduler.stop();
      w.store = new BatchRuns(root, process.env);
      w.scheduler = new JobScheduler({root, store: w.store, env: process.env, clock, execute: w.execute});
      return w.scheduler.start();
    };
    return w;
  }

  async function close(w, job, {start, last, period = {}, report = "ZGG_EX_012", extra = {}} = {}) {
    const name = w.name(job);
    const answer = {};
    await dialogStep(async () => {
      const count = new abap.types.String();
      await abap.FunctionModules.JOB_OPEN({exporting: {jobname: box(name)}, importing: {jobcount: count}});
      answer.count = count.get();
      await abap.FunctionModules.JOB_SUBMIT({exporting: {jobname: box(name), jobcount: box(answer.count),
        report: box(report), authcknam: box(user())}});
      const released = new abap.types.String();
      const exporting = {jobname: box(name), jobcount: box(answer.count)};
      if (start !== undefined) {
        exporting.sdlstrtdt = box(w.at(start).slice(0, 8));
        exporting.sdlstrttm = box(w.at(start).slice(8));
      }
      if (last !== undefined) {
        exporting.laststrtdt = box(w.at(last).slice(0, 8));
        exporting.laststrttm = box(w.at(last).slice(8));
      }
      for (const [key, value] of Object.entries(period)) exporting[`prd${key}`] = box(String(value));
      for (const [key, value] of Object.entries(extra)) exporting[key] = box(value);
      try {
        await abap.FunctionModules.JOB_CLOSE({exporting, importing: {job_was_released: released}});
        answer.subrc = 0;
      } catch (error) {
        if (error.classic === undefined) throw error;
        answer.subrc = String(error.classic).toUpperCase();
        answer.msgid = abap.builtin.sy.get().msgid.get().trim();
        answer.msgno = String(abap.builtin.sy.get().msgno.get()).trim();
      }
      answer.released = released.get();
    });
    w.counts[job] ??= answer.count;
    return answer;
  }

  const status = async (name, count) => {
    const flags = await dialogStep(async () => {
      const out = Object.fromEntries(["preliminary", "scheduled", "ready", "running", "finished", "aborted"]
        .map((key) => [key, new abap.types.String()]));
      await abap.FunctionModules.SHOW_JOBSTATE({exporting: {jobname: box(name), jobcount: box(count)}, importing: out});
      return Object.fromEntries(Object.entries(out).map(([key, value]) => [key, value.get()]));
    });
    return {preliminary: "P", scheduled: "S", ready: "Y", running: "R", finished: "F", aborted: "A"}[
      Object.keys(flags).find((key) => flags[key] === "X")];
  };
  const header = async (name, count) => dialogStep(async () => {
    const head = jobHeaderType(abap);
    await abap.FunctionModules.BP_JOB_READ({exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
      job_read_opcode: new abap.types.Integer().set(19)}, importing: {job_read_jobhead: head}});
    return head.get();
  });
  const selected = async (name) => dialogStep(async () => {
    const jobs = table(jobHeaderType(abap));
    const selector = new abap.types.Structure({
      jobname: new abap.types.Character(32).set(name), jobcount: new abap.types.Character(8),
      jobgroup: new abap.types.Character(12), username: new abap.types.Character(12),
      from_date: new abap.types.Date(), from_time: new abap.types.Time(),
      to_date: new abap.types.Date(), to_time: new abap.types.Time(),
      no_date: new abap.types.Character(1), with_pred: new abap.types.Character(1),
      eventid: new abap.types.Character(32), eventparm: new abap.types.Character(64),
      prelim: new abap.types.Character(1), schedul: new abap.types.Character(1),
      ready: new abap.types.Character(1), running: new abap.types.Character(1),
      finished: new abap.types.Character(1), aborted: new abap.types.Character(1),
      abapname: new abap.types.Character(40),
    });
    await abap.FunctionModules.BP_JOB_SELECT({exporting: {jobselect_dialog: box("N"), jobsel_param_in: selector},
      tables: {jobselect_joblist: jobs}});
    return jobs.array().map((row) => row.get());
  });
  const deleteJob = async (name, count) => dialogStep(async () => {
    try {
      await abap.FunctionModules.BP_JOB_DELETE({exporting: {jobname: box(name), jobcount: box(count)}});
      return 0;
    } catch (error) {
      if (error.classic === undefined) throw error;
      return String(error.classic).toUpperCase();
    }
  });

  function expectHeader(w, head, expected) {
    for (const [key, value] of Object.entries(expected)) {
      if (key === "sdl") {
        const stamp = String(head.sdlstrtdt.get()) + String(head.sdlstrttm.get());
        if (value === null) expect(stamp.replace(/[0 ]/g, ""), "SDLSTRTDT/TM").to.equal("");
        else expect(stamp, "SDLSTRTDT/TM").to.equal(w.at(value));
      } else {
        expect(String(head[key].get()).trim(), key.toUpperCase()).to.equal(value);
      }
    }
  }

  async function check(w, expected, what) {
    for (const [kind, jobs] of Object.entries(expected)) {
      if (["subrc", "released", "sy-msgid", "sy-msgno", "status", "header"].includes(kind) && what.close) continue;
      for (const [job, value] of Object.entries(jobs)) {
        if (kind === "instances") expect(w.instances(job), `${what.id}: instances of ${job}`).to.deep.equal(value);
        else if (kind === "instancePrefix") {
          expect(w.instances(job).slice(0, value.length), `${what.id}: first instances of ${job}`).to.deep.equal(value);
          const all = w.instances(job);
          for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1], `${what.id}: no skipped instance`).to.equal(60);
        } else if (kind === "waiting") expect(w.waiting(job), `${what.id}: waiting ${job}`).to.deep.equal(value);
        else if (kind === "aborted") expect(w.aborted(job), `${what.id}: aborted ${job}`).to.deep.equal(value);
        else if (kind === "status") {
          expect(await status(w.name(job), w.counts[job]), `${what.id}: status of ${job}`).to.equal(value);
        } else if (kind === "successorCount") {
          // jobs, not values: the successor of the first instance
          const [first, next] = w.runs(job);
          expect(next.job_count, `${what.id}: a successor of its own`).to.match(/^\d{8}$/).and.not.equal(first.job_count);
          expect(next.chain_pred).to.equal(first.id);
        }
      }
    }
  }
  // "successorCount": "new" applies to every job the step names in "waiting"
  const normalised = (expected) => expected.successorCount === undefined ? expected :
    {...expected, successorCount: Object.fromEntries(Object.keys(expected.waiting ?? {}).map((job) => [job, true]))};

  for (const fixture of contract.cases) {
    it(`${fixture.id} (EXPECT ${fixture.EXPECT}): ${fixture.title}`, async () => {
      let w;
      const execute = fixture.runSeconds || fixture.aborts ? async () => {
        const running = w.store.db.prepare("SELECT sdl_at FROM batch_runs WHERE state = 'RUNNING'").get();
        if (fixture.aborts?.includes(w.offset(running.sdl_at))) throw new Error("instance aborted");
        // the instance runs runSeconds on the clock, for the first ten minutes
        if (fixture.runSeconds && w.clock.now() < w.t0 + 600 * 1000) w.clock.set(w.clock.now() + fixture.runSeconds * 1000);
        return {status: "COMPLETED"};
      } : fixture.id === "time-base" ? undefined : async () => ({status: "COMPLETED"});
      w = world(fixture.clock, {execute});
      for (const step of fixture.steps) {
        const expected = normalised(step.expect ?? {});
        if (step.close) {
          const report = fixture.id === "time-base" ? "ZOSD_JOB_TICK" : "ZGG_EX_012";
          const closed = await close(w, step.close, {start: step.start, last: step.last,
            period: step.period, report});
          if ("subrc" in expected) expect(closed.subrc, `${fixture.id}: JOB_CLOSE`).to.equal(expected.subrc);
          if ("released" in expected) expect(closed.released, `${fixture.id}: JOB_WAS_RELEASED`).to.equal(expected.released);
          if ("sy-msgid" in expected) expect(closed.msgid).to.equal(expected["sy-msgid"]);
          if ("sy-msgno" in expected) expect(closed.msgno).to.equal(expected["sy-msgno"]);
          const name = w.name(step.close);
          if (expected.status) expect(await status(name, closed.count), `${fixture.id}: status after close`).to.equal(expected.status);
          if (expected.header) {
            const [row] = (await selected(name)).filter((item) => item.jobcount.get() === closed.count);
            expect(row, "BP_JOB_SELECT finds the job").to.exist;
            expect(row.status.get()).to.equal(expected.status);
            expectHeader(w, row, expected.header);
            if (expected.status === "S") expectHeader(w, await header(name, closed.count), expected.header);
          }
          await w.scheduler.tick(); // the host's poll: import, and arm the timer
          // still waiting once imported, unless its time has come already
          if (expected.status === "S" && expected.header?.sdl > 0) {
            expect(await status(name, closed.count), `${fixture.id}: status once imported`).to.equal("S");
            expectHeader(w, await header(name, closed.count), expected.header ?? {});
          }
          await check(w, expected, {id: fixture.id, close: true});
        } else if (step.tick !== undefined) {
          w.clock.set(w.clock.now() + step.tick * 1000);
          await w.scheduler.tick();
          await check(w, expected, {id: fixture.id});
        } else if (step.advance !== undefined) {
          await w.clock.advance(step.advance * 1000);
          await check(w, expected, {id: fixture.id});
        } else if (step.delete) {
          const [target] = w.runs(step.delete, "state = 'WAITING'");
          expect(await deleteJob(w.name(step.delete), target.job_count)).to.equal(expected.subrc);
          await check(w, expected, {id: fixture.id});
        } else if (step.down !== undefined) {
          w.scheduler.stop();
          w.clock.set(w.clock.now() + step.down * 1000);
        } else if (step.hostStart) {
          await w.hostStart();
          await check(w, expected, {id: fixture.id});
        } else throw new Error(`unknown step ${JSON.stringify(step)}`);
      }
      if (fixture.id === "time-base") {
        // the report ran with ABAP's clock at the scheduled time
        expect(readBusiness("SELECT param FROM zosd_job_seen WHERE run_id = 'PERIODIC_TICK'")
          .map((row) => row.param.trim())).to.include(w.at(60));
      }
      w.scheduler.stop();
    });
  }

  it("runs every timer start as a dialog step: a dumping instance rolls back its write", async () => {
    const w = world("2026-10-01T23:00:01Z");
    const closed = await close(w, "DUMP", {start: 30, period: {mins: 5}, report: "ZOSD_JOB_DUMP"});
    expect(closed.subrc).to.equal(0);
    await w.scheduler.tick();
    await w.clock.advance(30 * 1000);
    expect(w.aborted("DUMP")).to.deep.equal([30]);
    expect(await status(w.name("DUMP"), closed.count)).to.equal("A");
    // the next step commits whatever the dump left on the connection
    await dialogStep(async () => client.commit());
    expect(readBusiness("SELECT run_id FROM zosd_job_seen WHERE run_id = 'PERIODIC_DUMP'")).to.deep.equal([]);
    expect(w.waiting("DUMP")).to.deep.equal([330]);
    w.scheduler.stop();
  });

  it("starts an overdue instance once across a crash between its successor and its release", async () => {
    const w = world("2026-10-01T23:10:01Z", {execute: async () => ({status: "COMPLETED"})});
    await close(w, "CRASH", {start: 60, period: {mins: 2}});
    await w.scheduler.tick();
    w.scheduler.stop();
    w.clock.set(w.clock.now() + 200 * 1000);
    // the host dies after the successor is made and before the release
    const release = w.store.releaseTimed.bind(w.store);
    w.store.releaseTimed = () => { throw new Error("host stopped"); };
    try { await w.scheduler.releaseDue(); throw new Error("release did not fail"); }
    catch (error) { expect(error.message).to.equal("host stopped"); }
    w.store.releaseTimed = release;
    expect(w.runs("CRASH").length).to.equal(2);
    await w.hostStart();
    await w.hostStart();
    expect(w.instances("CRASH")).to.deep.equal([60, 180]);
    expect(w.waiting("CRASH")).to.deep.equal([300]);
    const started = w.store.db.prepare(`SELECT r.sdl_at, COUNT(*) AS n FROM batch_job_log l
      JOIN batch_runs r ON r.id = l.run_id WHERE r.job_name = ? AND l.event_code = 'STEP_STARTED'
      GROUP BY r.sdl_at ORDER BY r.sdl_at`).all(w.name("CRASH"));
    expect(started.map((row) => [w.offset(row.sdl_at), row.n])).to.deep.equal([[60, 1], [180, 1]]);
    expect(new Set(w.runs("CRASH").map((run) => run.job_count)).size).to.equal(3);
    w.scheduler.stop();
  });

  it("does not start an instance whose latest start passed while it waited, and keeps the chain", async () => {
    const w = world("2026-10-01T23:20:01Z", {execute: async () => ({status: "COMPLETED"})});
    const closed = await close(w, "LATE", {start: 60, last: 90, period: {mins: 2}});
    expect(closed.subrc).to.equal(0);
    const head = await header(w.name("LATE"), closed.count);
    expectHeader(w, head, {laststrtdt: w.at(90).slice(0, 8), laststrttm: w.at(90).slice(8)});
    await w.scheduler.tick();
    w.scheduler.stop();
    w.clock.set(w.clock.now() + 100 * 1000);
    await w.scheduler.tick();
    const [first] = w.runs("LATE");
    expect([first.state, first.result_status, first.started_at]).to.deep.equal(["FAILED", "EXPIRED", ""]);
    expect(await status(w.name("LATE"), closed.count)).to.equal("A");
    const [, next] = w.runs("LATE");
    expect([w.offset(next.sdl_at), w.offset(next.last_at), next.state]).to.deep.equal([180, 210, "WAITING"]);
    w.scheduler.stop();
  });

  it("keeps refusing the unsupported JOB_CLOSE start conditions and answers BP_JOB_DELETE's refusals", async () => {
    const w = world("2026-10-01T23:30:01Z", {execute: async () => ({status: "COMPLETED"})});
    for (const [options, code] of [
      [{start: 60, period: {months: 1}}, "JOB_CLOSE_FAILED"],
      [{period: {mins: 5}, extra: {strtimmed: "X"}}, "JOB_CLOSE_FAILED"],
      [{start: 60, extra: {strtimmed: "X"}}, "JOB_CLOSE_FAILED"],
      [{start: 60, extra: {event_id: "OSD_SIGNAL"}}, "JOB_CLOSE_FAILED"],
      [{start: 60, extra: {event_periodic: "X"}}, "JOB_CLOSE_FAILED"],
      [{start: 60, extra: {calendar_id: "01"}}, "JOB_CLOSE_FAILED"],
      [{start: 60, extra: {targetsystem: "OTHER"}}, "INVALID_TARGET"],
      [{start: 60, extra: {at_opmode: "DAY"}}, "JOB_CLOSE_FAILED"],
      [{start: 60, last: 30}, "INVALID_STARTDATE"],
      [{last: 60}, "INVALID_STARTDATE"],
    ]) {
      const closed = await close(w, "REFUSE", options);
      expect(closed.subrc, JSON.stringify(options)).to.equal(code);
      expect(closed.released).to.equal("");
      expect(await status(w.name("REFUSE"), closed.count)).to.equal("P");
    }
    // initial typed date and time fields are no start time
    const zeros = await close(w, "ZEROS", {extra: {strtimmed: "X", sdlstrtdt: "00000000",
      sdlstrttm: "000000", laststrtdt: "00000000", laststrttm: "000000"}});
    expect([zeros.subrc, zeros.released]).to.deep.equal([0, "X"]);
    expect(await status(w.name("ZEROS"), zeros.count)).to.equal("Y");
    expect(await deleteJob(w.name("NOBODY"), "00000001")).to.equal("JOB_DOES_NOT_EXIST");
    const once = await close(w, "ONCE", {start: 60});
    // still in the outbox: the delete waits for the import
    expect(await deleteJob(w.name("ONCE"), once.count)).to.equal("CANT_DELETE_JOB");
    await w.scheduler.tick();
    expect(await deleteJob(w.name("ONCE"), once.count)).to.equal(0);
    expect(await status(w.name("ONCE"), once.count).catch((error) => String(error.classic))).to.match(/job_notex/i);
    expect(await deleteJob(w.name("ONCE"), once.count)).to.equal("JOB_DOES_NOT_EXIST");
    await w.clock.advance(120 * 1000);
    expect(w.instances("ONCE")).to.deep.equal([]);
    w.scheduler.stop();
  });
  const done = async () => ({status: "COMPLETED"});
  const identities = (intentId) => readBusiness(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
    WHERE TRIM(intent_id) = ? ORDER BY jobcount`, intentId).map((row) => row.count);
  const writeBusiness = (work) => {
    const db = new DatabaseSync(dbPath);
    try { db.exec("PRAGMA busy_timeout=5000"); return work(db); } finally { db.close(); }
  };

  it("runs only its own source's timed jobs when two business databases share the operations store", async () => {
    const w = world("2026-10-01T23:40:01Z", {execute: done});
    await close(w, "MINE", {start: 60, period: {mins: 2}});
    await w.scheduler.tick();
    // a second business database: the same tables, another source instance
    const other = join(dir, `other-${worlds}.sqlite`);
    writeBusiness((db) => db.exec(`VACUUM INTO '${other}'`));
    const copy = new DatabaseSync(other);
    try {
      copy.exec("DELETE FROM zosd_job_outbox; DELETE FROM zosd_job_step");
      copy.prepare("UPDATE zosd_job_source_instance SET id = ?").run(randomBytes(16).toString("hex"));
    } finally { copy.close(); }
    const sy = abap.builtin.sy.get();
    w.store.importIntent({intentId: randomBytes(16).toString("hex"), sourceDb: resolve(other),
      client: sy.mandt.get().trim(), sysid: sy.sysid.get().trim(), owner: user(),
      jobname: w.name("THEIRS"), jobcount: "00000042", program: "ZGG_EX_012",
      generation: abap.context.osdGeneration ?? liveGeneration(root),
      steps: [{number: 1, program: "ZGG_EX_012", input: []}],
      schedule: {start: w.at(60), last: "", period: {mins: 2, hours: 0, days: 0, weeks: 0}}});
    w.clock.set(w.clock.now() + 60 * 1000);
    await w.scheduler.tick(); // this source's worker: its job runs, the other's is left alone
    expect([w.instances("MINE"), w.waiting("MINE")]).to.deep.equal([[60], [180]]);
    expect([w.instances("THEIRS"), w.waiting("THEIRS")]).to.deep.equal([[], [60]]);
    const theirs = new FileSqliteClient({path: other});
    await theirs.connect();
    const ours = abap.context.databaseConnections.DEFAULT;
    abap.context.databaseConnections.DEFAULT = theirs;
    try {
      const worker = new JobScheduler({root, store: w.store, env: process.env, clock: w.clock, execute: done});
      await worker.tick(); // the other source's worker
      worker.stop();
    } finally {
      abap.context.databaseConnections.DEFAULT = ours;
      await theirs.disconnect();
    }
    expect([w.instances("THEIRS"), w.waiting("THEIRS")]).to.deep.equal([[60], [180]]);
    expect([w.instances("MINE"), w.waiting("MINE")]).to.deep.equal([[60], [180]]);
    const [, successor] = w.runs("THEIRS");
    const reader = new DatabaseSync(other, {readOnly: true});
    try {
      expect(reader.prepare("SELECT TRIM(jobcount) AS count FROM zosd_job_identity WHERE TRIM(intent_id) = ?")
        .all(successorIntentId(w.runs("THEIRS")[0].id)).map((row) => row.count)).to.deep.equal([successor.job_count]);
    } finally { reader.close(); }
    w.clock.set(w.clock.now() + 120 * 1000);
    await w.scheduler.tick();
    expect(w.instances("MINE")).to.deep.equal([60, 180]);
    expect(w.instances("THEIRS")).to.deep.equal([60]);
    w.scheduler.stop();
  });

  it("ends two workers racing for one successor with one successor and one count", async () => {
    const w = world("2026-10-01T23:50:01Z", {execute: done});
    await close(w, "RACE", {start: 60, period: {mins: 2}});
    await w.scheduler.tick();
    w.clock.set(w.clock.now() + 60 * 1000);
    const [run] = w.store.dueTimed(w.at(60), workerSource());
    const intentId = successorIntentId(run.id);
    const second = new JobScheduler({root, store: w.store, env: process.env, clock: w.clock,
      execute: done, candidate: () => 33333333});
    // the first worker has read "no successor yet"; the second reserves in between,
    // on a connection of its own, before either has imported
    let theirs;
    w.scheduler.candidate = () => 11111111;
    w.scheduler.beforeReserve = () => writeBusiness((db) => {
      theirs = reserveSuccessorCount(db, {client: run.source_client, jobname: run.job_name,
        owner: run.source_owner, intentId}, {candidate: () => 22222222});
    });
    await w.scheduler.ensureSuccessor(run);
    w.scheduler.beforeReserve = undefined;
    await second.ensureSuccessor(run);
    expect(theirs).to.equal("22222222");
    expect(identities(intentId)).to.deep.equal(["22222222"]);
    expect(w.runs("RACE").map((item) => item.job_count).slice(1)).to.deep.equal(["22222222"]);
    await w.scheduler.tick();
    w.clock.set(w.clock.now() + 120 * 1000);
    await w.scheduler.tick();
    expect([w.instances("RACE"), w.waiting("RACE")]).to.deep.equal([[60, 180], [300]]);
    second.stop();
    w.scheduler.stop();
  });

  it("converges on one count when a stale losing identity is left from an earlier crash", async () => {
    const w = world("2026-10-02T00:00:01Z", {execute: done});
    await close(w, "STALE", {start: 60, period: {mins: 2}});
    await w.scheduler.tick();
    w.scheduler.stop();
    w.clock.set(w.clock.now() + 60 * 1000);
    const [run] = w.store.dueTimed(w.at(60), workerSource());
    const intentId = successorIntentId(run.id);
    const stale = (...counts) => writeBusiness((db) => {
      db.exec("DROP INDEX IF EXISTS zosd_job_identity_intent");
      for (const count of counts) {
        db.prepare(`INSERT INTO zosd_job_identity (mandt, jobname, jobcount, owner, intent_id)
          VALUES (?, ?, ?, ?, ?)`).run(run.source_client, run.job_name, count, run.source_owner, intentId);
      }
    });
    stale("00000009", "00000003"); // two workers reserved before this fix, neither imported
    await w.hostStart();
    expect(identities(intentId)).to.deep.equal(["00000003"]);
    expect(w.runs("STALE").map((item) => item.job_count).slice(1)).to.deep.equal(["00000003"]);
    stale("00000001"); // a loser beside an imported winner: the import decides, not the lower count
    w.clock.set(w.clock.now() + 120 * 1000);
    await w.scheduler.tick();
    expect(identities(intentId)).to.deep.equal(["00000003"]);
    expect([w.instances("STALE"), w.waiting("STALE")]).to.deep.equal([[60, 180], [300]]);
    w.scheduler.stop();
  });
  it("ends the chain when BP_JOB_DELETE commits between the due read and the successor", async () => {
    const w = world("2026-10-02T00:10:01Z", {execute: done});
    const closed = await close(w, "DELRACE", {start: 60, period: {mins: 2}});
    await w.scheduler.tick();
    w.clock.set(w.clock.now() + 60 * 1000);
    w.scheduler.afterDueRead = async (run) => {
      expect(await deleteJob(run.job_name, run.job_count)).to.equal(0);
    };
    await w.scheduler.tick();
    w.scheduler.afterDueRead = undefined;
    expect(w.runs("DELRACE").map((run) => run.state)).to.deep.equal(["DELETED"]);
    expect(await status(w.name("DELRACE"), closed.count).catch((error) => String(error.classic))).to.match(/job_notex/i);
    await w.clock.advance(900 * 1000);
    expect([w.instances("DELRACE"), w.waiting("DELRACE"), w.runs("DELRACE").length]).to.deep.equal([[], [], 1]);
    w.scheduler.stop();
  });

  it("recovers a crash while the instance is RELEASING to one successor and one release", async () => {
    const w = world("2026-10-02T00:20:01Z", {execute: done});
    const closed = await close(w, "RELCRASH", {start: 60, period: {mins: 2}});
    await w.scheduler.tick();
    w.scheduler.stop();
    w.clock.set(w.clock.now() + 60 * 1000);
    // the host dies after the decision, before the successor is made
    w.scheduler.ensureSuccessor = async () => { throw new Error("host stopped"); };
    try { await w.scheduler.releaseDue(); throw new Error("release did not fail"); }
    catch (error) { expect(error.message).to.equal("host stopped"); }
    expect(w.runs("RELCRASH").map((run) => run.state)).to.deep.equal(["RELEASING"]);
    // it reads as S, and a delete is refused like a running job's
    expect(await status(w.name("RELCRASH"), closed.count)).to.equal("S");
    expect(await deleteJob(w.name("RELCRASH"), closed.count)).to.equal("JOB_IS_ALREADY_RUNNING");
    await w.hostStart();
    await w.hostStart();
    expect([w.instances("RELCRASH"), w.waiting("RELCRASH")]).to.deep.equal([[60], [180]]);
    const started = w.store.db.prepare(`SELECT COUNT(*) AS n FROM batch_job_log l JOIN batch_runs r ON r.id = l.run_id
      WHERE r.job_name = ? AND l.event_code = 'STEP_STARTED'`).get(w.name("RELCRASH")).n;
    expect(started).to.equal(1);
    expect(identities(successorIntentId(w.runs("RELCRASH")[0].id))).to.have.length(1);
    w.scheduler.stop();
  });
  it("starts a job overdue after a two-day stop once and puts its successor on the first future slot of its phase", async () => {
    const w = world("2026-10-02T01:00:01Z", {execute: done});
    await close(w, "GAP", {start: 60, period: {mins: 1}});
    await w.scheduler.tick();
    w.scheduler.stop();
    w.clock.set(w.clock.now() + 2 * 24 * 3600 * 1000); // T0 + 172800 s
    await w.hostStart();
    expect([w.instances("GAP"), w.waiting("GAP"), w.runs("GAP").length]).to.deep.equal([[60], [172860], 2]);
    await w.hostStart();
    expect([w.instances("GAP"), w.waiting("GAP"), w.runs("GAP").length]).to.deep.equal([[60], [172860], 2]);
    // up again: the next slots run one by one, as measured
    w.clock.set(w.clock.now() + 120 * 1000);
    await w.scheduler.tick();
    expect([w.instances("GAP"), w.waiting("GAP")]).to.deep.equal([[60, 172860, 172920], [172980]]);
    w.scheduler.stop();
  });

  it("keeps the slot decided at host start when a crash interrupts the release", async () => {
    const w = world("2026-10-02T02:00:01Z", {execute: done});
    await close(w, "GAPCRASH", {start: 60, period: {mins: 1}});
    await w.scheduler.tick();
    w.scheduler.stop();
    w.clock.set(w.clock.now() + 2 * 24 * 3600 * 1000);
    // host start, the decision is taken, and the host dies before the successor
    const crashing = new JobScheduler({root, store: w.store, env: process.env, clock: w.clock, execute: done});
    crashing.ensureSuccessor = async () => { throw new Error("host stopped"); };
    try { await crashing.start(); throw new Error("start did not fail"); }
    catch (error) { expect(error.message).to.equal("host stopped"); }
    crashing.stop();
    expect(w.runs("GAPCRASH").map((run) => run.state)).to.deep.equal(["RELEASING"]);
    w.clock.set(w.clock.now() + 300 * 1000); // restarted five minutes later
    await w.hostStart();
    const runs = w.runs("GAPCRASH");
    // the successor is where the first host start put it, not recomputed from the restart
    expect(runs.map((run) => w.offset(run.sdl_at)).slice(0, 2)).to.deep.equal([60, 172860]);
    expect(runs[1].chain_pred).to.equal(runs[0].id);
    expect(runs.filter((run) => run.chain_pred === runs[0].id)).to.have.length(1);
    // that successor was itself overdue at the restart: it started once, and skipped on
    expect([w.instances("GAPCRASH"), w.waiting("GAPCRASH")]).to.deep.equal([[60, 172860], [173160]]);
    w.scheduler.stop();
  });
});
