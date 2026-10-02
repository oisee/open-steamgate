// BP_JOB_DELETE of a job that is not imported yet: the sandbox measurements
// of 2026-10-02 as fixtures (test/fixtures/job-delete/contract.json,
// EXPECT = A4H), driven through the real ABAP facade and the scheduler, and
// the races between a delete and a worker's outbox drain.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";
import {dialogStep, outsideStepContext} from "../tools/osd-dialog-step.mjs";
import {JobScheduler, installAbapClock, manualClock} from "../tools/osd-job-scheduler.mjs";
import {drainJobOutbox} from "../tools/osd-job-outbox.mjs";
import {msStamp} from "../tools/osd-job-schedule.mjs";

const root = resolve(".");
const contract = JSON.parse(readFileSync(join(root, "test/fixtures/job-delete/contract.json"), "utf8"));

describe("BP_JOB_DELETE of a job still in the outbox or in the caller's LUW", function () {
  this.timeout(120000);
  let dir, dbPath, beforeEnv, priorAbap, priorContext, abap, client, restoreClock;
  const box = (value = "") => new abap.types.String().set(value);
  const user = () => abap.builtin.sy.get().uname.get().trim();
  const readBusiness = (sql, ...args) => {
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try { return db.prepare(sql).all(...args); } finally { db.close(); }
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-job-delete-"));
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
  function world(start = "2026-10-02T10:00:01Z") {
    worlds += 1;
    const clock = manualClock(start);
    restoreClock?.();
    restoreClock = installAbapClock(abap, clock);
    process.env.OSD_OPERATIONS_DB = join(dir, `operations-${worlds}.sqlite`);
    const w = {clock, prefix: `D${worlds}_`, counts: {}, ran: {}};
    w.store = new BatchRuns(root, process.env);
    w.execute = async () => {
      const running = w.store.db.prepare("SELECT job_name FROM batch_runs WHERE state = 'RUNNING'").get();
      w.ran[running.job_name] = (w.ran[running.job_name] ?? 0) + 1;
      return {status: "COMPLETED"};
    };
    w.scheduler = new JobScheduler({root, store: w.store, env: process.env, clock, execute: w.execute});
    w.name = (job) => w.prefix + job;
    w.at = (seconds) => msStamp(clock.now() + seconds * 1000);
    w.rows = (job) => {
      const count = w.counts[job];
      const ids = readBusiness(`SELECT intent_id FROM zosd_job_identity WHERE jobname = ? AND jobcount = ?`,
        w.name(job), count);
      return {
        identity: ids.length,
        outbox: readBusiness("SELECT COUNT(*) AS n FROM zosd_job_outbox WHERE jobname = ? AND jobcount = ?",
          w.name(job), count)[0].n,
        steps: readBusiness(`SELECT COUNT(*) AS n FROM zosd_job_step s JOIN zosd_job_outbox o
          ON o.mandt = s.mandt AND o.intent_id = s.intent_id WHERE o.jobname = ? AND o.jobcount = ?`,
          w.name(job), count)[0].n,
      };
    };
    w.runs = (job) => w.store.db.prepare("SELECT state FROM batch_runs WHERE job_name = ? ORDER BY rowid")
      .all(w.name(job)).map((run) => run.state);
    return w;
  }

  // the operations of one program run, in its own dialog step
  async function open(w, job) {
    const count = new abap.types.String();
    await abap.FunctionModules.JOB_OPEN({exporting: {jobname: box(w.name(job))}, importing: {jobcount: count}});
    w.counts[job] = count.get();
  }
  async function close(w, job, {start, immediate, after} = {}) {
    await open(w, job);
    const exporting = {jobname: box(w.name(job)), jobcount: box(w.counts[job])};
    await abap.FunctionModules.JOB_SUBMIT({exporting: {...exporting, report: box("ZGG_EX_012"),
      authcknam: box(user())}});
    if (start !== undefined) {
      exporting.sdlstrtdt = box(w.at(start).slice(0, 8));
      exporting.sdlstrttm = box(w.at(start).slice(8));
    }
    if (immediate) exporting.strtimmed = box("X");
    if (after) {
      exporting.pred_jobname = box(w.name(after));
      exporting.pred_jobcount = box(w.counts[after]);
      exporting.predjob_checkstat = box("X"); // required here, not on the sandbox (job-standard-facade)
    }
    await abap.FunctionModules.JOB_CLOSE({exporting});
  }
  async function del(w, job, {count, commitmode} = {}) {
    const exporting = {jobname: box(w.name(job)), jobcount: box(count ?? w.counts[job])};
    if (commitmode !== undefined) exporting.commitmode = box(commitmode);
    try {
      await abap.FunctionModules.BP_JOB_DELETE({exporting});
      return 0;
    } catch (error) {
      if (error.classic === undefined) throw error;
      return String(error.classic).toUpperCase();
    }
  }
  const deleteJob = (w, job, options) => dialogStep(() => del(w, job, options));
  const status = (w, job) => dialogStep(async () => {
    const out = Object.fromEntries(["preliminary", "scheduled", "ready", "running", "finished", "aborted"]
      .map((key) => [key, new abap.types.String()]));
    try {
      await abap.FunctionModules.SHOW_JOBSTATE({exporting: {jobname: box(w.name(job)),
        jobcount: box(w.counts[job])}, importing: out});
    } catch (error) {
      if (/job_notex/i.test(String(error.classic))) return "none";
      throw error;
    }
    const flags = Object.fromEntries(Object.entries(out).map(([key, value]) => [key, value.get()]));
    return {preliminary: "P", scheduled: "S", ready: "Y", running: "R", finished: "F", aborted: "A"}[
      Object.keys(flags).find((key) => flags[key] === "X")];
  });

  for (const fixture of contract.cases) {
    it(`${fixture.id} (EXPECT ${fixture.EXPECT}): ${fixture.title}`, async function () {
      if (fixture.blocked) this.skip(); // see the fixture's "blocked"
      const w = world();
      for (const entry of fixture.steps) {
        if (entry.step) {
          const answers = await dialogStep(async () => {
            const got = [];
            for (const op of entry.step) {
              if (op.close) await close(w, op.close, op);
              else if (op.open) await open(w, op.open);
              else if (op.sentinel) await open(w, op.sentinel);
              else if (op.commit) await abap.statements.commit();
              else if (op.rollback) await abap.statements.rollback();
              else if (op.delete) got.push([op, await del(w, op.delete, op)]);
            }
            return got;
          });
          for (const [op, answer] of answers) {
            expect(answer, `${fixture.id}: BP_JOB_DELETE ${op.delete}`).to.equal(op.expect);
          }
        }
        if (entry.drain) await w.scheduler.tick();
        if (entry.advance) {
          w.clock.set(w.clock.now() + entry.advance * 1000);
          await w.scheduler.tick();
        }
        for (const [job, expected] of Object.entries(entry.status ?? {})) {
          expect(await status(w, job), `${fixture.id}: status of ${job}`).to.equal(expected);
        }
        for (const [job, expected] of Object.entries(entry.ran ?? {})) {
          expect(w.ran[w.name(job)] ?? 0, `${fixture.id}: runs of ${job}`).to.equal(expected);
        }
      }
      // a deleted job leaves no business row behind
      for (const [job, count] of Object.entries(w.counts)) {
        if (count && await status(w, job) === "none") {
          expect(w.rows(job), `${fixture.id}: rows of ${job}`).to.deep.equal({identity: 0, outbox: 0, steps: 0});
        }
      }
      w.scheduler.stop();
    });
  }

  it("deletes a job whose import landed while the delete waited for the work process (delete during a drain)", async () => {
    const w = world();
    await dialogStep(() => close(w, "RACE1", {start: 3600}));
    let pendingDelete;
    await drainJobOutbox(w.store, {env: process.env, afterImport: async () => {
      // the drain holds the work process: the delete queues behind it
      pendingDelete = outsideStepContext(() => deleteJob(w, "RACE1"));
    }});
    expect(await pendingDelete).to.equal(0);
    expect(w.runs("RACE1")).to.deep.equal(["DELETED"]);
    expect(w.rows("RACE1")).to.deep.equal({identity: 0, outbox: 0, steps: 0});
    w.clock.set(w.clock.now() + 7200 * 1000);
    await w.scheduler.tick();
    expect([w.ran[w.name("RACE1")] ?? 0, w.runs("RACE1")]).to.deep.equal([0, ["DELETED"]]);
    w.scheduler.stop();
  });

  it("gives a drain that starts during the delete nothing to import", async () => {
    const w = world();
    await dialogStep(() => close(w, "RACE2", {start: 3600}));
    let release, drained;
    const held = new Promise((resolve) => { release = resolve; });
    const step = dialogStep(async () => {
      const answer = await del(w, "RACE2", {commitmode: ""});
      // the drain asks for the work process while this step still has it
      drained = outsideStepContext(() => drainJobOutbox(w.store, {env: process.env}));
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();
      return answer;
    });
    await held;
    expect(await step).to.equal(0);
    expect(await drained).to.deep.equal({imported: 0});
    expect(w.runs("RACE2")).to.deep.equal([]);
    expect(w.rows("RACE2")).to.deep.equal({identity: 0, outbox: 0, steps: 0});
    w.clock.set(w.clock.now() + 7200 * 1000);
    await w.scheduler.tick();
    expect(w.ran[w.name("RACE2")] ?? 0).to.equal(0);
    w.scheduler.stop();
  });

  it("deletes an imported job whose outbox acknowledgement did not land, and the next drain has nothing half to acknowledge", async () => {
    const w = world();
    await dialogStep(() => close(w, "HALF", {start: 3600}));
    // the worker dies after the import, before it acknowledges the outbox
    await drainJobOutbox(w.store, {env: process.env, afterImport: async () => { throw new Error("worker stopped"); }})
      .then(() => { throw new Error("the drain should have stopped"); }, (error) => expect(error.message).to.equal("worker stopped"));
    expect(w.runs("HALF")).to.deep.equal(["WAITING"]);
    expect(w.rows("HALF")).to.deep.equal({identity: 1, outbox: 1, steps: 1});
    expect(await deleteJob(w, "HALF")).to.equal(0);
    expect(w.runs("HALF")).to.deep.equal(["DELETED"]);
    expect(w.rows("HALF")).to.deep.equal({identity: 0, outbox: 0, steps: 0});
    expect(await drainJobOutbox(w.store, {env: process.env})).to.deep.equal({imported: 0});
    w.clock.set(w.clock.now() + 7200 * 1000);
    await w.scheduler.tick();
    expect([w.ran[w.name("HALF")] ?? 0, w.runs("HALF")]).to.deep.equal([0, ["DELETED"]]);
    w.scheduler.stop();
  });
});
