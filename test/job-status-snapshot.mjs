import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";
import {readJobSnapshot} from "../tools/osd-job-snapshot.mjs";

const root = resolve(".");
const caller = {client: "123", user: "DEVELOPER", sid: "OSG"};

describe("private durable job status snapshot", function () {
  let dir, sourceDb, operationsDb, env;
  const read = (jobName, jobCount, who = caller) => readJobSnapshot({
    sourceDb, jobName, jobCount, caller: who, root, env,
  });
  const edit = (work) => {
    const db = new DatabaseSync(sourceDb);
    try { return work(db); } finally { db.close(); }
  };
  const reserve = (name, count, owner = caller.user) => edit((db) => db.prepare(`INSERT INTO zosd_job_identity
    (mandt, jobname, jobcount, owner, intent_id) VALUES (?, ?, ?, ?, '')`).run(caller.client, name, count, owner));
  const bind = (name, count, programs = ["Z_FIRST", "Z_SECOND"]) => {
    const intentId = randomUUID().replaceAll("-", "");
    edit((db) => {
      db.exec("BEGIN");
      try {
        db.prepare(`UPDATE zosd_job_identity SET intent_id = ?
          WHERE mandt = ? AND jobname = ? AND jobcount = ?`).run(intentId, caller.client, name, count);
        db.prepare(`INSERT INTO zosd_job_outbox
          (mandt, intent_id, sysid, source_db, jobname, jobcount, owner, program,
           step_count, generation, created_on, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generation-1', '20260929', '091500')`)
          .run(caller.client, intentId, caller.sid, sourceDb, name, count, caller.user,
            programs[0], String(programs.length).padStart(2, "0"));
        for (let i = 0; i < programs.length; i++) {
          db.prepare(`INSERT INTO zosd_job_step (mandt, intent_id, step_no, program)
            VALUES (?, ?, ?, ?)`).run(caller.client, intentId, String(i + 1).padStart(2, "0"), programs[i]);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    });
    return {intentId, name, count, programs};
  };
  const imported = (job, {legacy = false, jobname = job.name} = {}) => {
    const store = new BatchRuns(root, env);
    try {
      const answer = store.importIntent({intentId: job.intentId, sourceDb,
        client: caller.client, sysid: caller.sid, owner: caller.user,
        jobname, jobcount: job.count, program: job.programs[0],
        generation: "generation-1", ...(legacy ? {} : {steps: job.programs.map((program, index) =>
          ({number: index + 1, program}))})});
      return answer.run.id;
    } finally { store.close(); }
  };
  const acknowledge = (job) => edit((db) => {
    db.prepare("DELETE FROM zosd_job_step WHERE intent_id = ?").run(job.intentId);
    db.prepare("DELETE FROM zosd_job_outbox WHERE intent_id = ?").run(job.intentId);
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-job-snapshot-"));
    sourceDb = join(dir, "business.sqlite");
    operationsDb = join(dir, "operations.sqlite");
    env = {OSD_OPERATIONS_DB: operationsDb};
    edit((db) => db.exec(`
      CREATE TABLE zosd_job_identity (mandt TEXT, jobname TEXT, jobcount TEXT,
        owner TEXT, intent_id TEXT, PRIMARY KEY (mandt, jobname, jobcount));
      CREATE TABLE zosd_job_outbox (mandt TEXT, intent_id TEXT PRIMARY KEY,
        sysid TEXT, source_db TEXT, jobname TEXT, jobcount TEXT, owner TEXT,
        program TEXT, step_count TEXT, generation TEXT, created_on TEXT, created_at TEXT);
      CREATE TABLE zosd_job_step (mandt TEXT, intent_id TEXT, step_no TEXT, program TEXT,
        PRIMARY KEY (mandt, intent_id, step_no));
    `));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  it("reads a committed but unbound OPEN reservation without creating an operations file", () => {
    reserve("HELD", "00000001");
    assert.equal(read("HELD", "00000001").phase, "RESERVED");
    assert.deepEqual(read("HELD", "00000001").steps, []);
    assert.equal(existsSync(operationsDb), false);
  });

  it("does not see uncommitted OPEN and does not commit its caller", () => {
    edit((db) => {
      db.exec("BEGIN");
      db.prepare(`INSERT INTO zosd_job_identity VALUES
        ('123', 'UNCOMMITTED', '00000002', 'DEVELOPER', '')`).run();
      assert.equal(read("UNCOMMITTED", "00000002"), undefined);
      db.exec("ROLLBACK");
    });
    assert.equal(read("UNCOMMITTED", "00000002"), undefined);
  });

  it("reads committed outbox parent and ordered steps", () => {
    reserve("WAITING", "00000003");
    bind("WAITING", "00000003", ["Z_ALPHA", "Z_BETA", "Z_GAMMA"]);
    const snapshot = read("WAITING", "00000003");
    assert.equal(snapshot.phase, "OUTBOX");
    assert.equal(snapshot.state, "READY");
    assert.equal(snapshot.createdOn, "20260929");
    assert.deepEqual(snapshot.steps.map(({number, program, state}) => ({number, program, state})), [
      {number: 1, program: "Z_ALPHA", state: "READY"},
      {number: 2, program: "Z_BETA", state: "PENDING"},
      {number: 3, program: "Z_GAMMA", state: "PENDING"},
    ]);
    assert.equal(existsSync(operationsDb), false);
  });

  it("reads a pending outbox with an older operations file", () => {
    reserve("OLD_STORE", "00000012");
    bind("OLD_STORE", "00000012");
    const old = new DatabaseSync(operationsDb);
    try { old.exec("CREATE TABLE batch_runs (id TEXT PRIMARY KEY)"); }
    finally { old.close(); }
    assert.equal(read("OLD_STORE", "00000012").phase, "OUTBOX");
  });

  it("accepts names and runtime users allowed by the job producer", () => {
    const who = {...caller, user: "OPS.USER-1"};
    reserve("NIGHTLY - AUDIT", "00000013", who.user);
    assert.equal(read("nightly - audit", "00000013", who).phase, "RESERVED");
    const job = {name: "NIGHTLY - AUDIT", count: "00000013", programs: ["Z_ALPHA"],
      intentId: randomUUID().replaceAll("-", "")};
    edit((db) => {
      db.prepare("UPDATE zosd_job_identity SET intent_id = ? WHERE jobname = ?")
        .run(job.intentId, job.name);
      db.prepare(`INSERT INTO zosd_job_outbox VALUES
        ('123', ?, 'OSG', ?, ?, ?, ?, 'Z_ALPHA', '01', 'generation-1', '20260929', '091500')`)
        .run(job.intentId, sourceDb, job.name, job.count, who.user);
      db.prepare("INSERT INTO zosd_job_step VALUES ('123', ?, '01', 'Z_ALPHA')").run(job.intentId);
    });
    assert.equal(read(job.name, job.count, who).steps[0].program, "Z_ALPHA");
    assert.throws(() => read(job.name, job.count, caller), {code: "JOB_READ_FORBIDDEN"});
  });

  it("synthesizes one step for migrated one-step intents and imported runs", () => {
    reserve("LEGACY - ONE", "00000014");
    const job = bind("LEGACY - ONE", "00000014", ["Z_OLD"]);
    edit((db) => {
      db.prepare("UPDATE zosd_job_outbox SET jobname = 'legacy - one', step_count = '00' WHERE intent_id = ?")
        .run(job.intentId);
      db.prepare("DELETE FROM zosd_job_step WHERE intent_id = ?").run(job.intentId);
    });
    assert.deepEqual(read(job.name, job.count).steps.map((step) => [step.number, step.program, step.state]),
      [[1, "Z_OLD", "READY"]]);
    const id = imported(job, {legacy: true, jobname: "legacy - one"});
    assert.deepEqual(read(job.name, job.count).steps.map((step) => [step.number, step.program, step.state]),
      [[1, "Z_OLD", "READY"]]);
    acknowledge(job);
    const store = new BatchRuns(root, env);
    try {
      assert.equal(store.claimNext().kind, "claimed");
      assert.equal(read(job.name, job.count).steps[0].state, "RUNNING");
      store.finish(id, {status: "COMPLETED", lines: ["old list"]});
    } finally { store.close(); }
    const done = read(job.name, job.count);
    assert.equal(done.state, "COMPLETED");
    assert.deepEqual(done.steps.map((step) => [step.number, step.program, step.state]),
      [[1, "Z_OLD", "COMPLETED"]]);
  });

  it("reports pre-identity completed jobs explicitly as unsupported", () => {
    const store = new BatchRuns(root, env);
    try {
      store.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb,
        client: caller.client, sysid: caller.sid, owner: caller.user,
        jobname: "PRE_IDENTITY", jobcount: "00000015", program: "Z_OLD",
        generation: "generation-1"});
    } finally { store.close(); }
    assert.throws(() => read("PRE_IDENTITY", "00000015"), {code: "JOB_LEGACY_UNSUPPORTED"});
    assert.equal(read("PRE_IDENTITY", "00000015", {...caller, client: "999"}), undefined);
  });

  it("prefers imported operations over still-pending outbox and survives acknowledgement and restart", () => {
    reserve("IMPORTED", "00000004");
    const job = bind("IMPORTED", "00000004");
    const id = imported(job);
    assert.equal(read(job.name, job.count).phase, "OPERATIONS");
    assert.deepEqual(read(job.name, job.count).steps.map((step) => step.state), ["READY", "PENDING"]);
    acknowledge(job);
    const store = new BatchRuns(root, env);
    try {
      assert.equal(store.claimNext().kind, "claimed");
      store.finishStep(id, 1, {status: "COMPLETED", lines: ["private list line"]});
    } finally { store.close(); }
    const child = spawnSync(process.execPath,
      [join(root, "test/fixtures/job-status-snapshot.mjs"), sourceDb, operationsDb, job.name, job.count],
      {cwd: root, encoding: "utf8"});
    assert.ifError(child.error);
    assert.equal(child.status, 0, JSON.stringify({stderr: child.stderr, stdout: child.stdout, error: String(child.error)}));
    const restarted = JSON.parse(child.stdout);
    assert.equal(restarted.state, "QUEUED");
    assert.deepEqual(restarted.steps.map((step) => step.state), ["COMPLETED", "READY"]);
    assert.equal(JSON.stringify(restarted).includes("private list line"), false);
  });

  it("reports an active and failed step with later steps skipped", () => {
    reserve("FAILED_CHAIN", "00000010");
    const job = bind("FAILED_CHAIN", "00000010", ["Z_A", "Z_B", "Z_C"]);
    const id = imported(job);
    acknowledge(job);
    const store = new BatchRuns(root, env);
    try {
      assert.equal(store.claimNext().kind, "claimed");
      assert.equal(read(job.name, job.count).state, "RUNNING");
      assert.deepEqual(read(job.name, job.count).steps.map((step) => step.state),
        ["RUNNING", "PENDING", "PENDING"]);
      store.failStep(id, 1, Object.assign(new Error("controlled failure"), {code: "DUMP"}));
    } finally { store.close(); }
    const failed = read(job.name, job.count);
    assert.equal(failed.state, "FAILED");
    assert.deepEqual(failed.steps.map((step) => step.state), ["FAILED", "SKIPPED", "SKIPPED"]);
    assert.equal(failed.steps[0].resultStatus, "DUMP");
  });

  it("reads a completed ordered chain without opening its list artifacts", () => {
    reserve("DONE_CHAIN", "00000011");
    const job = bind("DONE_CHAIN", "00000011");
    const id = imported(job);
    acknowledge(job);
    const store = new BatchRuns(root, env);
    try {
      assert.equal(store.claimNext().kind, "claimed");
      store.finishStep(id, 1, {status: "COMPLETED", lines: ["first output"]});
      assert.equal(store.claimNext().kind, "claimed");
      store.finishStep(id, 2, {status: "COMPLETED", lines: ["second output"]});
    } finally { store.close(); }
    const done = read(job.name, job.count);
    assert.equal(done.state, "COMPLETED");
    assert.deepEqual(done.steps.map((step) => step.state), ["COMPLETED", "COMPLETED"]);
    assert.equal(JSON.stringify(done).includes("output"), false);
  });

  it("rejects missing and inconsistent durable rows", () => {
    reserve("MISSING", "00000005");
    const missing = bind("MISSING", "00000005");
    acknowledge(missing);
    assert.throws(() => read(missing.name, missing.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});

    reserve("BROKEN", "00000006");
    const broken = bind("BROKEN", "00000006");
    edit((db) => db.prepare("DELETE FROM zosd_job_step WHERE intent_id = ? AND step_no = '02'").run(broken.intentId));
    assert.throws(() => read(broken.name, broken.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});

    reserve("MISMATCH", "00000007");
    const mismatch = bind("MISMATCH", "00000007");
    imported(mismatch);
    const ops = new DatabaseSync(operationsDb);
    try { ops.prepare("UPDATE batch_runs SET source_owner = 'OTHER' WHERE job_name = 'MISMATCH'").run(); }
    finally { ops.close(); }
    assert.throws(() => read(mismatch.name, mismatch.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});

    reserve("NO_LEDGER", "00000009");
    const noLedger = bind("NO_LEDGER", "00000009");
    imported(noLedger);
    const orphan = new DatabaseSync(operationsDb);
    try { orphan.prepare("DELETE FROM batch_imports WHERE intent_id = ?").run(noLedger.intentId); }
    finally { orphan.close(); }
    assert.throws(() => read(noLedger.name, noLedger.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});

    reserve("TAMPERED", "00000016");
    const tampered = bind("TAMPERED", "00000016");
    const tamperedId = imported(tampered);
    acknowledge(tampered);
    const changed = new DatabaseSync(operationsDb);
    try {
      changed.prepare("UPDATE batch_runs SET program = 'Z_FAKE' WHERE id = ?").run(tamperedId);
      changed.prepare("UPDATE batch_run_steps SET program = 'Z_FAKE' WHERE run_id = ? AND step_no = 1")
        .run(tamperedId);
    } finally { changed.close(); }
    assert.throws(() => read(tampered.name, tampered.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});
  });

  it("limits reads to the current client and owner", () => {
    reserve("PRIVATE", "00000008");
    bind("PRIVATE", "00000008");
    assert.equal(read("PRIVATE", "00000008", {...caller, client: "999"}), undefined);
    assert.throws(() => read("PRIVATE", "00000008", {...caller, user: "OTHER"}),
      {code: "JOB_READ_FORBIDDEN"});
  });
});
