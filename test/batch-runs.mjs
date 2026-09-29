import {expect} from "chai";
import {randomUUID} from "node:crypto";
import {appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import express from "express";
import {BatchRuns, liveGeneration, runPersistedBatch, workQueuedBatch} from "../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../tools/osd-job-outbox.mjs";
import {batchMonitorHandler} from "../tools/osd-batch-monitor.mjs";
import {beforeJobPredecessorDDL, ensureJobEventMetadata, migrateJobEventFile,
  migrateJobStepInputFile,
  migrateJobIdentityFile, migrateJobPredecessorFile} from "./setup.mjs";
import {fingerprintOf} from "../tools/osd-persist.mjs";

const root = resolve(".");

describe("durable one-shot batch runs", function () {
  let dir;
  let env;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-batch-runs-"));
    env = {...process.env, OSD_OPERATIONS_DB: join(dir, "operations.sqlite")};
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("adds retained job keys to an existing business DB and backfills pending intents", () => {
    const path = join(dir, "identity-upgrade.sqlite");
    const db = new DatabaseSync(path);
    try {
      const parent = `CREATE TABLE 'zosd_job_outbox' (mandt TEXT, intent_id TEXT, jobname TEXT,
        jobcount TEXT, owner TEXT, 'step_count' NCHAR(2))`;
      const step = "CREATE TABLE 'zosd_job_step' (mandt TEXT, intent_id TEXT, step_no TEXT)";
      const identity = `CREATE TABLE 'zosd_job_identity' (mandt TEXT, jobname TEXT, jobcount TEXT,
        owner TEXT, intent_id TEXT, PRIMARY KEY(mandt, jobname, jobcount))`;
      const old = [parent, step];
      const wanted = [...old, identity];
      db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT);
        CREATE TABLE zosd_job_outbox (mandt TEXT, intent_id TEXT, jobname TEXT, jobcount TEXT,
          owner TEXT, step_count NCHAR(2));
        CREATE TABLE zosd_job_step (mandt TEXT, intent_id TEXT, step_no TEXT);
        INSERT INTO zosd_job_outbox VALUES ('123', 'old-intent', '  saved ', '00000004', 'DEVELOPER', '01')`);
      db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf(old));
      expect(migrateJobIdentityFile(db, fingerprintOf(old), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
      expect(db.prepare("SELECT * FROM zosd_job_identity").get()).to.include({
        jobname: "SAVED", jobcount: "00000004", intent_id: "old-intent"});
      expect(db.prepare("SELECT * FROM zosd_job_outbox").get().intent_id).to.equal("old-intent");
      expect(migrateJobIdentityFile(db, fingerprintOf(old), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
      expect(db.prepare("SELECT COUNT(*) AS n FROM zosd_job_identity").get().n).to.equal(1);
    } finally { db.close(); }
  });

  it("refuses an identity upgrade with two old intents sharing one business key", () => {
    const db = new DatabaseSync(join(dir, "identity-conflict.sqlite"));
    try {
      const parent = `CREATE TABLE 'zosd_job_outbox' (mandt TEXT, intent_id TEXT, jobname TEXT,
        jobcount TEXT, owner TEXT, 'step_count' NCHAR(2))`;
      const step = "CREATE TABLE 'zosd_job_step' (mandt TEXT, intent_id TEXT, step_no TEXT)";
      const identity = `CREATE TABLE 'zosd_job_identity' (mandt TEXT, jobname TEXT, jobcount TEXT,
        owner TEXT, intent_id TEXT, PRIMARY KEY(mandt, jobname, jobcount))`;
      const old = [parent, step];
      const wanted = [...old, identity];
      db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT);
        CREATE TABLE zosd_job_outbox (mandt TEXT, intent_id TEXT, jobname TEXT, jobcount TEXT,
          owner TEXT, step_count NCHAR(2));
        CREATE TABLE zosd_job_step (mandt TEXT, intent_id TEXT, step_no TEXT);
        INSERT INTO zosd_job_outbox VALUES ('123', 'one', 'SAVED', '00000004', 'DEVELOPER', '01');
        INSERT INTO zosd_job_outbox VALUES ('123', 'two', ' saved ', '00000004', 'DEVELOPER', '01')`);
      db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf(old));
      expect(() => migrateJobIdentityFile(db, fingerprintOf(old), fingerprintOf(wanted), wanted, fingerprintOf))
        .to.throw(/UNIQUE constraint failed/);
      expect(db.prepare("SELECT fingerprint FROM osd_schema").get().fingerprint).to.equal(fingerprintOf(old));
      expect(db.prepare("SELECT COUNT(*) AS n FROM zosd_job_outbox").get().n).to.equal(2);
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'zosd_job_identity'").get()).to.equal(undefined);
    } finally { db.close(); }
  });

  it("upgrades the earlier one-step schema directly while retaining its intent", () => {
    const db = new DatabaseSync(join(dir, "identity-one-step.sqlite"));
    try {
      const oldParent = `CREATE TABLE 'zosd_job_outbox' (mandt TEXT, intent_id TEXT, jobname TEXT,
        jobcount TEXT, owner TEXT)`;
      const parent = oldParent.replace("owner TEXT)", "owner TEXT, 'step_count' NCHAR(2))");
      const step = "CREATE TABLE 'zosd_job_step' (mandt TEXT, intent_id TEXT, step_no TEXT)";
      const identity = `CREATE TABLE 'zosd_job_identity' (mandt TEXT, jobname TEXT, jobcount TEXT,
        owner TEXT, intent_id TEXT, PRIMARY KEY(mandt, jobname, jobcount))`;
      const wanted = [parent, step, identity];
      db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT);
        CREATE TABLE zosd_job_outbox (mandt TEXT, intent_id TEXT, jobname TEXT, jobcount TEXT, owner TEXT);
        INSERT INTO zosd_job_outbox VALUES ('123', 'old', 'SAVED', '00000005', 'DEVELOPER')`);
      db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf([oldParent]));
      expect(migrateJobIdentityFile(db, fingerprintOf([oldParent]), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
      expect(db.prepare("SELECT intent_id FROM zosd_job_identity").get().intent_id).to.equal("old");
      expect(db.prepare("PRAGMA table_info(zosd_job_outbox)").all().some((column) => column.name === "step_count"))
        .to.equal(true);
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'zosd_job_step'").get()).to.exist;
    } finally { db.close(); }
  });

  it("adds predecessor columns to a stamped business DB without touching old intents", () => {
    const db = new DatabaseSync(join(dir, "pred-upgrade.sqlite"));
    try {
      const oldParent = `CREATE TABLE 'zosd_job_outbox' ('mandt' NCHAR(3) COLLATE RTRIM,
        'intent_id' NCHAR(32) COLLATE RTRIM, 'step_count' NCHAR(2))`;
      const parent = oldParent.replace("'step_count' NCHAR(2)",
        `'step_count' NCHAR(2), 'pred_jobname' NCHAR(32) COLLATE RTRIM,
        'pred_jobcount' NCHAR(8) COLLATE RTRIM, 'pred_intent_id' NCHAR(32) COLLATE RTRIM`);
      const old = [oldParent];
      const wanted = [parent];
      db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT);
        CREATE TABLE zosd_job_outbox (mandt NCHAR(3), intent_id NCHAR(32), step_count NCHAR(2));
        INSERT INTO zosd_job_outbox VALUES ('123', 'old-intent', '01')`);
      db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf(old));
      expect(migrateJobPredecessorFile(db, fingerprintOf(old), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
      expect(db.prepare("SELECT * FROM zosd_job_outbox").get()).to.include({intent_id: "old-intent", pred_jobname: ""});
      expect(db.prepare("SELECT fingerprint FROM osd_schema").get().fingerprint).to.equal(fingerprintOf(wanted));
      expect(migrateJobPredecessorFile(db, fingerprintOf(old), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
    } finally { db.close(); }
  });

  it("composes one-step and multistep identity upgrades before predecessor columns", () => {
    for (const oldKind of ["one-step", "multistep"]) {
      const db = new DatabaseSync(join(dir, `pred-${oldKind}.sqlite`));
      try {
        const parent = `CREATE TABLE 'zosd_job_outbox' ('mandt' NCHAR(3) COLLATE RTRIM,
          'intent_id' NCHAR(32) COLLATE RTRIM, 'jobname' TEXT, 'jobcount' TEXT,
          'owner' TEXT, 'step_count' NCHAR(2), 'pred_jobname' NCHAR(32) COLLATE RTRIM,
          'pred_jobcount' NCHAR(8) COLLATE RTRIM, 'pred_intent_id' NCHAR(32) COLLATE RTRIM)`;
        const beforePred = beforeJobPredecessorDDL([parent])[0];
        const oneStepParent = beforePred.replace(/, 'step_count' NCHAR\(2\)/, "");
        const step = "CREATE TABLE 'zosd_job_step' (mandt TEXT, intent_id TEXT, step_no TEXT)";
        const identity = `CREATE TABLE 'zosd_job_identity' (mandt TEXT, jobname TEXT, jobcount TEXT,
          owner TEXT, intent_id TEXT, PRIMARY KEY(mandt, jobname, jobcount))`;
        const wanted = [parent, step, identity];
        const v3 = beforeJobPredecessorDDL(wanted);
        const old = oldKind === "one-step" ? [oneStepParent] : [beforePred, step];
        db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT);
          CREATE TABLE zosd_job_outbox (mandt TEXT, intent_id TEXT, jobname TEXT, jobcount TEXT,
            owner TEXT${oldKind === "one-step" ? "" : ", step_count NCHAR(2)"});
          INSERT INTO zosd_job_outbox (mandt, intent_id, jobname, jobcount, owner)
            VALUES ('123', 'old-intent', 'PARENT', '00000004', 'DEVELOPER')`);
        if (oldKind === "multistep") db.exec(step);
        db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf(old));
        expect(migrateJobIdentityFile(db, fingerprintOf(old), fingerprintOf(v3), v3, fingerprintOf)).to.equal(true);
        expect(migrateJobPredecessorFile(db, fingerprintOf(v3), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
        expect(db.prepare("SELECT pred_jobname, pred_jobcount, pred_intent_id FROM zosd_job_outbox").get())
          .to.deep.equal({pred_jobname: "", pred_jobcount: "", pred_intent_id: ""});
      } finally { db.close(); }
    }
  });

  it("imports and acknowledges a pending pre-predecessor outbox row after migration", async () => {
    const sourceDb = join(dir, "pending-upgrade.sqlite");
    const db = new DatabaseSync(sourceDb);
    const oldParent = `CREATE TABLE 'zosd_job_outbox' (mandt TEXT, intent_id TEXT PRIMARY KEY,
      sysid TEXT, source_db TEXT, jobname TEXT, jobcount TEXT, owner TEXT,
      program TEXT, step_count TEXT, generation TEXT, created_on TEXT, created_at TEXT)`;
    const parent = oldParent.replace("generation TEXT", `generation TEXT,
      'pred_jobname' NCHAR(32) COLLATE RTRIM, 'pred_jobcount' NCHAR(8) COLLATE RTRIM,
      'pred_intent_id' NCHAR(32) COLLATE RTRIM`);
    const eventParent = parent.replace("'pred_intent_id' NCHAR(32) COLLATE RTRIM",
      `'pred_intent_id' NCHAR(32) COLLATE RTRIM,
       'source_instance' NCHAR(32) COLLATE RTRIM, 'wait_seq' NCHAR(16),
       'event_id' NCHAR(32) COLLATE RTRIM, 'event_param' NCHAR(64) COLLATE RTRIM`);
    const step = `CREATE TABLE 'zosd_job_step' (mandt TEXT, intent_id TEXT, step_no TEXT, program TEXT)`;
    const old = [oldParent, step];
    const wanted = [parent, step];
    const eventWanted = [eventParent, step];
    const inputStep = step.replace("program TEXT", "program TEXT, 'input_json' TEXT COLLATE RTRIM");
    const inputWanted = [eventParent, inputStep];
    const oldAbap = globalThis.abap;
    const store = new BatchRuns(root, env);
    try {
      db.exec(`CREATE TABLE osd_schema (fingerprint TEXT, at TEXT); ${oldParent}; ${step};`);
      const intentId = randomUUID().replaceAll("-", "");
      db.prepare(`INSERT INTO zosd_job_outbox VALUES
        ('123', ?, 'OSG', ?, 'OLD_PENDING', '00000001', 'DEVELOPER',
         'Z_FIRST', '01', 'generation-1', '20260929', '091500')`).run(intentId, sourceDb);
      db.prepare(`INSERT INTO zosd_job_step VALUES ('123', ?, '01', 'Z_FIRST')`).run(intentId);
      db.prepare("INSERT INTO osd_schema VALUES (?, 'old')").run(fingerprintOf(old));
      expect(migrateJobPredecessorFile(db, fingerprintOf(old), fingerprintOf(wanted), wanted, fingerprintOf)).to.equal(true);
      expect(migrateJobEventFile(db, fingerprintOf(wanted), fingerprintOf(eventWanted), eventWanted, fingerprintOf)).to.equal(true);
      expect(migrateJobStepInputFile(db, fingerprintOf(eventWanted), fingerprintOf(inputWanted), inputWanted, fingerprintOf)).to.equal(true);
      expect(db.prepare("SELECT input_json FROM zosd_job_step").get().input_json).to.equal("[]");
      ensureJobEventMetadata(db);
      const client = {path: sourceDb,
        async delete({table, where}) {
          const changed = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run().changes;
          return {subrc: changed === 1 ? 0 : 4, dbcnt: changed};
        },
        async commit() {}, async rollback() {}};
      globalThis.abap = {context: {databaseConnections: {DEFAULT: client}}};
      expect((await drainJobOutbox(store, {env: {...env, STG_DB: "file"}})).imported).to.equal(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM zosd_job_outbox").get().n).to.equal(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM zosd_job_step").get().n).to.equal(0);
      expect(store.list().map((run) => run.jobName)).to.deep.equal(["OLD_PENDING"]);
    } finally { globalThis.abap = oldAbap; store.close(); db.close(); }
  });

  it("assigns a new source instance when a business file is replaced at the same path", () => {
    const path = join(dir, "replaced-business.sqlite");
    const first = new DatabaseSync(path);
    ensureJobEventMetadata(first);
    const original = first.prepare("SELECT id FROM zosd_job_source_instance").get().id;
    first.close();
    rmSync(path);
    const second = new DatabaseSync(path);
    try {
      ensureJobEventMetadata(second);
      expect(second.prepare("SELECT id FROM zosd_job_source_instance").get().id).to.not.equal(original);
    } finally { second.close(); }
  });

  it("reopens a finished run and its output on a fresh SQLite connection", async () => {
    const first = new BatchRuns(root, env);
    const run = await runPersistedBatch(root,
      {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20251231"}]},
      first, async () => ({status: "COMPLETED", lines: ["20251231"]}));
    first.close();
    expect(run.state).to.equal("COMPLETED");
    expect(run.input).to.deep.equal([{name: "P_DATE"}]);
    expect(run.generation).to.match(/^[0-9a-f]{16}$/);
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(run.id)).to.deep.equal(run);
      expect(reopened.output(run.id).lines).to.deep.equal(["20251231"]);
    } finally {
      reopened.close();
    }
  });

  it("keeps a failed result, redacts selection values on reads, and detects changed output", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = await runPersistedBatch(root,
        {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "private-value"}]},
        store, async () => ({status: "INVALID_INPUT", detail: "bad date", lines: ["partial"]}));
      expect(run.state).to.equal("FAILED");
      expect(run.input).to.deep.equal([{name: "P_DATE"}]);
      expect(store.get(run.id, {revealInput: true}).input[0].value).to.equal("private-value");
      expect(store.output(run.id).lines).to.deep.equal(["partial"]);
      writeFileSync(join(dir, "batch-output", `${run.id}.json`), "tampered");
      expect(() => store.output(run.id)).to.throw(/digest check/);
    } finally {
      store.close();
    }
  });

  it("records a thrown report error without claiming it completed", async () => {
    const store = new BatchRuns(root, env);
    try {
      let id;
      try {
        await runPersistedBatch(root, {program: "ZGG_EX_012"}, store, async () => {
          throw new Error("report dumped");
        });
      } catch (error) {
        id = error.runId;
      }
      expect(id).to.be.a("string");
      expect(store.get(id).resultStatus).to.equal("DUMP");
      expect(store.get(id).state).to.equal("FAILED");
      expect(store.output(id)).to.equal(undefined);
    } finally {
      store.close();
    }
  });

  it("does not turn a synchronous saved run into a background job log", () => {
    const store = new BatchRuns(root, env);
    try {
      const run = store.start({program: "ZGG_EX_012"});
      store.finish(run.id, {status: "COMPLETED", lines: ["list only"]});
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM batch_job_log WHERE run_id = ?")
        .get(run.id).n).to.equal(0);
    } finally { store.close(); }
  });

  it("keeps an interrupted run visible for a later doctor", () => {
    const first = new BatchRuns(root, env);
    const started = first.start({program: "ZGG_EX_012"});
    first.close();
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(started.id).state).to.equal("RUNNING");
      expect(reopened.get(started.id).endedAt).to.equal(null);
      expect(reopened.output(started.id)).to.equal(undefined);
    } finally {
      reopened.close();
    }
  });

  it("claims queued work in order and admits only one BGR run across connections", async () => {
    const first = new BatchRuns(root, env);
    const second = new BatchRuns(root, env);
    try {
      const a = first.enqueue({program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20260101"}],
        generation: "test-generation"});
      const b = first.enqueue({program: "ZGG_EX_012", input: [{name: "P_DATE", value: "20260102"}],
        generation: "test-generation"});
      expect(a.state).to.equal("QUEUED");
      expect(a.startedAt).to.equal(null);
      const claim = first.claimNext();
      expect(claim.kind).to.equal("claimed");
      expect(claim.run.id).to.equal(a.id);
      expect(claim.run.input[0].value).to.equal("20260101");
      expect(second.claimNext()).to.deep.equal({kind: "busy", id: a.id});
      first.finish(a.id, {status: "COMPLETED", lines: ["first"]});
      expect(second.claimNext().run.id).to.equal(b.id);
      second.finish(b.id, {status: "COMPLETED", lines: ["second"]});
      expect(first.list().map((run) => run.state)).to.deep.equal(["COMPLETED", "COMPLETED"]);
      expect(first.output(b.id).lines).to.deep.equal(["second"]);
    } finally {
      second.close();
      first.close();
    }
  });

  it("refuses to run queued work against a changed generation", async () => {
    const store = new BatchRuns(root, env);
    try {
      const queued = store.enqueue({program: "ZGG_EX_012", generation: "obsolete"});
      let called = false;
      const outcome = await workQueuedBatch(root, store, async () => { called = true; });
      expect(called).to.equal(false);
      expect(outcome.kind).to.equal("failed");
      expect(store.get(queued.id).resultStatus).to.equal("GENERATION_CHANGED");
      expect(store.claimNext().kind).to.equal("empty");
    } finally {
      store.close();
    }
  });

  it("reports a legacy generation rejection that cannot be recorded with its run ID", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = store.enqueue({program: "ZGG_EX_012", generation: "obsolete"});
      store.db.exec(`CREATE TRIGGER reject_failed_job BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'JOB_FAILED' BEGIN SELECT RAISE(FAIL, 'log unavailable'); END`);
      let called = false;
      let caught;
      try { await workQueuedBatch(root, store, async () => { called = true; }); }
      catch (error) { caught = error; }
      expect(called).to.equal(false);
      expect(caught).to.include({code: "RESULT_RECORDING_FAILED", runId: run.id});
      expect(store.get(run.id).state).to.equal("RUNNING");
      expect(store.claimNext()).to.deep.equal({kind: "busy", id: run.id});
    } finally { store.close(); }
  });

  it("reports a multi-step generation rejection that cannot be recorded with its step number", async () => {
    const store = new BatchRuns(root, env);
    const previous = globalThis.abap;
    const sourceDb = join(dir, "business.sqlite");
    globalThis.abap = {context: {databaseConnections: {DEFAULT: {path: sourceDb}}, osdGeneration: "new"},
      builtin: {sy: {get: () => ({mandt: {get: () => "123"}, sysid: {get: () => "OSD"},
        uname: {get: () => "DEVELOPER"}})}}};
    try {
      const {run} = store.importIntent({intentId: randomUUID().replaceAll("-", ""),
        sourceDb, client: "123", sysid: "OSD", owner: "DEVELOPER", jobname: "CHAIN",
        jobcount: "00000002", program: "ZGG_EX_012", generation: "old",
        steps: [{number: 1, program: "ZGG_EX_012"}, {number: 2, program: "ZGG_EX_012"}]});
      store.db.exec(`CREATE TRIGGER reject_failed_step BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'JOB_FAILED' BEGIN SELECT RAISE(FAIL, 'log unavailable'); END`);
      let called = false;
      let caught;
      try { await workQueuedBatch(root, store, async () => { called = true; }); }
      catch (error) { caught = error; }
      expect(called).to.equal(false);
      expect(caught).to.include({code: "RESULT_RECORDING_FAILED", runId: run.id, stepNumber: 1});
      expect(store.get(run.id).state).to.equal("RUNNING");
      expect(store.get(run.id).steps.map((step) => step.state)).to.deep.equal(["RUNNING", "PENDING"]);
      expect(store.claimNext().kind).to.equal("busy");
    } finally {
      globalThis.abap = previous;
      store.close();
    }
  });

  it("preserves the execution error when recording that failure also fails", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = store.enqueue({program: "ZGG_EX_012", generation: liveGeneration(root)});
      store.db.exec(`CREATE TRIGGER reject_failed_execution BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'JOB_FAILED' BEGIN SELECT RAISE(FAIL, 'log unavailable'); END`);
      const executionError = new Error("report's private diagnostic");
      let caught;
      try { await workQueuedBatch(root, store, async () => { throw executionError; }); }
      catch (error) { caught = error; }
      expect(caught).to.include({code: "RESULT_RECORDING_FAILED", runId: run.id});
      expect(caught.executionError).to.equal(executionError);
      expect(caught.message).not.to.include("private diagnostic");
      expect(store.get(run.id).state).to.equal("RUNNING");
    } finally { store.close(); }
  });

  it("leaves a completed report step RUNNING when recording its result fails, without replay after restart", async () => {
    const store = new BatchRuns(root, env);
    const before = globalThis.abap;
    const sourceDb = join(dir, "business.sqlite");
    globalThis.abap = {context: {databaseConnections: {DEFAULT: {path: sourceDb}}, osdGeneration: "test"},
      builtin: {sy: {get: () => ({mandt: {get: () => "123"}, sysid: {get: () => "OSD"},
        uname: {get: () => "DEVELOPER"}})}}};
    let runId;
    const effectFile = join(dir, "business-effects.txt");
    try {
      const imported = store.importIntent({intentId: randomUUID().replaceAll("-", ""),
        sourceDb, client: "123", sysid: "OSD", owner: "DEVELOPER", jobname: "CHAIN",
        jobcount: "00000001", program: "ZGG_EX_012", generation: "test",
        steps: [{number: 1, program: "ZGG_EX_012"}, {number: 2, program: "ZGG_EX_012"}]});
      runId = imported.run.id;
      store.db.exec(`CREATE TRIGGER reject_step_result BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'STEP_COMPLETED' BEGIN SELECT RAISE(FAIL, 'result log unavailable'); END`);
      try {
        await workQueuedBatch(root, store, async () => {
          appendFileSync(effectFile, "posted\n");
          return {status: "COMPLETED", lines: ["done"]};
        });
        expect.fail("recording should fail");
      } catch (error) {
        expect(error).to.include({code: "RESULT_RECORDING_FAILED", runId, stepNumber: 1});
        expect(error.message).to.include("inspect its state and business effects");
      }
      const run = store.get(runId);
      expect(run.state).to.equal("RUNNING");
      expect(run.steps.map((step) => step.state)).to.deep.equal(["RUNNING", "PENDING"]);
      expect(store.db.prepare("SELECT event_code FROM batch_job_log WHERE run_id = ? ORDER BY seq")
        .all(runId).map((row) => row.event_code)).to.deep.equal(["IMPORTED", "STEP_STARTED"]);
    } finally {
      store.close();
    }
    const reopened = new BatchRuns(root, env);
    try {
      expect(await workQueuedBatch(root, reopened, async () => { appendFileSync(effectFile, "replayed\n"); }))
        .to.deep.equal({kind: "busy", id: runId});
      expect(readFileSync(effectFile, "utf8")).to.equal("posted\n");
    } finally {
      reopened.close();
      globalThis.abap = before;
    }
  });

  it("keeps a legacy queued run RUNNING if its result cannot be recorded", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = store.enqueue({program: "ZGG_EX_012", generation: liveGeneration(root)});
      store.db.exec(`CREATE TRIGGER reject_legacy_result BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'STEP_COMPLETED' BEGIN SELECT RAISE(FAIL, 'result log unavailable'); END`);
      let caught;
      try { await workQueuedBatch(root, store, async () => ({status: "COMPLETED"})); }
      catch (error) { caught = error; }
      expect(caught).to.include({code: "RESULT_RECORDING_FAILED", runId: run.id});
      expect(store.get(run.id).state).to.equal("RUNNING");
      expect(store.claimNext()).to.deep.equal({kind: "busy", id: run.id});
    } finally { store.close(); }
  });

  it("records an execution exception as a failed queued job", async () => {
    const store = new BatchRuns(root, env);
    try {
      const run = store.enqueue({program: "ZGG_EX_012", generation: liveGeneration(root)});
      const outcome = await workQueuedBatch(root, store, async () => { throw new Error("report dumped"); });
      expect(outcome.kind).to.equal("failed");
      expect(store.get(run.id)).to.include({state: "FAILED", detail: "report dumped"});
    } finally { store.close(); }
  });

  it("does not label direct execution failed when only result recording failed", async () => {
    const store = new BatchRuns(root, env);
    let effects = 0;
    try {
      store.db.exec(`CREATE TRIGGER reject_direct_result BEFORE UPDATE ON batch_runs
        WHEN NEW.state = 'COMPLETED' BEGIN SELECT RAISE(FAIL, 'output unavailable'); END`);
      let caught;
      try {
        await runPersistedBatch(root, {program: "ZGG_EX_012"}, store,
          async () => { effects++; return {status: "COMPLETED", lines: ["done"]}; });
      } catch (error) { caught = error; }
      expect(caught.code).to.equal("RESULT_RECORDING_FAILED");
      expect(store.get(caught.runId).state).to.equal("RUNNING");
      expect(effects).to.equal(1);
    } finally { store.close(); }
  });

  it("a worker crash leaves the claimed run visible and blocks another claim", () => {
    const store = new BatchRuns(root, env);
    const a = store.enqueue({program: "ZGG_EX_012"});
    const b = store.enqueue({program: "ZGG_EX_012"});
    expect(store.claimNext().run.id).to.equal(a.id);
    store.close();
    const reopened = new BatchRuns(root, env);
    try {
      expect(reopened.get(a.id).state).to.equal("RUNNING");
      expect(reopened.claimNext()).to.deep.equal({kind: "busy", id: a.id});
      expect(reopened.interruptQueued(a.id).state).to.equal("INTERRUPTED");
      expect(reopened.claimNext().run.id).to.equal(b.id);
      expect(() => reopened.interruptQueued(a.id)).to.throw(/not RUNNING/);
    } finally {
      reopened.close();
    }
  });

  it("opens a saved-run database from the preceding slice without losing its rows", () => {
    const old = new DatabaseSync(env.OSD_OPERATIONS_DB);
    old.exec(`CREATE TABLE batch_runs (
      id TEXT PRIMARY KEY, program TEXT NOT NULL, generation TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL,
      result_status TEXT, detail TEXT, input_json TEXT NOT NULL,
      output_sha256 TEXT, output_bytes INTEGER
    )`);
    const id = randomUUID();
    old.prepare("INSERT INTO batch_runs (id, program, generation, started_at, state, input_json) VALUES (?, 'ZGG_EX_012', 'old', '2026-09-28T00:00:00Z', 'RUNNING', '[]')").run(id);
    old.close();
    const upgraded = new BatchRuns(root, env);
    try {
      expect(upgraded.get(id).program).to.equal("ZGG_EX_012");
      expect(upgraded.get(id).queuedAt).to.equal(null);
      expect(upgraded.enqueue({program: "ZGG_EX_012"}).state).to.equal("QUEUED");
    } finally {
      upgraded.close();
    }
  });

  it("guards the read API and returns redacted runs plus digest-checked output", async () => {
    const store = new BatchRuns(root, env);
    const run = await runPersistedBatch(root,
      {program: "ZGG_EX_012", input: [{name: "P_DATE", value: "private-value"}]},
      store, async () => ({status: "COMPLETED", lines: ["visible list"]}));
    store.close();
    const token = randomUUID().replaceAll("-", "");
    const app = express();
    app.get("/osd/batch-runs", batchMonitorHandler(root, {...env, OSD_BATCH_READ_TOKEN: token}));
    app.get("/closed", batchMonitorHandler(root, env));
    const server = await new Promise((done) => {
      const listener = app.listen(0, "127.0.0.1", () => done(listener));
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const auth = {Authorization: `Bearer ${token}`};
      expect((await fetch(`${url}/closed`, {headers: auth})).status).to.equal(404);
      expect((await fetch(`${url}/osd/batch-runs`)).status).to.equal(401);
      expect((await fetch(`${url}/osd/batch-runs`, {headers: {Authorization: "Bearer wrong"}})).status).to.equal(401);
      const listed = await fetch(`${url}/osd/batch-runs?limit=1`, {headers: auth});
      expect(listed.status).to.equal(200);
      expect(listed.headers.get("cache-control")).to.equal("no-store");
      const body = await listed.json();
      expect(body.runs.map((item) => item.id)).to.deep.equal([run.id]);
      expect(JSON.stringify(body)).not.to.include("private-value");
      const detail = await (await fetch(`${url}/osd/batch-runs?id=${run.id}`, {headers: auth})).json();
      expect(detail.run.input).to.deep.equal([{name: "P_DATE"}]);
      const output = await (await fetch(`${url}/osd/batch-runs?id=${run.id}&output=1`, {headers: auth})).json();
      expect(output.output.lines).to.deep.equal(["visible list"]);
      expect((await fetch(`${url}/osd/batch-runs?output=1`, {headers: auth})).status).to.equal(400);
      writeFileSync(join(dir, "batch-output", `${run.id}.json`), "tampered");
      expect((await fetch(`${url}/osd/batch-runs?id=${run.id}&output=1`, {headers: auth})).status).to.equal(500);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});

describe("job step input bounds", function () {
  it("accepts the largest valid input even when JSON escaping inflates it", async function () {
    const {jobInputJson, JOB_INPUT_JSON_MAX} = await import("../tools/osd-job-input.mjs");
    const input = Array.from({length: 20}, (_, i) => ({NAME: `P_${String(i).padStart(2, "0")}`, VALUE: "\u0001".repeat(255)}));
    const json = JSON.stringify(input);
    expect(json.length).to.be.above(12000);
    expect(json.length).to.be.at.most(JOB_INPUT_JSON_MAX);
    const parsed = jobInputJson(json);
    expect(parsed).to.have.length(20);
    expect(parsed[19]).to.deep.equal({name: "P_19", value: "\u0001".repeat(255)});
  });

  it("still rejects what exceeds the field bounds and oversized raw payloads", async function () {
    const {jobInputJson, JOB_INPUT_JSON_MAX} = await import("../tools/osd-job-input.mjs");
    expect(() => jobInputJson(JSON.stringify([{NAME: "P_X", VALUE: "x".repeat(256)}]))).to.throw(/max 255/);
    expect(() => jobInputJson(JSON.stringify(Array.from({length: 21}, (_, i) => ({NAME: `P${i}`, VALUE: "v"}))))).to.throw(/at most 20/);
    expect(() => jobInputJson(" ".repeat(JOB_INPUT_JSON_MAX + 1))).to.throw(/too large/);
  });
});
