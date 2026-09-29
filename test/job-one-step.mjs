import {expect} from "chai";
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {spawn, spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {BatchRuns, liveGeneration, runConvertedBatch, workQueuedBatch} from "../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../tools/osd-job-outbox.mjs";
import {dialogStep, exclusive} from "../tools/osd-dialog-step.mjs";
import {applyRuntimeHotSwap} from "../tools/osd-hot.mjs";

const root = resolve(".");

describe("one-step standard JOB_* facade and committed outbox", function () {
  this.timeout(120000);
  let dir, dbPath, envBefore, abapBefore, contextBefore, abap, client, store;
  const box = (value = "") => new abap.types.String().set(value);
  const invoke = async (name, input, outputs = []) => {
    const importing = Object.fromEntries(outputs.map((key) => [key, box()]));
    await abap.FunctionModules[name]({
      exporting: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, box(value)])),
      importing,
    });
    return Object.fromEntries(Object.entries(importing).map(([key, value]) => [key, value.get()]));
  };
  const open = async (name = "OSD_ONE_STEP") =>
    (await invoke("JOB_OPEN", {jobname: name}, ["jobcount"])).jobcount;
  const submit = (count, options = {}) => invoke("JOB_SUBMIT", {
    jobname: "OSD_ONE_STEP", jobcount: count, report: "ZGG_EX_012", ...options,
  });
  const close = (count, options = {}) => invoke("JOB_CLOSE", {
    jobname: "OSD_ONE_STEP", jobcount: count, strtimmed: "X", ...options,
  }, ["job_was_released"]);
  const schedule = () => dialogStep(async () => {
    const count = await open();
    await submit(count);
    expect((await close(count)).job_was_released).to.equal("X");
  }, "schedule one report");
  const rows = () => {
    const reader = new DatabaseSync(dbPath, {readOnly: true});
    try { return reader.prepare("SELECT * FROM zosd_job_outbox").all(); }
    finally { reader.close(); }
  };
  const stepRows = () => {
    const reader = new DatabaseSync(dbPath, {readOnly: true});
    try { return reader.prepare("SELECT * FROM zosd_job_step").all(); }
    finally { reader.close(); }
  };
  const classic = async (work, name) => {
    try { await work(); } catch (error) {
      expect(String(error.classic ?? error.message).toLowerCase()).to.include(name.toLowerCase());
      return;
    }
    throw new Error(`expected ${name}`);
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-job-one-step-"));
    dbPath = join(dir, "business.sqlite");
    envBefore = {STG_DB: process.env.STG_DB, STG_DB_PATH: process.env.STG_DB_PATH,
      OSD_OPERATIONS_DB: process.env.OSD_OPERATIONS_DB};
    abapBefore = globalThis.abap;
    if (abapBefore?.context) contextBefore = {
      databaseConnections: {...abapBefore.context.databaseConnections},
      RFCDestinations: {...abapBefore.context.RFCDestinations},
      osdGeneration: abapBefore.context.osdGeneration,
    };
    process.env.STG_DB = "file";
    process.env.STG_DB_PATH = dbPath;
    process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
    const {initializeABAP} = await import("../output/init.mjs");
    // The integration runner already imported init through test/start.mjs.
    // Import caching alone would reuse its database and disconnect it below.
    await initializeABAP();
    abap = globalThis.abap;
    client = abap.context.databaseConnections.DEFAULT;
    store = new BatchRuns(root, process.env);
  });
  after(async () => {
    store?.close();
    await client?.disconnect?.();
    if (abapBefore === abap && contextBefore) {
      abap.context.databaseConnections = contextBefore.databaseConnections;
      abap.context.RFCDestinations = contextBefore.RFCDestinations;
      if (contextBefore.osdGeneration === undefined) delete abap.context.osdGeneration;
      else abap.context.osdGeneration = contextBefore.osdGeneration;
    }
    globalThis.abap = abapBefore;
    for (const [key, value] of Object.entries(envBefore ?? {})) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (dir) rmSync(dir, {recursive: true, force: true});
  });

  it("JOB_CLOSE as the first business write disappears on explicit rollback", async () => {
    await dialogStep(async () => {
      const count = await open();
      await submit(count);
      await close(count);
      await client.rollback();
    });
    expect(rows()).to.have.length(0);
    expect(stepRows()).to.have.length(0);
    expect((await drainJobOutbox(store)).imported).to.equal(0);
    expect(store.list()).to.have.length(0);
  });

  it("a dump after close rolls back its intent", async () => {
    try {
      await dialogStep(async () => {
        const count = await open();
        await submit(count);
        await close(count);
        throw new Error("unhandled dump");
      });
      throw new Error("step did not dump");
    } catch (error) { expect(error.message).to.equal("unhandled dump"); }
    expect(rows()).to.have.length(0);
    expect((await drainJobOutbox(store)).imported).to.equal(0);
  });

  it("an explicit commit preserves intent even when the following work dumps", async () => {
    try {
      await dialogStep(async () => {
        const count = await open();
        await submit(count);
        await close(count);
        await client.commit();
        throw new Error("dump after commit");
      });
      throw new Error("step did not dump");
    } catch (error) { expect(error.message).to.equal("dump after commit"); }
    expect(rows()).to.have.length(1);
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect((await workQueuedBatch(root, store, async () => ({status: "COMPLETED"}))).kind).to.equal("completed");
  });

  it("commits one immutable intent, drains once, and executes one default-input report", async () => {
    const before = store.list().length;
    await schedule();
    expect(rows()).to.have.length(1);
    expect(store.list()).to.have.length(before);
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(rows()).to.have.length(0);
    expect((await drainJobOutbox(store)).imported).to.equal(0);
    const queued = store.list().find((run) => run.state === "QUEUED");
    expect(queued.jobName).to.equal("OSD_ONE_STEP");
    expect(queued.jobCount).to.match(/^\d{8}$/);
    expect(queued.input).to.deep.equal([]);
    expect(queued.state).to.equal("QUEUED");
    expect(queued.program).to.equal("ZGG_EX_012");
    const worked = await workQueuedBatch(root, store);
    expect(worked.kind).to.equal("completed");
    expect(store.output(queued.id).lines.length).to.be.greaterThan(0);
  });

  it("a crash after operations import and before acknowledgement retries without a second run", async () => {
    await schedule();
    const before = store.list().length;
    try {
      await drainJobOutbox(store, {afterImport: () => { throw new Error("crash before ack"); }});
      throw new Error("drain did not fail");
    } catch (error) { expect(error.message).to.equal("crash before ack"); }
    expect(rows()).to.have.length(1);
    expect(store.list()).to.have.length(before + 1);
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(rows()).to.have.length(0);
    expect(store.list()).to.have.length(before + 1);
  });

  it("an acknowledgement SQL error leaves intent for idempotent retry", async () => {
    await schedule();
    const before = store.list().length;
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec(`CREATE TRIGGER refuse_job_ack BEFORE DELETE ON zosd_job_outbox
        BEGIN SELECT RAISE(ABORT, 'ack refused'); END`);
    } finally { writer.close(); }
    try {
      await drainJobOutbox(store);
      throw new Error("drain unexpectedly acknowledged intent");
    } catch (error) { expect(error.message).to.equal("outbox acknowledgement failed"); }
    expect(rows()).to.have.length(1);
    expect(store.list()).to.have.length(before + 1);
    const clean = new DatabaseSync(dbPath);
    try { clean.exec("DROP TRIGGER refuse_job_ack"); }
    finally { clean.close(); }
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(rows()).to.have.length(0);
    expect(store.list()).to.have.length(before + 1);
  });

  it("a handled child insert failure cannot leave a partial intent after caller COMMIT", async () => {
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec(`CREATE TRIGGER refuse_second_step BEFORE INSERT ON zosd_job_step
        WHEN NEW.step_no = '02' BEGIN SELECT RAISE(ABORT, 'second step refused'); END`);
    } finally { writer.close(); }
    try {
      await dialogStep(async () => {
        const count = await open();
        await submit(count, {report: "ZGG_EX_001"});
        await submit(count, {report: "ZGG_EX_012"});
        await classic(() => close(count), "job_close_failed");
        await client.commit();
      });
      expect(rows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
      expect(stepRows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
    } finally {
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER refuse_second_step"); } finally { clean.close(); }
    }
  });

  it("a child acknowledgement failure rolls back deletes and retries one imported run", async () => {
    await schedule();
    const before = store.list().length;
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec(`CREATE TRIGGER refuse_step_ack BEFORE DELETE ON zosd_job_step
        BEGIN SELECT RAISE(ABORT, 'step ack refused'); END`);
    } finally { writer.close(); }
    try {
      try { await drainJobOutbox(store); throw new Error("drain unexpectedly acknowledged child"); }
      catch (error) { expect(error.message).to.equal("outbox acknowledgement failed"); }
      expect(rows().filter((row) => row.mandt.trim() === "123")).to.have.length(1);
      expect(stepRows().filter((row) => row.mandt.trim() === "123")).to.have.length(1);
      expect(store.list()).to.have.length(before + 1);
    } finally {
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER refuse_step_ack"); } finally { clean.close(); }
    }
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(rows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
    expect(stepRows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
    expect(store.list()).to.have.length(before + 1);
  });

  it("accepts a row another drainer acknowledged after the same intent was imported", async () => {
    await schedule();
    const before = store.list().length;
    const fixture = join(root, "test", "fixtures", "job-outbox-restart.mjs");
    const result = await drainJobOutbox(store, {afterImport: () => {
      const child = spawnSync(process.execPath, [fixture, "retry"], {
        cwd: root, env: {...process.env}, encoding: "utf8", timeout: 120000,
      });
      expect(child.error, String(child.error)).to.equal(undefined);
      expect(child.status, child.stderr).to.equal(0);
      expect(JSON.parse(child.stdout.trim())).to.deep.equal({imported: 1});
    }});
    expect(result.imported).to.equal(1);
    expect(rows()).to.have.length(0);
    expect(store.list()).to.have.length(before + 1);
  });

  it("a killed importer leaves a committed row for a restarted process to acknowledge once", async () => {
    await schedule();
    const before = store.list().length;
    const fixture = join(root, "test", "fixtures", "job-outbox-restart.mjs");
    const child = (mode) => spawnSync(process.execPath, [fixture, mode], {
      cwd: root, env: {...process.env}, encoding: "utf8", timeout: 120000,
    });
    const crashed = child("crash");
    expect(crashed.error, String(crashed.error)).to.equal(undefined);
    expect(crashed.status, crashed.stderr).to.equal(73);
    expect(rows()).to.have.length(1);
    expect(store.list()).to.have.length(before + 1);
    const restarted = child("retry");
    expect(restarted.error, String(restarted.error)).to.equal(undefined);
    expect(restarted.status, restarted.stderr).to.equal(0);
    expect(JSON.parse(restarted.stdout.trim())).to.deep.equal({imported: 1});
    expect(rows()).to.have.length(0);
    expect(store.list()).to.have.length(before + 1);
  });

  it("an operations import failure keeps the outbox row and exposes no new run", async () => {
    await schedule();
    const before = store.list().length;
    const original = store.importIntent;
    store.importIntent = () => { throw new Error("operations unavailable"); };
    try {
      try { await drainJobOutbox(store); throw new Error("drain did not fail"); }
      catch (error) { expect(error.message).to.equal("operations unavailable"); }
      expect(rows()).to.have.length(1);
      expect(store.list()).to.have.length(before);
    } finally { store.importIntent = original; }
    expect((await drainJobOutbox(store)).imported).to.equal(1);
  });

  it("an operations failure after run insertion rolls back run and import ledger together", () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "atomic.sqlite")});
    const intent = {intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
      client: "123", sysid: "OSG", jobname: "ATOMIC", jobcount: "00000001",
      owner: "DEVELOPER", program: "ZGG_EX_012", generation: liveGeneration(root)};
    try {
      scoped.db.exec(`CREATE TRIGGER refuse_import_ledger BEFORE INSERT ON batch_imports
        BEGIN SELECT RAISE(ABORT, 'ledger refused'); END`);
      expect(() => scoped.importIntent(intent)).to.throw(/ledger refused/);
      expect(scoped.list()).to.have.length(0);
      expect(scoped.db.prepare("SELECT COUNT(*) AS n FROM batch_imports").get().n).to.equal(0);
      scoped.db.exec("DROP TRIGGER refuse_import_ledger");
      expect(scoped.importIntent(intent).kind).to.equal("imported");
      expect(scoped.list()).to.have.length(1);
    } finally { scoped.close(); }
  });

  it("invalidates pending definitions on explicit rollback and across steps", async () => {
    let count;
    await dialogStep(async () => {
      count = await open();
      await client.rollback();
      await classic(() => submit(count), "job_notex");
    });
    await dialogStep(() => classic(() => submit(count), "job_notex"));
    await dialogStep(async () => {
      count = await open();
      await client.commit();
      await classic(() => submit(count), "job_notex");
    });
  });

  it("WAIT commits and abandons the caller's pending definition while another step runs", async () => {
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    let count;
    const waiting = dialogStep(async () => {
      count = await open();
      started();
      await abap.statements.wait({seconds: box("0.05")});
      await classic(() => submit(count), "job_notex");
    }, "waiting job caller");
    await ready;
    await dialogStep(() => classic(() => submit(count), "job_notex"), "other job caller");
    await waiting;
  });

  it("refuses to open a job in a read-only work-process reservation", async () => {
    try {
      await exclusive(() => open(), "read-only reservation");
      throw new Error("JOB_OPEN unexpectedly succeeded");
    } catch (error) { expect(error.message).to.include("requires a dialog step"); }
  });

  it("a worker only claims rows for its business database, client and system", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "scope.sqlite")});
    const base = {client: "123", sysid: "OSG", jobname: "SCOPE", jobcount: "00000001",
      owner: "DEVELOPER", program: "ZGG_EX_012", generation: liveGeneration(root)};
    try {
      const foreignDb = scoped.importIntent({...base, intentId: randomUUID().replaceAll("-", ""),
        sourceDb: join(dir, "other.sqlite")}).run;
      const foreignClient = scoped.importIntent({...base, intentId: randomUUID().replaceAll("-", ""),
        sourceDb: dbPath, client: "124"}).run;
      const own = scoped.importIntent({...base, intentId: randomUUID().replaceAll("-", ""),
        sourceDb: dbPath}).run;
      const result = await workQueuedBatch(root, scoped, async () => ({status: "COMPLETED"}));
      expect(result.run.id).to.equal(own.id);
      expect(scoped.get(foreignDb.id).state).to.equal("QUEUED");
      expect(scoped.get(foreignClient.id).state).to.equal("QUEUED");
      expect((await workQueuedBatch(root, scoped)).kind).to.equal("empty");
      const stale = scoped.importIntent({...base, intentId: randomUUID().replaceAll("-", ""),
        sourceDb: dbPath, generation: "old-generation"}).run;
      let executed = false;
      const mismatch = await workQueuedBatch(root, scoped, async () => { executed = true; });
      expect(executed).to.equal(false);
      expect(mismatch.run.id).to.equal(stale.id);
      expect(mismatch.run.resultStatus).to.equal("GENERATION_CHANGED");
    } finally { scoped.close(); }
  });

  it("a successful hot swap updates scheduling and worker generation together", async () => {
    const jobs = abap.context.RFCDestinations.JOBS;
    const old = jobs.generation;
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "warm.sqlite")});
    try {
      await applyRuntimeHotSwap({swap: async () => ({swaps: 1})}, {generation: "warm-g2"}, abap);
      expect(jobs.generation).to.equal("warm-g2");
      expect(abap.context.osdGeneration).to.equal("warm-g2");
      try {
        await applyRuntimeHotSwap({swap: async () => { throw new Error("swap failed"); }},
          {generation: "warm-g3"}, abap);
        throw new Error("failed swap unexpectedly succeeded");
      } catch (error) { expect(error.message).to.equal("swap failed"); }
      expect(jobs.generation).to.equal("warm-g2");
      await schedule();
      expect(rows().find((row) => row.mandt.trim() === "123").generation.trim()).to.equal("warm-g2");
      expect((await drainJobOutbox(scoped)).imported).to.equal(1);
      expect((await workQueuedBatch(root, scoped, async () => ({status: "COMPLETED"}))).kind).to.equal("completed");
    } finally {
      jobs.generation = old;
      abap.context.osdGeneration = old;
      scoped.close();
    }
  });

  it("runs the loaded report when the output symlink switches before execution", async () => {
    const fakeRoot = join(dir, "switched-root");
    const first = join(fakeRoot, "g1", "output");
    const second = join(fakeRoot, "g2", "output");
    mkdirSync(first, {recursive: true});
    mkdirSync(second, {recursive: true});
    symlinkSync(first, join(fakeRoot, "output"), "dir");
    rmSync(join(fakeRoot, "output"));
    symlinkSync(second, join(fakeRoot, "output"), "dir");
    const result = await runConvertedBatch(fakeRoot, "ZGG_EX_012");
    expect(result.status).to.equal("COMPLETED");
    expect(result.lines.length).to.be.greaterThan(0);
  });

  it("drains only the current business client from a shared database", async () => {
    const writer = new DatabaseSync(dbPath);
    const intent = randomUUID().replaceAll("-", "");
    try {
      writer.prepare(`INSERT INTO zosd_job_outbox
        (mandt, intent_id, sysid, source_db, jobname, jobcount, owner, program, generation, created_on, created_at)
        VALUES ('124', ?, 'OSG', ?, 'FOREIGN', '00000001', 'DEVELOPER', 'ZGG_EX_012', ?, '20260929', '000000')`)
        .run(intent, dbPath, liveGeneration(root));
    } finally { writer.close(); }
    expect((await drainJobOutbox(store)).imported).to.equal(0);
    expect(rows().some((row) => row.intent_id.trim() === intent)).to.equal(true);
  });

  it("rejects variants, unsupported reports, too many steps, and non-immediate close", async () => {
    const before = rows().length;
    await dialogStep(async () => {
      const count = await open();
      await classic(() => submit(count, {variant: "EXISTING"}), "job_submit_failed");
      await classic(() => submit(count, {report: "Z_NOT_REGISTERED"}), "program_missing");
      await submit(count);
      for (let i = 1; i < 16; i++) await submit(count);
      await classic(() => submit(count), "job_submit_failed");
      await classic(() => close(count, {strtimmed: ""}), "job_close_failed");
      await close(count);
      await classic(() => close(count), "job_notex");
      await client.rollback();
    });
    expect(rows()).to.have.length(before);
  });

  it("keeps imported ledger across a fresh operations connection and rejects changed payload", async () => {
    await schedule();
    const intent = rows().find((row) => row.mandt.trim() === "123");
    await drainJobOutbox(store);
    const reopened = new BatchRuns(root, process.env);
    try {
      const base = {
        intentId: intent.intent_id.trim(), sourceDb: intent.source_db.trim(),
        client: intent.mandt.trim(), sysid: intent.sysid.trim(),
        jobname: intent.jobname.trim(), jobcount: intent.jobcount.trim(),
        owner: intent.owner.trim(), program: intent.program.trim(), generation: intent.generation.trim(),
        steps: [{number: 1, program: intent.program.trim()}],
      };
      expect(reopened.importIntent(base).kind).to.equal("duplicate");
      expect(() => reopened.importIntent({...base, program: "Z_OTHER",
        steps: [{number: 1, program: "Z_OTHER"}]})).to.throw(/changed after import/);
    } finally { reopened.close(); }
  });

  it("imports ordered steps and executes only one step per worker call", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "multi.sqlite")});
    try {
      await dialogStep(async () => {
        const count = await open();
        await submit(count, {report: "ZGG_EX_001"});
        await submit(count, {report: "ZGG_EX_012"});
        await submit(count, {report: "ZGG_EX_043"});
        await close(count);
      });
      const committed = rows().find((row) => row.mandt.trim() === "123" && Number(row.step_count) === 3);
      const reader = new DatabaseSync(dbPath, {readOnly: true});
      try {
        expect(reader.prepare("SELECT step_no, program FROM zosd_job_step ORDER BY step_no").all()
          .map((item) => item.program.trim())).to.deep.equal(["ZGG_EX_001", "ZGG_EX_012", "ZGG_EX_043"]);
      } finally { reader.close(); }
      try {
        await drainJobOutbox(scoped, {afterImport: () => { throw new Error("crash after multi import"); }});
        throw new Error("drain unexpectedly finished");
      } catch (error) { expect(error.message).to.equal("crash after multi import"); }
      expect(stepRows()).to.have.length(3);
      expect((await drainJobOutbox(scoped)).imported).to.equal(1);
      expect(stepRows()).to.have.length(0);
      const run = scoped.list()[0];
      expect(run.steps.map((item) => item.state)).to.deep.equal(["READY", "PENDING", "PENDING"]);
      const seen = [];
      const execute = async (_root, program) => {
        seen.push(program);
        return {status: "COMPLETED", lines: [program]};
      };
      expect((await workQueuedBatch(root, scoped, execute)).kind).to.equal("advanced");
      expect(seen).to.deep.equal(["ZGG_EX_001"]);
      const firstStartedAt = scoped.get(run.id).startedAt;
      expect(scoped.get(run.id).steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "READY", "PENDING"]);
      expect(scoped.stepOutput(run.id, 1).lines).to.deep.equal(["ZGG_EX_001"]);
      const reopened = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "multi.sqlite")});
      try {
        expect((await workQueuedBatch(root, reopened, execute)).kind).to.equal("advanced");
        expect(reopened.get(run.id).steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "COMPLETED", "READY"]);
        expect((await workQueuedBatch(root, reopened, execute)).kind).to.equal("completed");
        expect(seen).to.deep.equal(["ZGG_EX_001", "ZGG_EX_012", "ZGG_EX_043"]);
        expect(reopened.get(run.id).state).to.equal("COMPLETED");
        expect(reopened.get(run.id).startedAt).to.equal(firstStartedAt);
        expect(reopened.output(run.id).lines).to.deep.equal(["ZGG_EX_043"]);
        expect(reopened.stepOutput(run.id, 2).lines).to.deep.equal(["ZGG_EX_012"]);
        writeFileSync(join(dir, "batch-output", `${run.id}-1.json`), "tampered");
        expect(() => reopened.stepOutput(run.id, 1)).to.throw(/digest check/);
      } finally { reopened.close(); }
      const base = {intentId: committed.intent_id.trim(), sourceDb: committed.source_db.trim(),
        client: committed.mandt.trim(), sysid: committed.sysid.trim(),
        jobname: committed.jobname.trim(), jobcount: committed.jobcount.trim(), owner: committed.owner.trim(),
        program: "ZGG_EX_001", generation: committed.generation.trim(),
        steps: ["ZGG_EX_001", "ZGG_EX_012", "ZGG_EX_043"].map((program, index) => ({number: index + 1, program}))};
      expect(scoped.importIntent(base).kind).to.equal("duplicate");
      expect(() => scoped.importIntent({...base, steps: [base.steps[0], {...base.steps[1], program: "ZGG_EX_043"}, base.steps[2]]}))
        .to.throw(/changed after import/);
    } finally { scoped.close(); }
  });

  it("fails one step, skips later steps, and redacts monitored selection values", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "multi-fail.sqlite")});
    try {
      const base = {intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: "OSG", jobname: "MULTI", jobcount: "00000001",
        owner: "DEVELOPER", program: "ZGG_EX_001", generation: liveGeneration(root),
        steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"},
          {number: 3, program: "ZGG_EX_043"}]};
      const run = scoped.importIntent(base).run;
      let calls = 0;
      const execute = async () => (++calls === 1 ? {status: "COMPLETED", lines: ["first"]} :
        {status: "INVALID_INPUT", detail: "bad input", lines: ["second"]});
      expect((await workQueuedBatch(root, scoped, execute)).kind).to.equal("advanced");
      expect((await workQueuedBatch(root, scoped, execute)).kind).to.equal("failed");
      expect(calls).to.equal(2);
      expect(scoped.get(run.id).steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "FAILED", "SKIPPED"]);
      expect(scoped.stepOutput(run.id, 2).lines).to.deep.equal(["second"]);
      expect((await workQueuedBatch(root, scoped)).kind).to.equal("empty");
      scoped.db.prepare("UPDATE batch_run_steps SET input_json = ? WHERE run_id = ? AND step_no = 1")
        .run(JSON.stringify([{name: "P_SECRET", value: "hidden-value"}]), run.id);
      expect(JSON.stringify(scoped.list())).not.to.include("hidden-value");
      expect(scoped.get(run.id).steps[0].input).to.deep.equal([{name: "P_SECRET"}]);
    } finally { scoped.close(); }
  });

  it("leaves a crashed active step RUNNING and requires explicit interrupt", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "multi-crash.sqlite")});
    const base = {intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
      client: "123", sysid: "OSG", jobname: "MULTI", jobcount: "00000002",
      owner: "DEVELOPER", program: "ZGG_EX_001", generation: liveGeneration(root),
      steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"}]};
    try {
      const run = scoped.importIntent(base).run;
      expect(scoped.claimNext().step).to.equal(1); // process exits after claim, before recording report result
      // The report's business LUW may already be committed at this point.
      const writer = new DatabaseSync(dbPath);
      try {
        writer.exec("CREATE TABLE IF NOT EXISTS job_crash_effect (run_id TEXT)");
        writer.prepare("INSERT INTO job_crash_effect VALUES (?)").run(run.id);
      } finally { writer.close(); }
      const reopened = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "multi-crash.sqlite")});
      try {
        const check = new DatabaseSync(dbPath, {readOnly: true});
        try { expect(check.prepare("SELECT COUNT(*) AS n FROM job_crash_effect WHERE run_id = ?").get(run.id).n).to.equal(1); }
        finally { check.close(); }
        expect(reopened.claimNext()).to.deep.equal({kind: "busy", id: run.id});
        expect(reopened.get(run.id).steps.map((item) => item.state)).to.deep.equal(["RUNNING", "PENDING"]);
        expect(reopened.interruptQueued(run.id).steps.map((item) => item.state)).to.deep.equal(["INTERRUPTED", "SKIPPED"]);
        expect(reopened.claimNext().kind).to.equal("empty");
      } finally { reopened.close(); }
    } finally { scoped.close(); }
  });

  it("never runs a queued multi-step parent whose READY child is missing", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "multi-corrupt.sqlite")});
    try {
      const run = scoped.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: "OSG", jobname: "MULTI", jobcount: "00000003", owner: "DEVELOPER",
        program: "ZGG_EX_001", generation: liveGeneration(root),
        steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"}]}).run;
      scoped.db.prepare("UPDATE batch_run_steps SET state = 'PENDING' WHERE run_id = ?").run(run.id);
      expect(() => scoped.claimNext()).to.throw(/inconsistent ordered steps/);
      expect(scoped.get(run.id).state).to.equal("QUEUED");
    } finally { scoped.close(); }
  });

  it("two worker processes cannot claim the same first step", async () => {
    const path = join(dir, "multi-workers.sqlite");
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: path});
    try {
      const run = scoped.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: "OSG", jobname: "MULTI", jobcount: "00000004", owner: "DEVELOPER",
        program: "ZGG_EX_001", generation: liveGeneration(root),
        steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"}]}).run;
      const fixture = join(root, "test", "fixtures", "job-step-claim.mjs");
      const claim = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fixture, path], {cwd: root, env: {...process.env}});
        let output = "", errors = "";
        child.stdout.on("data", (part) => { output += part; });
        child.stderr.on("data", (part) => { errors += part; });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
      });
      const results = await Promise.all([claim(), claim()]);
      expect(results.map((item) => item.kind).sort()).to.deep.equal(["busy", "claimed"]);
      expect(results.find((item) => item.kind === "claimed").step).to.equal(1);
      expect(scoped.get(run.id).steps.map((item) => item.state)).to.deep.equal(["RUNNING", "PENDING"]);
    } finally { scoped.close(); }
  });

  it("reports a committed step transition even when another worker claims its successor immediately", async () => {
    const path = join(dir, "step-transition-race.sqlite");
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: path});
    const other = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: path});
    try {
      const run = scoped.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: "OSG", jobname: "RACE", jobcount: "00000005", owner: "DEVELOPER",
        program: "ZGG_EX_001", generation: liveGeneration(root),
        steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"}]}).run;
      const originalExec = scoped.db.exec.bind(scoped.db);
      let armed = false;
      scoped.db.exec = (statement) => {
        const answer = originalExec(statement);
        if (statement === "COMMIT" && armed) {
          armed = false;
          expect(other.claimNext().step).to.equal(2);
        }
        return answer;
      };
      const result = await workQueuedBatch(root, scoped, async () => {
        armed = true;
        return {status: "COMPLETED", lines: ["first"]};
      });
      expect(result.kind).to.equal("advanced");
      expect(result.run.state).to.equal("QUEUED");
      expect(result.run.steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "READY"]);
      expect(other.get(run.id).steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "RUNNING"]);
    } finally { other.close(); scoped.close(); }
  });

  it("records a step when node:sqlite exposes no isTransaction property", () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "older-node.sqlite")});
    try {
      const run = scoped.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: "OSG", jobname: "OLDER_NODE", jobcount: "00000007", owner: "DEVELOPER",
        program: "ZGG_EX_001", generation: liveGeneration(root),
        steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"}]}).run;
      scoped.claimNext();
      const native = scoped.db;
      scoped.db = new Proxy(native, {get(target, key) {
        if (key === "isTransaction") return undefined;
        const member = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      }});
      const transition = scoped.finishStep(run.id, 1, {status: "COMPLETED", lines: ["first"]});
      expect(transition.kind).to.equal("advanced");
      expect(transition.run.steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "READY"]);
      expect(scoped.get(run.id).steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "READY"]);
      expect(scoped.list()[0].state).to.equal("QUEUED");
    } finally { scoped.close(); }
  });

  it("reads parent and child monitor states from one operations snapshot", () => {
    const path = join(dir, "step-read-snapshot.sqlite");
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: path});
    const other = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: path});
    try {
      const run = scoped.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: "OSG", jobname: "SNAPSHOT", jobcount: "00000006", owner: "DEVELOPER",
        program: "ZGG_EX_001", generation: liveGeneration(root),
        steps: [{number: 1, program: "ZGG_EX_001"}, {number: 2, program: "ZGG_EX_012"}]}).run;
      scoped.claimNext();
      const originalSteps = scoped.steps.bind(scoped);
      let raced = false;
      scoped.steps = (id, options) => {
        if (!raced) {
          raced = true;
          expect(other.finishStep(run.id, 1, {status: "COMPLETED"}).kind).to.equal("advanced");
        }
        return originalSteps(id, options);
      };
      const view = scoped.get(run.id);
      expect(view.state).to.equal("RUNNING");
      expect(view.steps.map((item) => item.state)).to.deep.equal(["RUNNING", "PENDING"]);
      expect(other.get(run.id).steps.map((item) => item.state)).to.deep.equal(["COMPLETED", "READY"]);
    } finally { other.close(); scoped.close(); }
  });
});
