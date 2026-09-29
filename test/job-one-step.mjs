import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {BatchRuns, liveGeneration, workQueuedBatch} from "../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../tools/osd-job-outbox.mjs";
import {dialogStep, exclusive} from "../tools/osd-dialog-step.mjs";

const root = resolve(".");

describe("one-step standard JOB_* facade and committed outbox", function () {
  this.timeout(120000);
  let dir, dbPath, envBefore, abapBefore, abap, client, store;
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
    process.env.STG_DB = "file";
    process.env.STG_DB_PATH = dbPath;
    process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
    await import("../output/init.mjs");
    abap = globalThis.abap;
    client = abap.context.databaseConnections.DEFAULT;
    store = new BatchRuns(root, process.env);
  });
  after(async () => {
    store?.close();
    await client?.disconnect?.();
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

  it("rejects variants, unsupported reports, second steps, and non-immediate close", async () => {
    const before = rows().length;
    await dialogStep(async () => {
      const count = await open();
      await classic(() => submit(count, {variant: "EXISTING"}), "job_submit_failed");
      await classic(() => submit(count, {report: "Z_NOT_REGISTERED"}), "program_missing");
      await submit(count);
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
      };
      expect(reopened.importIntent(base).kind).to.equal("duplicate");
      expect(() => reopened.importIntent({...base, program: "Z_OTHER"})).to.throw(/changed after import/);
    } finally { reopened.close(); }
  });
});
