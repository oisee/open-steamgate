import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";
import {readJobLog} from "../tools/osd-job-log.mjs";
import {readJobSnapshot} from "../tools/osd-job-snapshot.mjs";

const root = resolve(".");
const caller = {client: "123", user: "DEVELOPER", sid: "OSG"};

describe("private durable job status snapshot", function () {
  let dir, sourceDb, operationsDb, env;
  const read = (jobName, jobCount, who = caller) => readJobSnapshot({
    sourceDb, jobName, jobCount, caller: who, root, env,
  });
  const log = (jobName, jobCount, who = caller) => readJobLog({
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
  const imported = (job, {legacy = false, jobname = job.name, afterEvent} = {}) => {
    const store = new BatchRuns(root, env);
    try {
      const answer = store.importIntent({intentId: job.intentId, sourceDb,
        client: caller.client, sysid: caller.sid, owner: caller.user,
        jobname, jobcount: job.count, program: job.programs[0],
        generation: "generation-1", ...(legacy ? {} : {steps: job.programs.map((program, index) =>
          ({number: index + 1, program}))}), ...(afterEvent ? {afterEvent} : {})});
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
    assert.deepEqual(snapshot.steps.map((step) => step.input), [[], [], []]);
    edit((db) => assert.equal(db.prepare("PRAGMA table_info(zosd_job_step)").all()
      .some((column) => column.name === "input_json"), false));
    assert.equal(existsSync(operationsDb), false);
  });

  it("validates waiting and released dependency states against the event ledger", () => {
    reserve("PARENT", "00000030");
    const parent = bind("PARENT", "00000030", ["Z_ALPHA"]);
    reserve("CHILD", "00000031");
    const child = bind("CHILD", "00000031", ["Z_BETA"]);
    const childId = imported(child, {afterEvent: {jobname: "PARENT", jobcount: "00000030"}});
    assert.equal(read(child.name, child.count).state, "WAITING");
    assert.equal(read(child.name, child.count).steps[0].state, "PENDING");
    const store = new BatchRuns(root, env);
    try {
      const parentId = imported(parent);
      assert.equal(store.claimNext().run.id, parentId);
      store.finishStep(parentId, 1, {status: "COMPLETED"});
      assert.equal(read(child.name, child.count).state, "QUEUED");
      store.db.prepare("DELETE FROM batch_job_events WHERE run_id = ?").run(parentId);
      assert.throws(() => read(child.name, child.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});
      assert.equal(store.get(childId).state, "QUEUED");
    } finally { store.close(); }
  });

  it("keeps a released v3 child readable after another run reuses its predecessor key", () => {
    reserve("PARENT", "00000030");
    const parent = bind("PARENT", "00000030", ["Z_ALPHA"]);
    reserve("CHILD", "00000031");
    const child = bind("CHILD", "00000031", ["Z_BETA"]);
    const store = new BatchRuns(root, env);
    try {
      const first = imported(parent);
      imported(child, {afterEvent: {jobname: "PARENT", jobcount: "00000030"}});
      store.claimNext();
      store.finishStep(first, 1, {status: "COMPLETED"});
      assert.equal(read(child.name, child.count).state, "QUEUED");
      const activeChild = store.claimNext().run.id;
      store.finishStep(activeChild, 1, {status: "COMPLETED"});
      const later = store.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb,
        client: caller.client, sysid: caller.sid, owner: caller.user,
        jobname: "PARENT", jobcount: "00000030", program: "Z_ALPHA",
        generation: "generation-1", steps: [{number: 1, program: "Z_ALPHA"}]}).run;
      store.claimNext();
      store.finishStep(later.id, 1, {status: "COMPLETED"});
      assert.equal(read(child.name, child.count).state, "COMPLETED");
      assert.equal(log(child.name, child.count).entries.at(-1).event, "JOB_COMPLETED");
    } finally { store.close(); }
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

  it("detects Unicode historic names without SQLite's ASCII-only UPPER", () => {
    edit((db) => db.prepare(`INSERT INTO zosd_job_outbox
      (mandt, intent_id, sysid, source_db, jobname, jobcount, owner, program, step_count)
      VALUES ('123', ?, 'OSG', ?, 'nächtlich', '00000017', 'DEVELOPER', 'Z_OLD', '00')`)
      .run(randomUUID().replaceAll("-", ""), sourceDb));
    assert.throws(() => read("NÄCHTLICH", "00000017"), {code: "JOB_LEGACY_UNSUPPORTED"});
    const store = new BatchRuns(root, env);
    try {
      store.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb,
        client: caller.client, sysid: caller.sid, owner: caller.user,
        jobname: "nächtlich", jobcount: "00000018", program: "Z_OLD",
        generation: "generation-1"});
    } finally { store.close(); }
    assert.throws(() => read("NÄCHTLICH", "00000018"), {code: "JOB_LEGACY_UNSUPPORTED"});
  });

  it("uses pending outbox with a real pre-multistep operations schema, then signals its imported run", () => {
    reserve("V1_SCHEMA", "00000019");
    const job = bind("V1_SCHEMA", "00000019", ["Z_OLD"]);
    const old = new DatabaseSync(operationsDb);
    try {
      old.exec(`CREATE TABLE batch_runs (
        id TEXT PRIMARY KEY, program TEXT NOT NULL, generation TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT, state TEXT NOT NULL,
        result_status TEXT, detail TEXT, input_json TEXT NOT NULL,
        output_sha256 TEXT, output_bytes INTEGER, queued_at TEXT,
        source_db TEXT, source_client TEXT, source_sysid TEXT, source_owner TEXT,
        job_name TEXT, job_count TEXT);
        CREATE TABLE batch_imports (
          intent_id TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, run_id TEXT NOT NULL);`);
      assert.equal(read(job.name, job.count).phase, "OUTBOX");
      const id = `${job.intentId.slice(0, 8)}-${job.intentId.slice(8, 12)}-${job.intentId.slice(12, 16)}-${job.intentId.slice(16, 20)}-${job.intentId.slice(20)}`;
      const payload = JSON.stringify({sourceDb, client: caller.client, sysid: caller.sid,
        jobname: job.name, jobcount: job.count, owner: caller.user,
        program: "Z_OLD", generation: "generation-1"});
      old.prepare("INSERT INTO batch_imports VALUES (?, ?, ?)")
        .run(job.intentId, createHash("sha256").update(payload).digest("hex"), id);
      old.prepare(`INSERT INTO batch_runs
        (id, program, generation, started_at, state, input_json, queued_at,
         source_db, source_client, source_sysid, source_owner, job_name, job_count)
         VALUES (?, 'Z_OLD', 'generation-1', '', 'QUEUED', '[]', '2026-09-29T00:00:00Z',
           ?, '123', 'OSG', 'DEVELOPER', 'V1_SCHEMA', '00000019')`).run(id, sourceDb);
    } finally { old.close(); }
    assert.throws(() => read(job.name, job.count), {code: "JOB_LEGACY_UNSUPPORTED"});
    acknowledge(job);
    assert.throws(() => read(job.name, job.count), {code: "JOB_LEGACY_UNSUPPORTED"});
    const damaged = new DatabaseSync(operationsDb);
    try {
      const digest = damaged.prepare("SELECT payload_sha256 FROM batch_imports WHERE intent_id = ?")
        .get(job.intentId).payload_sha256;
      damaged.prepare("UPDATE batch_imports SET payload_sha256 = ? WHERE intent_id = ?")
        .run("0".repeat(64), job.intentId);
      assert.throws(() => read(job.name, job.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});
      damaged.prepare("UPDATE batch_imports SET payload_sha256 = ? WHERE intent_id = ?")
        .run(digest, job.intentId);
      damaged.exec("ALTER TABLE batch_runs ADD COLUMN step_count INTEGER NOT NULL DEFAULT 0");
    }
    finally { damaged.close(); }
    assert.throws(() => read(job.name, job.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});
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

  it("keeps two ordered steps and their technical log across a restart", () => {
    reserve("LOG_CHAIN", "00000020");
    const job = bind("LOG_CHAIN", "00000020");
    assert.deepEqual(log(job.name, job.count), {phase: "OUTBOX", entries: [], historicalGap: false});
    const id = imported(job);
    acknowledge(job);
    const first = new BatchRuns(root, env);
    try {
      first.claimNext();
      first.finishStep(id, 1, {status: "COMPLETED", lines: ["secret list"],
        messages: [{text: "arbitrary application message"}]});
    } finally { first.close(); }
    const second = new BatchRuns(root, env);
    try {
      second.claimNext();
      second.finishStep(id, 2, {status: "COMPLETED", lines: ["secret list 2"]});
    } finally { second.close(); }
    assert.deepEqual(log(job.name, job.count).entries.map(({sequence, step, event}) =>
      [sequence, step, event]), [
      [1, null, "IMPORTED"], [2, 1, "STEP_STARTED"], [3, 1, "STEP_COMPLETED"],
      [4, 2, "STEP_STARTED"], [5, 2, "STEP_COMPLETED"], [6, null, "JOB_COMPLETED"],
    ]);
    assert.equal(JSON.stringify(log(job.name, job.count)).includes("secret list"), false);
    assert.equal(JSON.stringify(log(job.name, job.count)).includes("arbitrary application message"), false);
    assert.equal(log(job.name, job.count).historicalGap, false);
    assert.equal(log(job.name, job.count, {...caller, client: "999"}), undefined);
    assert.throws(() => log(job.name, job.count, {...caller, user: "OTHER"}),
      {code: "JOB_READ_FORBIDDEN"});
  });

  it("logs failure and interruption without creating synthetic completion", () => {
    reserve("LOG_FAILED", "00000021");
    const failed = bind("LOG_FAILED", "00000021", ["Z_A", "Z_B", "Z_C"]);
    const failedId = imported(failed);
    const store = new BatchRuns(root, env);
    try {
      store.claimNext();
      store.failStep(failedId, 1, new Error("private failure detail"));
      assert.deepEqual(log(failed.name, failed.count).entries.map(({event}) => event),
        ["IMPORTED", "STEP_STARTED", "STEP_FAILED", "JOB_FAILED"]);
      assert.equal(JSON.stringify(log(failed.name, failed.count)).includes("private failure detail"), false);
      reserve("LOG_CRASH", "00000022");
      const crashed = bind("LOG_CRASH", "00000022");
      const crashedId = imported(crashed);
      assert.equal(store.claimNext().run.id, crashedId);
      assert.deepEqual(log(crashed.name, crashed.count).entries.map(({event}) => event),
        ["IMPORTED", "STEP_STARTED"]);
      store.interruptQueued(crashedId);
      assert.deepEqual(log(crashed.name, crashed.count).entries.map(({event}) => event),
        ["IMPORTED", "STEP_STARTED", "STEP_INTERRUPTED", "JOB_INTERRUPTED"]);
    } finally { store.close(); }
  });

  it("does not repeat import entries or commit an uncommitted caller job", () => {
    reserve("LOG_RETRY", "00000023");
    const job = bind("LOG_RETRY", "00000023");
    imported(job);
    imported(job);
    assert.deepEqual(log(job.name, job.count).entries.map(({event}) => event), ["IMPORTED"]);
    edit((db) => {
      db.exec("BEGIN");
      db.prepare(`INSERT INTO zosd_job_identity VALUES
        ('123', 'LOG_UNCOMMITTED', '00000024', 'DEVELOPER', '')`).run();
      assert.equal(log("LOG_UNCOMMITTED", "00000024"), undefined);
      db.exec("ROLLBACK");
    });
    assert.equal(log("LOG_UNCOMMITTED", "00000024"), undefined);
  });

  it("rolls back a step transition when the technical log insert fails", () => {
    reserve("LOG_ATOMIC", "00000025");
    const job = bind("LOG_ATOMIC", "00000025");
    const id = imported(job);
    const store = new BatchRuns(root, env);
    try {
      store.claimNext();
      store.db.exec(`CREATE TRIGGER refuse_completed_log BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'STEP_COMPLETED' BEGIN SELECT RAISE(FAIL, 'log refused'); END`);
      assert.throws(() => store.finishStep(id, 1, {status: "COMPLETED", lines: []}), /log refused/);
      assert.equal(store.get(id).state, "RUNNING");
      assert.deepEqual(store.get(id).steps.map(({state}) => state), ["RUNNING", "PENDING"]);
      assert.deepEqual(log(job.name, job.count).entries.map(({event}) => event),
        ["IMPORTED", "STEP_STARTED"]);
    } finally { store.close(); }
  });

  it("logs an imported legacy one-step job atomically through finish and fail", () => {
    for (const [name, count, success] of [["OLD_DONE", "00000026", true],
      ["OLD_FAIL", "00000027", false]]) {
      reserve(name, count);
      const job = bind(name, count, ["Z_OLD"]);
      edit((db) => {
        db.prepare("UPDATE zosd_job_outbox SET step_count = '00' WHERE intent_id = ?").run(job.intentId);
        db.prepare("DELETE FROM zosd_job_step WHERE intent_id = ?").run(job.intentId);
      });
      const id = imported(job, {legacy: true});
      const store = new BatchRuns(root, env);
      try {
        assert.equal(store.claimNext().run.id, id);
        if (success) store.finish(id, {status: "COMPLETED", lines: ["private list"]});
        else store.fail(id, new Error("private failure"));
        assert.deepEqual(log(name, count).entries.map(({event}) => event),
          ["IMPORTED", "STEP_STARTED", success ? "STEP_COMPLETED" : "STEP_FAILED",
            success ? "JOB_COMPLETED" : "JOB_FAILED"]);
      } finally { store.close(); }
    }
  });

  it("reopens an old operations DB with an explicit historical log gap", () => {
    reserve("LOG_HISTORY", "00000028");
    const job = bind("LOG_HISTORY", "00000028");
    const id = imported(job);
    const db = new DatabaseSync(operationsDb);
    try { db.exec("DROP TABLE batch_job_log"); } finally { db.close(); }
    const reopened = new BatchRuns(root, env);
    try {
      assert.deepEqual(log(job.name, job.count),
        {phase: "OPERATIONS", entries: [], historicalGap: true});
      assert.equal(reopened.claimNext().run.id, id);
      assert.deepEqual(log(job.name, job.count).entries.map(({event}) => event), ["STEP_STARTED"]);
      assert.equal(log(job.name, job.count).historicalGap, true);
    } finally { reopened.close(); }
  });

  it("records the second active step when a restarted worker is interrupted", () => {
    reserve("LOG_LATE_CRASH", "00000030");
    const job = bind("LOG_LATE_CRASH", "00000030");
    const id = imported(job);
    const first = new BatchRuns(root, env);
    try {
      first.claimNext();
      first.finishStep(id, 1, {status: "COMPLETED", lines: []});
    } finally { first.close(); }
    const second = new BatchRuns(root, env);
    try {
      assert.equal(second.claimNext().step, 2);
    } finally { second.close(); }
    const restarted = new BatchRuns(root, env);
    try {
      restarted.interruptQueued(id);
      assert.deepEqual(log(job.name, job.count).entries.slice(-2).map(({step, event}) => [step, event]),
        [[2, "STEP_INTERRUPTED"], [null, "JOB_INTERRUPTED"]]);
    } finally { restarted.close(); }
  });

  it("refuses a mutated imported payload when reading its log", () => {
    reserve("LOG_TAMPER", "00000031");
    const job = bind("LOG_TAMPER", "00000031");
    const id = imported(job);
    assert.equal(read(job.name, job.count).phase, "OPERATIONS");
    const writer = new DatabaseSync(operationsDb);
    try {
      writer.prepare("UPDATE batch_run_steps SET program = 'Z_OTHER' WHERE run_id = ? AND step_no = 2")
        .run(id);
    } finally { writer.close(); }
    assert.throws(() => log(job.name, job.count), {code: "JOB_SNAPSHOT_INCONSISTENT"});
  });

  it("rolls back a new import if its first log entry cannot be stored", () => {
    const store = new BatchRuns(root, env);
    try {
      store.db.exec(`CREATE TRIGGER refuse_import_log BEFORE INSERT ON batch_job_log
        WHEN NEW.event_code = 'IMPORTED' BEGIN SELECT RAISE(FAIL, 'log refused'); END`);
      const intentId = randomUUID().replaceAll("-", "");
      assert.throws(() => store.importIntent({intentId, sourceDb, client: caller.client,
        sysid: caller.sid, owner: caller.user, jobname: "LOG_IMPORT_FAIL",
        jobcount: "00000029", program: "Z_A", generation: "generation-1",
        steps: [{number: 1, program: "Z_A"}]}), /log refused/);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM batch_runs").get().n, 0);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM batch_imports").get().n, 0);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM batch_run_steps").get().n, 0);
    } finally { store.close(); }
  });
});
