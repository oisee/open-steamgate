import {expect} from "chai";
import {existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {spawn, spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {BatchRuns, liveGeneration, runConvertedBatch, workQueuedBatch} from "../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../tools/osd-job-outbox.mjs";
import {jobHeaderType} from "./fixtures/job-header.mjs";
import {dialogStep, exclusive} from "../tools/osd-dialog-step.mjs";
import {applyRuntimeHotSwap} from "../tools/osd-hot.mjs";
import {JobDestination} from "../tools/osd-job-port.mjs";
import {identity} from "../tools/osd-identity.mjs";

// the system id the job port checks an outbox row against: the one
// identity of this process (OSD_SID, its alias, else OSD), never a literal
const SID = identity().sid;

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
    jobname: "OSD_ONE_STEP", jobcount: count, report: "ZGG_EX_012",
    authcknam: abap.builtin.sy.get().uname.get().trim(), ...options,
  });
  const close = (count, options = {}) => invoke("JOB_CLOSE", {
    jobname: "OSD_ONE_STEP", jobcount: count, strtimmed: "X", ...options,
  }, ["job_was_released"]);
  const raiseEvent = (eventid, eventparm = "") => invoke("BP_EVENT_RAISE", {eventid, eventparm});
  const status = (name, count) => invoke("ZOSD_JOB_STATUS", {
    iv_jobname: name, iv_jobcount: count,
  }, ["ev_phase", "ev_state", "ev_result_status", "ev_step_count"]);
  const readJob = (name, count, item = "HEADER", index = "") => invoke("ZOSD_JOB_READ", {
    iv_jobname: name, iv_jobcount: count, iv_item: item, iv_index: index,
  }, ["ev_phase", "ev_state", "ev_step_count", "ev_log_count", "ev_historical_gap",
    "ev_wait_kind", "ev_wait_jobname", "ev_wait_jobcount", "ev_wait_event_id",
    "ev_created_on", "ev_created_at", "ev_queued_at", "ev_started_at", "ev_ended_at",
    "ev_step_number", "ev_step_program", "ev_step_state", "ev_input_json",
    "ev_log_sequence", "ev_log_at", "ev_log_event", "ev_log_text"]);
  const doctor = async (name, count, limit = "50") => {
    const table = await abap.Classes.ZCL_OSD_JOB_DOCTOR.inspect({
      iv_jobname: box(name), iv_jobcount: box(count),
      iv_warn_seconds: box("3600"), iv_log_limit: box(limit),
    });
    return table.array().map((line) => line.get()).join("\n");
  };
  const schedule = () => dialogStep(async () => {
    const count = await open();
    await submit(count);
    expect((await close(count)).job_was_released).to.equal("X");
  }, "schedule one report");
  const viaJob = async (name, count, input = []) => {
    const types = abap.Classes.ZIF_GG_SELECTION_SCREEN_TYPES;
    const values = types.ty_values.clone();
    for (const item of input) {
      const row = types.ty_value.clone();
      row.get().name.set(item.name);
      row.get().value.set(item.value);
      values.append(row);
    }
    try {
      await abap.Classes.ZCL_OSD_BATCH_REPORT.submit_via_job({
        iv_program: box("ZGG_EX_012"), iv_jobname: box(name), iv_jobcount: box(count), iv_authcknam: box(abap.builtin.sy.get().uname.get().trim()), it_input: values,
      });
    } catch (error) { throw new Error(error.detail?.get?.() || error.message, {cause: error}); }
  };
  const viaProgram = async (program, name, count, input) => {
    const types = abap.Classes.ZIF_GG_SELECTION_SCREEN_TYPES;
    const values = types.ty_values.clone();
    for (const item of input) {
      const row = types.ty_value.clone();
      row.get().name.set(item.name);
      row.get().value.set(item.value);
      for (const range of item.ranges ?? []) {
        const entry = types.ty_range.clone();
        entry.get().sign.set(range.sign);
        entry.get().option.set(range.option);
        entry.get().low.set(range.low);
        entry.get().high.set(range.high);
        row.get().ranges.append(entry);
      }
      values.append(row);
    }
    try {
      await abap.Classes.ZCL_OSD_BATCH_REPORT.submit_via_job({
        iv_program: box(program), iv_jobname: box(name), iv_jobcount: box(count), iv_authcknam: box(abap.builtin.sy.get().uname.get().trim()), it_input: values,
      });
    } catch (error) { throw new Error(error.detail?.get?.() || error.message, {cause: error}); }
  };
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
  const identityRows = (name) => {
    const reader = new DatabaseSync(dbPath, {readOnly: true});
    try { return reader.prepare("SELECT * FROM zosd_job_identity WHERE mandt = '123' AND jobname = ?")
      .all(name); }
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
    expect(identityRows("OSD_ONE_STEP")).to.have.length(0);
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

  it("reserves a count on OPEN, retains abandoned commits, and releases rollback", async () => {
    let rolledBack;
    await dialogStep(async () => {
      rolledBack = await open("IDENTITY_ROLLBACK");
      await client.rollback();
    });
    expect(identityRows("IDENTITY_ROLLBACK")).to.have.length(0);
    let abandoned;
    await dialogStep(async () => { abandoned = await open("IDENTITY_ABANDONED"); });
    expect(identityRows("IDENTITY_ABANDONED").map((row) => row.jobcount.trim())).to.deep.equal([abandoned]);
    expect(identityRows("IDENTITY_ABANDONED")[0].intent_id.trim()).to.equal("");
    expect(rolledBack).to.match(/^[0-9]{6}[0-9A-Z]{2}$/);
  });

  it("retries reserved and legacy completed counts, including after port restart", async () => {
    const old = abap.context.RFCDestinations.JOBS;
    const legacyCount = "00000017";
    const reservedCount = "00000018";
    const freshCount = "00000019";
    const legacyEnv = {...process.env, OSD_OPERATIONS_DB: join(dir, "identity-legacy-operations.sqlite")};
    const legacyStore = new BatchRuns(root, legacyEnv);
    try {
      legacyStore.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: SID, jobname: "  identity_legacy ", jobcount: legacyCount,
        owner: "DEVELOPER", program: "ZGG_EX_012", generation: liveGeneration(root)});
    } finally { legacyStore.close(); }
    const writer = new DatabaseSync(dbPath);
    try {
      writer.prepare(`INSERT INTO zosd_job_identity (mandt, jobname, jobcount, owner, intent_id)
        VALUES ('123', 'IDENTITY_LEGACY', ?, 'DEVELOPER', '')`).run(reservedCount);
    } finally { writer.close(); }
    const restarted = new JobDestination(root, legacyEnv);
    const numbers = [17, 18, 19];
    restarted.candidate = () => numbers.shift() ?? 19;
    abap.context.RFCDestinations.JOBS = restarted;
    try {
      const count = await dialogStep(() => open("IDENTITY_LEGACY"));
      expect(count).to.equal(freshCount);
      expect(identityRows("IDENTITY_LEGACY").map((row) => row.jobcount.trim()).sort())
        .to.deep.equal([reservedCount, freshCount]);
    } finally { abap.context.RFCDestinations.JOBS = old; }
  });

  it("serializes concurrent OPEN calls against the same retained business key", async () => {
    const jobs = abap.context.RFCDestinations.JOBS;
    const old = jobs.candidate;
    const numbers = [41, 41, 42];
    jobs.candidate = () => numbers.shift() ?? 42;
    try {
      const counts = await Promise.all([
        dialogStep(() => open("IDENTITY_PARALLEL")),
        dialogStep(() => open("IDENTITY_PARALLEL")),
      ]);
      expect(counts).to.deep.equal(["00000041", "00000042"]);
      expect(identityRows("IDENTITY_PARALLEL")).to.have.length(2);
    } finally { jobs.candidate = old; }
  });

  it("does not retry an INSERT failure that did not collide with a retained key", async () => {
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec(`CREATE TRIGGER fail_identity_insert BEFORE INSERT ON zosd_job_identity
        WHEN NEW.jobname = 'IDENTITY_INSERT_FAILURE'
        BEGIN SELECT RAISE(ABORT, 'identity insert refused'); END`);
    } finally { writer.close(); }
    const jobs = abap.context.RFCDestinations.JOBS;
    const old = jobs.candidate;
    let attempts = 0;
    jobs.candidate = () => { attempts += 1; return 73; };
    try {
      await dialogStep(async () => {
        const returned = box();
        await classic(() => abap.FunctionModules.JOB_OPEN({
          exporting: {jobname: box("IDENTITY_INSERT_FAILURE")},
          importing: {jobcount: returned},
        }), "cant_create_job");
        expect(returned.get()).to.equal("");
        await classic(() => submit("00000073", {jobname: "IDENTITY_INSERT_FAILURE"}), "job_notex");
        await classic(() => close("00000073", {jobname: "IDENTITY_INSERT_FAILURE"}), "job_notex");
      });
      expect(attempts).to.equal(1);
      expect(identityRows("IDENTITY_INSERT_FAILURE")).to.have.length(0);
    } finally {
      jobs.candidate = old;
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER fail_identity_insert"); } finally { clean.close(); }
    }
  });

  it("rejects an invalid private ABORT instead of silently continuing", async () => {
    await dialogStep(async () => {
      try {
        await abap.context.RFCDestinations.JOBS.call("ZOSD_JOB_PORT", {exporting: {
          iv_command: box("ABORT"), iv_jobname: box("MISSING"),
          iv_jobcount: box("00000073"), iv_owner: box("DEVELOPER"),
          iv_client: box("123"), iv_intent_id: box("missing"),
        }});
        throw new Error("invalid ABORT unexpectedly succeeded");
      } catch (error) { expect(error.message).to.equal("Closed job savepoint not found"); }
    });
  });

  it("uses one canonical name for a lower-case padded caller and the retained key", async () => {
    const count = await dialogStep(async () => {
      const value = await open("  identity_mixed  ");
      await submit(value, {jobname: "  identity_mixed  "});
      await close(value, {jobname: "  identity_mixed  "});
      return value;
    });
    const row = identityRows("IDENTITY_MIXED").find((item) => item.jobcount.trim() === count);
    expect(row?.intent_id.trim()).to.match(/^[0-9a-f]{32}$/);
    expect(rows().find((item) => item.intent_id.trim() === row.intent_id.trim())?.jobname.trim())
      .to.equal("IDENTITY_MIXED");
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect((await workQueuedBatch(root, store, async () => ({status: "COMPLETED"}))).kind).to.equal("completed");
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

  it("reads committed OPEN but calls out the same-LUW and rolled-back OPEN", async () => {
    let count;
    await dialogStep(async () => {
      count = await open("STATUS_OPEN");
      await classic(() => status("STATUS_OPEN", count), "uncommitted");
      await client.commit();
    });
    const priorOperations = process.env.OSD_OPERATIONS_DB;
    const absentOperations = join(dir, "status-must-not-create.sqlite");
    process.env.OSD_OPERATIONS_DB = absentOperations;
    try {
      const committed = await dialogStep(() => status("STATUS_OPEN", count));
      expect(committed).to.deep.equal({ev_phase: "RESERVED", ev_state: "RESERVED",
        ev_result_status: "", ev_step_count: "0"});
      expect(existsSync(absentOperations)).to.equal(false);
    } finally { process.env.OSD_OPERATIONS_DB = priorOperations; }
    let rolledBack;
    await dialogStep(async () => {
      rolledBack = await open("STATUS_ROLLBACK");
      await classic(() => status("STATUS_ROLLBACK", rolledBack), "uncommitted");
      await client.rollback();
    });
    await dialogStep(() => classic(() => status("STATUS_ROLLBACK", rolledBack), "not_found"));
  });

  it("reads committed CLOSE, imported and completed phases without draining on read", async () => {
    const name = "STATUS_CHAIN";
    let count;
    await dialogStep(async () => {
      count = await open(name);
      await submit(count, {jobname: name});
      await close(count, {jobname: name});
      await classic(() => status(name, count), "uncommitted");
    });
    const outbox = rows().find((row) => row.jobname.trim() === name && row.jobcount.trim() === count);
    expect(outbox).to.exist;
    const previous = process.env.OSD_OPERATIONS_DB;
    const path = join(dir, "status-read-only.sqlite");
    process.env.OSD_OPERATIONS_DB = path;
    const scoped = new BatchRuns(root, process.env);
    try {
      const before = rows().length;
      const ready = await dialogStep(() => status(name, count));
      expect(ready.ev_phase).to.equal("OUTBOX");
      expect(ready.ev_state).to.equal("READY");
      expect(rows()).to.have.length(before);
      expect(scoped.list()).to.have.length(0);
      const run = scoped.importIntent({intentId: outbox.intent_id.trim(), sourceDb: dbPath,
        client: "123", sysid: SID, owner: "DEVELOPER", jobname: name, jobcount: count,
        program: "ZGG_EX_012", generation: outbox.generation.trim(),
        steps: [{number: 1, program: "ZGG_EX_012"}]}).run;
      const imported = await dialogStep(() => status(name, count));
      expect(imported.ev_phase).to.equal("OPERATIONS");
      expect(imported.ev_state).to.equal("QUEUED");
      expect(rows()).to.have.length(before); // import-before-ack: status does not drain
      expect(scoped.claimNext().run.id).to.equal(run.id);
      scoped.finishStep(run.id, 1, {status: "COMPLETED", lines: []});
      const finished = await dialogStep(() => status(name, count));
      expect(finished.ev_state).to.equal("COMPLETED");
      expect(finished.ev_result_status).to.equal("COMPLETED");
      expect(finished.ev_step_count).to.equal("1");
      expect((await drainJobOutbox(scoped)).imported).to.equal(1);
      expect(rows()).to.have.length(before - 1);
    } finally {
      scoped.close();
      process.env.OSD_OPERATIONS_DB = previous;
    }
  });

  it("reads bounded private step and technical log metadata without draining work", async () => {
    const name = "READ_JOB_CHAIN";
    let count;
    await dialogStep(async () => {
      count = await open(name);
      await submit(count, {jobname: name});
      await close(count, {jobname: name});
      await classic(() => readJob(name, count), "uncommitted");
    });
    const outbox = rows().find((row) => row.jobname.trim() === name && row.jobcount.trim() === count);
    const previous = process.env.OSD_OPERATIONS_DB;
    const path = join(dir, "read-job-operations.sqlite");
    process.env.OSD_OPERATIONS_DB = path;
    try {
      const before = rows().length;
      const header = await dialogStep(() => readJob(name, count));
      expect(header.ev_phase).to.equal("OUTBOX");
      expect(header.ev_step_count).to.equal("1");
      expect(header.ev_log_count).to.equal("0");
      const diagnosis = await dialogStep(() => doctor(name, count));
      expect(diagnosis).to.include("OUTBOX");
      expect(diagnosis).to.include("committed intent awaits import");
      expect(diagnosis).to.include("Step 1: ZGG_EX_012");
      expect(diagnosis).to.include("Technical log (0 of 0 entries");
      expect(diagnosis).to.include("Each read is a separate snapshot");
      const report = await runConvertedBatch(root, "ZOSD_JOB_DOCTOR", [
        {name: "P_NAME", value: name}, {name: "P_COUNT", value: count},
      ]);
      expect(report.status).to.equal("COMPLETED");
      expect(report.lines.join("\n")).to.include(`Job ${name}/${count}: OUTBOX`);
      expect(report.lines.join("\n")).to.include("Step 1: ZGG_EX_012");
      expect((await dialogStep(() => readJob(name, count, "STEP", "1"))).ev_step_program)
        .to.equal("ZGG_EX_012");
      expect(rows()).to.have.length(before);
      expect(existsSync(path)).to.equal(false);
      const scoped = new BatchRuns(root, process.env);
      try {
        const run = scoped.importIntent({intentId: outbox.intent_id.trim(), sourceDb: dbPath,
          client: "123", sysid: SID, owner: "DEVELOPER", jobname: name, jobcount: count,
          program: "ZGG_EX_012", generation: outbox.generation.trim(),
          steps: [{number: 1, program: "ZGG_EX_012"}]}).run;
        const log = await dialogStep(() => readJob(name, count, "LOG", "1"));
        expect(log.ev_log_count).to.equal("1");
        expect(log.ev_log_event).to.equal("IMPORTED");
        expect(log.ev_log_text).to.equal("Job imported for dispatch");
        expect(JSON.stringify(log)).not.to.include(dbPath);
        expect(rows()).to.have.length(before);
        expect(scoped.claimNext().run.id).to.equal(run.id);
        scoped.finishStep(run.id, 1, {status: "COMPLETED", lines: ["private output"]});
        const done = await dialogStep(() => readJob(name, count, "STEP", "1"));
        expect(done.ev_step_state).to.equal("COMPLETED");
        expect(JSON.stringify(done)).not.to.include("private output");
        expect((await dialogStep(() => readJob(name, count))).ev_log_count).to.equal("4");
        const latest = await dialogStep(() => doctor(name, count, "2"));
        expect(latest).to.include("latest entries");
        expect(latest).to.include("2 earlier log entries omitted");
        expect(latest).to.include("JOB_COMPLETED");
        scoped.db.prepare("UPDATE batch_job_log SET occurred_at = ? WHERE run_id = ? AND seq = 1")
          .run(dbPath, run.id);
        await dialogStep(() => classic(() => readJob(name, count, "LOG", "1"), "inconsistent"));
        scoped.db.prepare("UPDATE batch_job_log SET occurred_at = ? WHERE run_id = ? AND seq = 1")
          .run(log.ev_log_at, run.id);
        scoped.db.prepare("UPDATE batch_job_log SET step_no = 1 WHERE run_id = ? AND seq = 1")
          .run(run.id);
        await dialogStep(() => classic(() => readJob(name, count, "LOG", "1"), "inconsistent"));
        scoped.db.prepare("UPDATE batch_job_log SET step_no = NULL WHERE run_id = ? AND seq = 1")
          .run(run.id);
        scoped.db.exec("BEGIN");
        try {
          const append = scoped.db.prepare(`INSERT INTO batch_job_log
            (run_id, seq, step_no, occurred_at, event_code, severity, text)
            VALUES (?, ?, NULL, ?, 'JOB_COMPLETED', 'I', 'Job completed')`);
          for (let seq = 5; seq <= 2001; seq++) append.run(run.id, seq, new Date().toISOString());
          scoped.db.exec("COMMIT");
        } catch (error) { scoped.db.exec("ROLLBACK"); throw error; }
        await dialogStep(() => classic(() => readJob(name, count), "too_large"));
        expect((await drainJobOutbox(scoped)).imported).to.equal(1);
      } finally { scoped.close(); }
    } finally { process.env.OSD_OPERATIONS_DB = previous; }
  });

  it("diagnoses an operations failure from its terminal technical event", async () => {
    const name = "DOCTOR_FAILED";
    let count;
    await dialogStep(async () => {
      count = await open(name);
      await submit(count, {jobname: name});
      await close(count, {jobname: name});
    });
    const outbox = rows().find((row) => row.jobname.trim() === name && row.jobcount.trim() === count);
    const previous = process.env.OSD_OPERATIONS_DB;
    process.env.OSD_OPERATIONS_DB = join(dir, "doctor-failed-operations.sqlite");
    try {
      const scoped = new BatchRuns(root, process.env);
      try {
        const run = scoped.importIntent({intentId: outbox.intent_id.trim(), sourceDb: dbPath,
          client: "123", sysid: SID, owner: "DEVELOPER", jobname: name, jobcount: count,
          program: "ZGG_EX_012", generation: outbox.generation.trim(),
          steps: [{number: 1, program: "ZGG_EX_012"}]}).run;
        scoped.claimNext();
        scoped.finishStep(run.id, 1, {status: "FAILED", lines: []});
        const diagnosis = await dialogStep(() => doctor(name, count, "1"));
        expect(diagnosis).to.include("REVIEW: failed or interrupted; no automatic replay");
        expect(diagnosis).to.include("Step 1: ZGG_EX_012 FAILED");
        expect(diagnosis).to.include("latest entries");
        expect(diagnosis).to.include("JOB_FAILED");
        expect((await drainJobOutbox(scoped)).imported).to.equal(1);
      } finally { scoped.close(); }
    } finally { process.env.OSD_OPERATIONS_DB = previous; }
  });

  it("bounds private read ordinals and clears reused port fields after an error", async () => {
    const name = "READ_JOB_CLEAR";
    const count = await dialogStep(async () => {
      const allocated = await open(name);
      await client.commit();
      return allocated;
    });
    await dialogStep(async () => {
      const importing = {ev_state: box("stale"), ev_step_program: box("stale"),
        ev_log_text: box("stale"), ev_source_db: box("private path"),
        ev_error_code: box("stale")};
      const call = (item, index) => abap.context.RFCDestinations.JOBS.call(
        "ZOSD_JOB_PORT", {exporting: {iv_command: box("READ_JOB"),
          iv_jobname: box(name), iv_jobcount: box(count), iv_item: box(item),
          iv_index: box(index)}, importing});
      await call("HEADER", "");
      expect(importing.ev_state.get()).to.equal("RESERVED");
      expect(importing.ev_source_db.get()).to.equal("");
      await call("STEP", "17");
      expect(importing.ev_error_code.get()).to.equal("BAD_KEY");
      expect(importing.ev_state.get()).to.equal("");
      expect(importing.ev_step_program.get()).to.equal("");
      expect(importing.ev_log_text.get()).to.equal("");
      expect(importing.ev_source_db.get()).to.equal("");
      await call("LOG", "2001");
      expect(importing.ev_error_code.get()).to.equal("BAD_KEY");
      await classic(() => readJob(name, count, "LOG", "1"), "bad_key");
      await client.beginTransaction();
      client.db.prepare(`DELETE FROM zosd_job_identity
        WHERE mandt = '123' AND jobname = ? AND jobcount = ?`).run(name, count);
      await classic(() => readJob(name, count), "uncommitted");
      await client.rollback();
    });
    const writer = new DatabaseSync(dbPath);
    try {
      writer.prepare(`INSERT INTO zosd_job_identity
        (mandt, jobname, jobcount, owner, intent_id)
        VALUES ('123', 'FOREIGN_READ', '00000096', 'OTHER', '')`).run();
    } finally { writer.close(); }
    await dialogStep(() => classic(() => readJob("FOREIGN_READ", "00000096"), "forbidden"));
  });

  it("uses trusted identity and clears reused port outputs on errors", async () => {
    const name = "STATUS_TRUST";
    const count = await dialogStep(async () => {
      const allocated = await open(name);
      await client.commit();
      return allocated;
    });
    const writer = new DatabaseSync(dbPath);
    try {
      writer.prepare(`INSERT INTO zosd_job_identity
        (mandt, jobname, jobcount, owner, intent_id) VALUES ('123', 'FOREIGN_STATUS', '00000077', 'OTHER', '')`).run();
    } finally { writer.close(); }
    await dialogStep(async () => {
      const importing = {ev_phase: box("stale"), ev_state: box("stale"),
        ev_result_status: box("stale"), ev_step_count: box("stale"), ev_error_code: box("stale"),
        ev_error: box("stale"), ev_program: box("stale"), ev_jobcount: box("stale")};
      const call = (jobname, jobcount, overrides = {}) => abap.context.RFCDestinations.JOBS.call(
        "ZOSD_JOB_PORT", {exporting: {iv_command: box("STATUS"), iv_jobname: box(jobname),
          iv_jobcount: box(jobcount), iv_owner: box(overrides.owner ?? "OTHER"),
          iv_client: box(overrides.client ?? "999")}, importing});
      await call("MISSING_STATUS", "00000078");
      expect(importing.ev_error_code.get()).to.equal("NOT_FOUND");
      await call(name, count);
      expect(importing.ev_error_code.get()).to.equal("");
      expect(importing.ev_state.get()).to.equal("RESERVED");
      await call("FOREIGN_STATUS", "00000077", {owner: "OTHER", client: "123"});
      expect(importing.ev_error_code.get()).to.equal("FORBIDDEN");
      expect(importing.ev_state.get()).to.equal("");
      expect(importing.ev_phase.get()).to.equal("");
      expect(importing.ev_error.get()).to.equal("");
      expect(importing.ev_program.get()).to.equal("");
      expect(importing.ev_jobcount.get()).to.equal("");
      await classic(() => status("FOREIGN_STATUS", "00000077"), "forbidden");
      await classic(() => status("MISSING_STATUS", "00000078"), "not_found");
      await classic(() => status("STATUS_TRUST", "bad"), "bad_key");
    });
  });

  it("reports an uncommitted deletion instead of stale committed status", async () => {
    const name = "STATUS_DELETE";
    const count = await dialogStep(async () => {
      const allocated = await open(name);
      await client.commit();
      return allocated;
    });
    await dialogStep(async () => {
      expect((await status(name, count)).ev_state).to.equal("RESERVED");
      await client.beginTransaction();
      client.db.prepare(`DELETE FROM zosd_job_identity
        WHERE mandt = '123' AND jobname = ? AND jobcount = ?`).run(name, count);
      await classic(() => status(name, count), "uncommitted");
      await client.rollback();
      expect((await status(name, count)).ev_state).to.equal("RESERVED");
    });
  });

  it("distinguishes inconsistent, pre-identity legacy and unavailable stores", async () => {
    const broken = "STATUS_BROKEN";
    const writer = new DatabaseSync(dbPath);
    try {
      writer.prepare(`INSERT INTO zosd_job_identity
        (mandt, jobname, jobcount, owner, intent_id)
        VALUES ('123', ?, '00000088', 'DEVELOPER', ?)`).run(broken, randomUUID().replaceAll("-", ""));
    } finally { writer.close(); }
    await dialogStep(() => classic(() => status(broken, "00000088"), "inconsistent"));

    const previous = process.env.OSD_OPERATIONS_DB;
    const legacyPath = join(dir, "status-legacy.sqlite");
    process.env.OSD_OPERATIONS_DB = legacyPath;
    const legacy = new BatchRuns(root, process.env);
    try {
      legacy.importIntent({intentId: randomUUID().replaceAll("-", ""), sourceDb: dbPath,
        client: "123", sysid: SID, owner: "DEVELOPER", jobname: "STATUS_LEGACY",
        jobcount: "00000089", program: "ZGG_EX_012", generation: liveGeneration(root)});
      await dialogStep(() => classic(() => status("STATUS_LEGACY", "00000089"), "legacy"));
    } finally {
      legacy.close();
      process.env.OSD_OPERATIONS_DB = previous;
    }
    const priorMode = process.env.STG_DB;
    process.env.STG_DB = "sqlite";
    try { await dialogStep(() => classic(() => status("STATUS_LEGACY", "00000089"), "unavailable")); }
    finally { process.env.STG_DB = priorMode; }
  });

  it("does not let the private status port run outside a dialog step", async () => {
    try {
      await abap.context.RFCDestinations.JOBS.call("ZOSD_JOB_PORT", {exporting: {
        iv_command: box("STATUS"), iv_jobname: box("MISSING"), iv_jobcount: box("00000090"),
      }, importing: {ev_error_code: box()}});
      throw new Error("status port unexpectedly accepted a missing dialog step");
    } catch (error) { expect(error.message).to.equal("JOB_* requires a dialog step"); }
  });

  it("commits one immutable intent, drains once, and executes one default-input report", async () => {
    const before = store.list().length;
    await schedule();
    expect(rows()).to.have.length(1);
    const committed = rows()[0];
    expect(store.list()).to.have.length(before);
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(rows()).to.have.length(0);
    expect(identityRows("OSD_ONE_STEP").find((row) =>
      row.jobcount.trim() === committed.jobcount.trim())?.intent_id.trim())
      .to.equal(committed.intent_id.trim());
    expect((await drainJobOutbox(store)).imported).to.equal(0);
    const queued = store.list().find((run) => run.state === "QUEUED");
    expect(queued.jobName).to.equal("OSD_ONE_STEP");
    expect(queued.jobCount).to.match(/^[0-9]{6}[0-9A-Z]{2}$/);
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
      try {
        await drainJobOutbox(store);
        throw new Error("drain unexpectedly acknowledged intent");
      } catch (error) { expect(error.message).to.equal("outbox acknowledgement failed"); }
      // the drain claims before it imports: a refused claim imports nothing
      expect(rows()).to.have.length(1);
      expect(store.list()).to.have.length(before);
    } finally {
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER refuse_job_ack"); }
      finally { clean.close(); }
    }
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
        const count = await open("CLOSE_FAILURE");
        await submit(count, {jobname: "CLOSE_FAILURE", report: "ZGG_EX_001"});
        await submit(count, {jobname: "CLOSE_FAILURE", report: "ZGG_EX_012"});
        await classic(() => close(count, {jobname: "CLOSE_FAILURE"}), "job_close_failed");
        await client.commit();
      });
      expect(rows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
      expect(stepRows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
      const reserved = identityRows("CLOSE_FAILURE");
      expect(reserved).to.have.length(1);
      expect(reserved[0].intent_id.trim()).to.equal("");
    } finally {
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER refuse_second_step"); } finally { clean.close(); }
    }
  });

  it("a failed reservation bind leaves no outbox rows after a handled CLOSE and COMMIT", async () => {
    let count;
    const beforeSteps = stepRows().length;
    await dialogStep(async () => {
      count = await open("IDENTITY_BIND_FAILURE");
      await submit(count, {jobname: "IDENTITY_BIND_FAILURE"});
      await client.execute(`UPDATE zosd_job_identity SET owner = 'OTHER'
        WHERE mandt = '123' AND jobname = 'IDENTITY_BIND_FAILURE' AND jobcount = '${count}'`);
      await classic(() => close(count, {jobname: "IDENTITY_BIND_FAILURE"}), "job_close_failed");
      await client.commit();
    });
    const reserved = identityRows("IDENTITY_BIND_FAILURE");
    expect(reserved).to.have.length(1);
    expect(reserved[0].intent_id.trim()).to.equal("");
    expect(rows().some((row) => row.jobname.trim() === "IDENTITY_BIND_FAILURE")).to.equal(false);
    expect(stepRows()).to.have.length(beforeSteps);
  });

  it("rolls back a partially applied SQLite bind without undoing earlier caller work", async () => {
    const writer = new DatabaseSync(dbPath);
    try {
      writer.exec(`CREATE TRIGGER fail_partial_bind AFTER UPDATE OF intent_id ON zosd_job_identity
        WHEN NEW.jobname = 'IDENTITY_PARTIAL' AND NEW.intent_id <> ''
        BEGIN SELECT RAISE(FAIL, 'bind failed after update'); END`);
    } finally { writer.close(); }
    let earlier, failed;
    const beforeSteps = stepRows().length;
    try {
      await dialogStep(async () => {
        earlier = await open("IDENTITY_EARLIER");
        failed = await open("IDENTITY_PARTIAL");
        await submit(failed, {jobname: "IDENTITY_PARTIAL"});
        await classic(() => close(failed, {jobname: "IDENTITY_PARTIAL"}), "job_close_failed");
        await client.commit();
      });
      expect(identityRows("IDENTITY_EARLIER").find((row) => row.jobcount.trim() === earlier)).to.exist;
      expect(identityRows("IDENTITY_PARTIAL").find((row) => row.jobcount.trim() === failed)?.intent_id.trim())
        .to.equal("");
      expect(rows().some((row) => row.jobname.trim() === "IDENTITY_PARTIAL")).to.equal(false);
      expect(stepRows()).to.have.length(beforeSteps);
    } finally {
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER fail_partial_bind"); } finally { clean.close(); }
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
      expect(store.list()).to.have.length(before); // claimed before import: nothing imported
    } finally {
      const clean = new DatabaseSync(dbPath);
      try { clean.exec("DROP TRIGGER refuse_step_ack"); } finally { clean.close(); }
    }
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(rows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
    expect(stepRows().filter((row) => row.mandt.trim() === "123")).to.have.length(0);
    expect(store.list()).to.have.length(before + 1);
  });

  it("a second drainer that starts while the first holds its claim imports nothing", async () => {
    await schedule();
    const before = store.list().length;
    const fixture = join(root, "test", "fixtures", "job-outbox-restart.mjs");
    let other;
    const result = await drainJobOutbox(store, {afterImport: async () => {
      // the first drainer has claimed and imported, and not committed: the
      // second waits for the business write lock and then finds no row
      other = new Promise((resolve) => {
        const child = spawn(process.execPath, [fixture, "retry"], {cwd: root, env: {...process.env}});
        let out = "", err = "";
        child.stdout.on("data", (chunk) => { out += chunk; });
        child.stderr.on("data", (chunk) => { err += chunk; });
        child.on("exit", (status) => resolve({status, out, err}));
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }});
    const child = await other;
    expect(child.status, child.err).to.equal(0);
    expect(JSON.parse(child.out.trim())).to.deep.equal({imported: 0});
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
      client: "123", sysid: SID, jobname: "ATOMIC", jobcount: "00000001",
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
    const base = {client: "123", sysid: SID, jobname: "SCOPE", jobcount: "00000001",
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
        VALUES ('124', ?, '${SID}', ?, 'FOREIGN', '00000001', 'DEVELOPER', 'ZGG_EX_012', ?, '20260929', '000000')`)
        .run(intent, dbPath, liveGeneration(root));
    } finally { writer.close(); }
    expect((await drainJobOutbox(store)).imported).to.equal(0);
    expect(rows().some((row) => row.intent_id.trim() === intent)).to.equal(true);
  });

  // a row written under another system id is refused with both ways out:
  // the old OSD_SID, or a reset of the business database
  it("refuses an outbox row of another system id and says how to recover", async () => {
    const other = SID === "ZZZ" ? "ZZY" : "ZZZ";
    const writer = new DatabaseSync(dbPath);
    const intent = randomUUID().replaceAll("-", "");
    try {
      writer.prepare(`INSERT INTO zosd_job_outbox
        (mandt, intent_id, sysid, source_db, jobname, jobcount, owner, program, generation, created_on, created_at)
        VALUES ('123', ?, '${other}', ?, 'OTHERSID', '00000001', 'DEVELOPER', 'ZGG_EX_012', ?, '20260929', '000000')`)
        .run(intent, dbPath, liveGeneration(root));
    } finally { writer.close(); }
    try {
      let refused;
      try { await drainJobOutbox(store); } catch (error) { refused = error; }
      expect(refused?.message).to.contain(`written by system ${other}, this system is ${SID}`);
      expect(refused.message).to.contain(`OSD_SID=${other}`);
      expect(refused.message).to.contain("reset the business database");
    } finally {
      const cleaner = new DatabaseSync(dbPath);
      try { cleaner.prepare("DELETE FROM zosd_job_outbox WHERE intent_id = ?").run(intent); } finally { cleaner.close(); }
    }
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

  it("schedules a JOB_CLOSE predecessor through the committed outbox and releases after success", async () => {
    const scopedEnv = {...process.env, OSD_OPERATIONS_DB: join(dir, "predecessor.sqlite")};
    const scoped = new BatchRuns(root, scopedEnv);
    try {
      let parentCount;
      await dialogStep(async () => {
        parentCount = await open("PRED_PARENT");
        await submit(parentCount, {jobname: "PRED_PARENT"});
        expect((await close(parentCount, {jobname: "PRED_PARENT"})).job_was_released).to.equal("X");
      });
      const parent = rows().find((row) => row.jobname.trim() === "PRED_PARENT");
      let childCount;
      await dialogStep(async () => {
        childCount = await open("PRED_CHILD");
        await submit(childCount, {jobname: "PRED_CHILD"});
        const pred = {jobname: "PRED_CHILD", strtimmed: "", pred_jobname: "PRED_PARENT",
          pred_jobcount: parentCount, predjob_checkstat: "X"};
        await classic(() => close(childCount, {...pred, predjob_checkstat: ""}), "job_close_failed");
        await classic(() => close(childCount, {...pred, strtimmed: "X"}), "job_close_failed");
        expect((await close(childCount, pred)).job_was_released).to.equal("X");
      });
      const child = rows().find((row) => row.jobname.trim() === "PRED_CHILD");
      expect(child.pred_jobname.trim()).to.equal("PRED_PARENT");
      expect(child.pred_jobcount.trim()).to.equal(parentCount);
      expect(child.pred_intent_id.trim()).to.equal(parent.intent_id.trim());
      const waitingOutbox = await dialogStep(() => readJob("PRED_CHILD", childCount));
      expect(waitingOutbox.ev_wait_kind).to.equal("AFTER_JOB");
      expect(waitingOutbox.ev_wait_jobname).to.equal("PRED_PARENT");
      expect(waitingOutbox.ev_wait_jobcount).to.equal(parentCount);
      expect(waitingOutbox.ev_created_on).to.match(/^\d{8}$/);
      expect(waitingOutbox.ev_queued_at).to.equal("");
      try {
        await drainJobOutbox(scoped, {afterImport: (intent) => {
          if (intent.jobname === "PRED_CHILD") throw new Error("crash after dependent import");
        }});
        throw new Error("drain unexpectedly acknowledged dependent");
      } catch (error) { expect(error.message).to.equal("crash after dependent import"); }
      expect(rows().some((row) => row.jobname.trim() === "PRED_CHILD")).to.equal(true);
      const previousStatusDb = process.env.OSD_OPERATIONS_DB;
      process.env.OSD_OPERATIONS_DB = scopedEnv.OSD_OPERATIONS_DB;
      try { expect((await dialogStep(() => status("PRED_CHILD", childCount))).ev_state).to.equal("WAITING"); }
      finally { process.env.OSD_OPERATIONS_DB = previousStatusDb; }
      const pendingPredecessorIntents = () => rows().filter((row) =>
        ["PRED_PARENT", "PRED_CHILD"].includes(row.jobname.trim()));
      const pendingBeforeRetry = pendingPredecessorIntents().length;
      expect((await drainJobOutbox(scoped)).imported).to.equal(pendingBeforeRetry);
      expect(pendingPredecessorIntents()).to.have.length(0);
      expect(scoped.list().filter((run) => ["PRED_PARENT", "PRED_CHILD"].includes(run.jobName)))
        .to.have.length(2);
      const waiting = scoped.list().find((run) => run.jobName === "PRED_CHILD");
      expect(waiting.state).to.equal("WAITING");
      expect(waiting.steps[0].state).to.equal("PENDING");
      const restarted = new BatchRuns(root, scopedEnv);
      try {
        expect(restarted.get(waiting.id).state).to.equal("WAITING");
        expect((await workQueuedBatch(root, restarted, async () => ({status: "COMPLETED"}))).kind).to.equal("completed");
        expect(restarted.get(waiting.id).state).to.equal("QUEUED");
        const previousOperationsDb = process.env.OSD_OPERATIONS_DB;
        process.env.OSD_OPERATIONS_DB = scopedEnv.OSD_OPERATIONS_DB;
        try {
          const released = await dialogStep(() => readJob("PRED_CHILD", childCount));
          expect(released.ev_state).to.equal("QUEUED");
          expect(released.ev_wait_kind).to.equal("AFTER_JOB");
          expect(released.ev_wait_jobname).to.equal("PRED_PARENT");
          await dialogStep(async () => {
            const lateCount = await open("PRED_TOO_LATE");
            await submit(lateCount, {jobname: "PRED_TOO_LATE"});
            await classic(() => close(lateCount, {jobname: "PRED_TOO_LATE", strtimmed: "",
              pred_jobname: "PRED_PARENT", pred_jobcount: parentCount,
              predjob_checkstat: "X"}), "job_close_failed");
            await client.rollback();
          });
        } finally { process.env.OSD_OPERATIONS_DB = previousOperationsDb; }
        expect((await workQueuedBatch(root, restarted, async () => ({status: "COMPLETED"}))).kind).to.equal("completed");
      } finally { restarted.close(); }
    } finally { scoped.close(); }
  });

  it("rejects an unknown predecessor and rolls back a valid dependent", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "pred-rollback.sqlite")});
    try {
      let parentCount;
      await dialogStep(async () => {
        parentCount = await open("PRED_ROLLBACK_PARENT");
        await submit(parentCount, {jobname: "PRED_ROLLBACK_PARENT"});
        await close(parentCount, {jobname: "PRED_ROLLBACK_PARENT"});
      });
      const before = rows().length;
      await dialogStep(async () => {
        const count = await open("PRED_ROLLBACK_CHILD");
        await submit(count, {jobname: "PRED_ROLLBACK_CHILD"});
        const pred = {jobname: "PRED_ROLLBACK_CHILD", strtimmed: "",
          pred_jobname: "PRED_ROLLBACK_PARENT", pred_jobcount: parentCount, predjob_checkstat: "X"};
        await classic(() => close(count, {...pred, pred_jobcount: "99999999"}), "job_close_failed");
        await close(count, pred);
        await client.rollback();
      });
      expect(rows()).to.have.length(before);
      expect((await drainJobOutbox(scoped)).imported).to.equal(1);
      expect(scoped.list()).to.have.length(1);
    } finally { scoped.close(); }
  });

  it("accepts parent and dependent CLOSE in one LUW, then imports both committed intents", async () => {
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "pred-same-luw.sqlite")});
    try {
      await dialogStep(async () => {
        const parentCount = await open("PRED_SAME_PARENT");
        await submit(parentCount, {jobname: "PRED_SAME_PARENT"});
        await close(parentCount, {jobname: "PRED_SAME_PARENT"});
        const childCount = await open("PRED_SAME_CHILD");
        await submit(childCount, {jobname: "PRED_SAME_CHILD"});
        await close(childCount, {jobname: "PRED_SAME_CHILD", strtimmed: "",
          pred_jobname: "PRED_SAME_PARENT", pred_jobcount: parentCount,
          predjob_checkstat: "X"});
      });
      expect((await drainJobOutbox(scoped)).imported).to.equal(2);
      expect(scoped.list().find((run) => run.jobName === "PRED_SAME_CHILD").state).to.equal("WAITING");
    } finally { scoped.close(); }
  });

  it("raises a named event immediately, never replays an earlier raise, and fans out by parameter", async () => {
    await dialogStep(async () => {
      await open("EVENT_UNCOMMITTED_OPEN");
      await raiseEvent("OSD_READY_A", "A");
      expect(identityRows("EVENT_UNCOMMITTED_OPEN")).to.have.length(0);
      await client.rollback(); // SAP BP_EVENT_RAISE survives the caller's rollback.
    });
    expect(identityRows("EVENT_UNCOMMITTED_OPEN")).to.have.length(0);
    const scheduleEvent = async (name, param) => dialogStep(async () => {
      const count = await open(name);
      await submit(count, {jobname: name});
      expect((await close(count, {jobname: name, strtimmed: "", event_id: "OSD_READY_A",
        event_param: param})).job_was_released).to.equal("X");
      return count;
    });
    const specific = await scheduleEvent("NAMED_SPECIFIC", "A");
    const blank = await scheduleEvent("NAMED_BLANK", "");
    const other = await scheduleEvent("NAMED_OTHER", "B");
    expect((await drainJobOutbox(store)).imported).to.equal(3);
    for (const name of ["NAMED_SPECIFIC", "NAMED_BLANK", "NAMED_OTHER"]) {
      expect(store.list().find((run) => run.jobName === name).state).to.equal("WAITING");
    }
    expect((await dialogStep(() => status("NAMED_SPECIFIC", specific))).ev_state).to.equal("WAITING");
    await dialogStep(async () => {
      await raiseEvent("OSD_READY_A", "");
      await client.rollback();
    });
    expect(store.list().find((run) => run.jobName === "NAMED_BLANK").state).to.equal("QUEUED");
    expect(store.list().find((run) => run.jobName === "NAMED_SPECIFIC").state).to.equal("WAITING");
    await dialogStep(() => raiseEvent("OSD_READY_A", "A"));
    expect(store.list().find((run) => run.jobName === "NAMED_SPECIFIC").state).to.equal("QUEUED");
    expect(store.list().find((run) => run.jobName === "NAMED_OTHER").state).to.equal("WAITING");
    expect((await dialogStep(() => status("NAMED_BLANK", blank))).ev_state).to.equal("QUEUED");
    expect((await dialogStep(() => status("NAMED_OTHER", other))).ev_state).to.equal("WAITING");
  });

  it("catches a raise after committed CLOSE even when the dependent imports later", async () => {
    let count;
    await dialogStep(async () => {
      count = await open("NAMED_LATE_IMPORT");
      await submit(count, {jobname: "NAMED_LATE_IMPORT"});
      await close(count, {jobname: "NAMED_LATE_IMPORT", strtimmed: "",
        event_id: "OSD_LATE_SIGNAL", event_param: "X"});
    });
    await dialogStep(() => raiseEvent("OSD_LATE_SIGNAL", "X"));
    const pending = rows().find((row) => row.jobname.trim() === "NAMED_LATE_IMPORT");
    expect(pending).to.exist;
    try {
      await drainJobOutbox(store, {afterImport: (intent) => {
        if (intent.jobname === "NAMED_LATE_IMPORT") throw new Error("crash after named import");
      }});
      throw new Error("drain unexpectedly acknowledged named wait");
    } catch (error) { expect(error.message).to.equal("crash after named import"); }
    expect(rows().some((row) => row.jobname.trim() === "NAMED_LATE_IMPORT")).to.equal(true);
    const reopened = new BatchRuns(root, process.env);
    try { expect((await drainJobOutbox(reopened)).imported).to.equal(1); }
    finally { reopened.close(); }
    expect(store.list().find((run) => run.jobName === "NAMED_LATE_IMPORT").state).to.equal("QUEUED");
    expect((await dialogStep(() => status("NAMED_LATE_IMPORT", count))).ev_state).to.equal("QUEUED");
  });

  it("rejects periodic and mixed named start conditions without closing the definition", async () => {
    await dialogStep(async () => {
      const count = await open("NAMED_INVALID");
      await submit(count, {jobname: "NAMED_INVALID"});
      await classic(() => close(count, {jobname: "NAMED_INVALID", strtimmed: "",
        event_id: "OSD_SIGNAL", event_periodic: "X"}), "job_close_failed");
      await classic(() => close(count, {jobname: "NAMED_INVALID", event_id: "OSD_SIGNAL"}), "job_close_failed");
      await classic(() => close(count, {jobname: "NAMED_INVALID", strtimmed: "",
        event_param: "A"}), "job_close_failed");
      await classic(() => close(count, {jobname: "NAMED_INVALID", strtimmed: "",
        event_id: "BAD EVENT"}), "job_close_failed");
      await classic(() => raiseEvent("bad event name"), "bad_eventid");
      await classic(() => raiseEvent(""), "eventid_missing");
      await close(count, {jobname: "NAMED_INVALID", strtimmed: "", event_id: "OSD_SIGNAL"});
      await client.rollback();
    });
    expect(rows().some((row) => row.jobname.trim() === "NAMED_INVALID")).to.equal(false);
  });

  it("does not run a queued named job after the business instance ID changes", async () => {
    const scopedEnv = {...process.env, OSD_OPERATIONS_DB: join(dir, "named-replaced.sqlite")};
    const scoped = new BatchRuns(root, scopedEnv);
    const previousOperationsDb = process.env.OSD_OPERATIONS_DB;
    process.env.OSD_OPERATIONS_DB = scopedEnv.OSD_OPERATIONS_DB;
    try {
      await dialogStep(async () => {
        const count = await open("NAMED_REPLACED");
        await submit(count, {jobname: "NAMED_REPLACED"});
        await close(count, {jobname: "NAMED_REPLACED", strtimmed: "",
          event_id: "OSD_REPLACED"});
      });
      await drainJobOutbox(scoped);
      await dialogStep(() => raiseEvent("OSD_REPLACED"));
      const run = scoped.list().find((item) => item.jobName === "NAMED_REPLACED");
      expect(run.state).to.equal("QUEUED");
      const originalInstance = client.db.prepare("SELECT id FROM zosd_job_source_instance").get().id;
      client.db.prepare("UPDATE zosd_job_source_instance SET id = ?")
        .run(randomUUID().replaceAll("-", ""));
      try {
        await classic(() => dialogStep(() => status("NAMED_REPLACED", run.jobCount)), "inconsistent");
        expect((await workQueuedBatch(root, scoped, async () => {
          throw new Error("old instance job executed");
        })).kind).to.equal("empty");
        expect(scoped.get(run.id).state).to.equal("QUEUED");
      } finally {
        client.db.prepare("UPDATE zosd_job_source_instance SET id = ?").run(originalInstance);
      }
      expect((await workQueuedBatch(root, scoped, async () => ({status: "COMPLETED"}))).kind).to.equal("completed");
    } finally {
      process.env.OSD_OPERATIONS_DB = previousOperationsDb;
      scoped.close();
    }
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
        client: "123", sysid: SID, jobname: "MULTI", jobcount: "00000001",
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
      client: "123", sysid: SID, jobname: "MULTI", jobcount: "00000002",
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
        client: "123", sysid: SID, jobname: "MULTI", jobcount: "00000003", owner: "DEVELOPER",
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
        client: "123", sysid: SID, jobname: "MULTI", jobcount: "00000004", owner: "DEVELOPER",
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
        client: "123", sysid: SID, jobname: "RACE", jobcount: "00000005", owner: "DEVELOPER",
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
        client: "123", sysid: SID, jobname: "OLDER_NODE", jobcount: "00000007", owner: "DEVELOPER",
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
        client: "123", sysid: SID, jobname: "SNAPSHOT", jobcount: "00000006", owner: "DEVELOPER",
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
  it("commits VIA JOB input, reads it, and runs it after a worker process restart", async () => {
    const name = "OSD_INPUT_VALUE";
    const inputDb = join(dir, "input-value.sqlite");
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: inputDb});
    let count;
    await dialogStep(async () => {
      count = await open(name);
      await abap.Classes.ZCL_OSD_JOB_INPUT_PROBE.schedule({
        iv_jobname: box(name), iv_jobcount: box(count), iv_value: box("20251231"),
      });
      await close(count, {jobname: name});
    });
    expect(stepRows().find((row) => row.program.trim() === "ZGG_EX_012")?.input_json)
      .to.include("20251231");
    expect(JSON.parse((await dialogStep(() => readJob(name, count, "STEP", "1"))).ev_input_json))
      .to.deep.equal([{name: "P_DATE", value: "20251231", ranges: []}]);
    expect(await dialogStep(() => doctor(name, count))).to.include("P_DATE=20251231");
    await drainJobOutbox(scoped);
    const child = spawnSync(process.execPath, [join(root, "test", "fixtures", "job-step-run.mjs")], {
      cwd: root, env: {...process.env, OSD_OPERATIONS_DB: inputDb}, encoding: "utf8", timeout: 120000,
    });
    expect(child.status, child.stderr).to.equal(0);
    const run = scoped.list().find((item) => item.jobName === name);
    expect(run.state).to.equal("COMPLETED");
    expect(scoped.stepOutput(run.id, 1).lines.join(" ")).to.include("20251231");
    await dialogStep(async () => {
      const defaultCount = await open("OSD_INPUT_DEFAULT");
      await submit(defaultCount, {jobname: "OSD_INPUT_DEFAULT"});
      await close(defaultCount, {jobname: "OSD_INPUT_DEFAULT"});
    });
    await drainJobOutbox(scoped);
    const defaultRun = scoped.list().find((item) => item.jobName === "OSD_INPUT_DEFAULT");
    expect((await workQueuedBatch(root, scoped)).kind).to.equal("completed");
    expect(scoped.stepOutput(defaultRun.id, 1).lines.join(" ")).not.to.include("20251231");
    scoped.close();
  });

  it("runs a stored SELECT-OPTIONS range with the same rows as a synchronous report", async () => {
    // I EQ uses the runtime's supported IN path; other options round-trip in
    // batch-runs but report evaluation awaits ANOMALY-2026-09-29-runtime-in-options.
    const name = "OSD_INPUT_RANGE";
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "input-range.sqlite")});
    const input = [{name: "S_NUM", value: "", ranges: [{sign: "I", option: "EQ", low: "7", high: ""}]},
      {name: "P_EXP", value: "1"}];
    const types = abap.Classes.ZIF_GG_SELECTION_SCREEN_TYPES;
    const values = types.ty_values.clone();
    for (const item of input) {
      const row = types.ty_value.clone();
      row.get().name.set(item.name);
      row.get().value.set(item.value);
      for (const range of item.ranges ?? []) {
        const entry = types.ty_range.clone();
        entry.get().sign.set(range.sign);
        entry.get().option.set(range.option);
        entry.get().low.set(range.low);
        entry.get().high.set(range.high);
        row.get().ranges.append(entry);
      }
      values.append(row);
    }
    const direct = await dialogStep(() => abap.Classes.ZCL_OSD_BATCH_REPORT.run({
      iv_program: box("ZOSD_SUB_RANGE"), it_input: values, iv_batch: "X",
    }));
    expect(direct.get().status.get()).to.equal("COMPLETED");
    const directLines = direct.get().lines.array().map((line) => line.get());
    let count;
    await dialogStep(async () => {
      count = await open(name);
      await viaProgram("ZOSD_SUB_RANGE", name, count, input);
      await close(count, {jobname: name});
    });
    const stored = JSON.parse(stepRows().find((row) => row.program.trim() === "ZOSD_SUB_RANGE").input_json);
    expect(stored.find((row) => row.name === "S_NUM").ranges).to.deep.equal(input[0].ranges);
    await drainJobOutbox(scoped);
    const run = scoped.list().find((item) => item.jobName === name);
    expect((await workQueuedBatch(root, scoped)).kind).to.equal("completed");
    expect(scoped.stepOutput(run.id, 1), JSON.stringify(scoped.get(run.id))).to.exist;
    expect(scoped.stepOutput(run.id, 1).lines).to.deep.equal(directLines);
    scoped.close();
  });

  it("fails an undeclared field at execution and rejects an overlong value at SUBMIT", async () => {
    const name = "OSD_INPUT_INVALID";
    const scoped = new BatchRuns(root, {...process.env, OSD_OPERATIONS_DB: join(dir, "input-invalid.sqlite")});
    let count;
    await dialogStep(async () => {
      count = await open(name);
      try {
        await viaJob(name, count, [{name: "P_DATE", value: "X".repeat(256)}]);
        throw new Error("overlong input accepted");
      } catch (error) { expect(String(error)).to.match(/255/); }
      await viaJob(name, count, [{name: "P_OTHER", value: "X"}]);
      await close(count, {jobname: name});
    });
    await drainJobOutbox(scoped);
    const run = scoped.list().find((item) => item.jobName === name);
    expect((await workQueuedBatch(root, scoped)).kind).to.equal("failed");
    expect(scoped.get(run.id).steps[0].detail).to.include("Unknown selection field P_OTHER");
    scoped.close();
  });

  it("runs the voyage and readiness reports through a committed tail event after restart", async () => {
    const prior = process.env.OSD_OPERATIONS_DB;
    process.env.OSD_OPERATIONS_DB = join(dir, "fleet-chain-success.sqlite");
    let scoped = new BatchRuns(root, process.env);
    const runId = "FLEET_RUN_17";
    const parentName = "FLEET_VOYAGE_OK";
    const childName = "FLEET_READY_OK";
    try {
      let parentCount, childCount;
      await dialogStep(async () => {
        parentCount = await open(parentName);
        await viaProgram("ZOSD_VOYAGE", parentName, parentCount, [{name: "P_RUN", value: runId}]);
        await close(parentCount, {jobname: parentName, tail_event_id: "VOYAGE_DONE",
          tail_event_param: runId});
        childCount = await open(childName);
        await viaProgram("ZOSD_READY", childName, childCount, [{name: "P_RUN", value: runId}]);
        await close(childCount, {jobname: childName, strtimmed: "",
          event_id: "VOYAGE_DONE", event_param: runId});
      });
      expect((await drainJobOutbox(scoped)).imported).to.equal(2);
      expect(await dialogStep(() => doctor(childName, childCount))).to.include("Wait: event VOYAGE_DONE");
      expect(await dialogStep(() => doctor(childName, childCount))).to.include("WAITING");
      expect((await workQueuedBatch(root, scoped)).kind).to.equal("completed");
      expect(await dialogStep(() => doctor(parentName, parentCount))).to.include("Tail: VOYAGE_DONE/FLEET_RUN_17 published");
      scoped.close();
      scoped = new BatchRuns(root, process.env);
      expect(scoped.list().find((run) => run.jobName === childName).state).to.equal("QUEUED");
      expect((await workQueuedBatch(root, scoped)).kind).to.equal("completed");
      expect(await dialogStep(() => doctor(childName, childCount))).to.include("HEALTHY: completed");
      expect(scoped.db.prepare("SELECT COUNT(*) AS n FROM batch_named_events WHERE event_id = 'VOYAGE_DONE'").get().n)
        .to.equal(1);
      expect(scoped.list().filter((run) => run.jobName === childName)).to.have.length(1);
      const event = scoped.db.prepare("SELECT * FROM batch_named_events WHERE event_id = 'VOYAGE_DONE'").get();
      for (const [column, damaged] of [["source_client", "999"], ["payload_sha256", "0".repeat(64)]]) {
        scoped.db.prepare(`UPDATE batch_named_events SET ${column} = ? WHERE intent_id = ?`)
          .run(damaged, event.intent_id);
        expect(await dialogStep(() => doctor(parentName, parentCount))).to.include("INCONSISTENT");
        scoped.db.prepare(`UPDATE batch_named_events SET ${column} = ? WHERE intent_id = ?`)
          .run(event[column], event.intent_id);
      }
    } finally {
      scoped.close();
      if (prior === undefined) delete process.env.OSD_OPERATIONS_DB;
      else process.env.OSD_OPERATIONS_DB = prior;
    }
  });

  it("warns that a running tail job may have committed business effects", async () => {
    const name = "FLEET_RUNNING_REVIEW";
    const prior = process.env.OSD_OPERATIONS_DB;
    process.env.OSD_OPERATIONS_DB = join(dir, "fleet-running-review.sqlite");
    const scoped = new BatchRuns(root, process.env);
    try {
      let count;
      await dialogStep(async () => {
        count = await open(name);
        await viaProgram("ZOSD_VOYAGE", name, count, [{name: "P_RUN", value: "RUN_REVIEW"}]);
        await close(count, {jobname: name, tail_event_id: "VOYAGE_DONE",
          tail_event_param: "RUN_REVIEW"});
      });
      await drainJobOutbox(scoped);
      scoped.claimNext();
      const diagnosis = await dialogStep(() => doctor(name, count));
      expect(diagnosis).to.include("MAY already have committed");
      expect(diagnosis).to.include("inspect");
      expect(diagnosis).to.include("before resubmission");
    } finally {
      scoped.close();
      if (prior === undefined) delete process.env.OSD_OPERATIONS_DB;
      else process.env.OSD_OPERATIONS_DB = prior;
    }
  });

  it("leaves readiness waiting and diagnoses a failed voyage", async () => {
    const prior = process.env.OSD_OPERATIONS_DB;
    process.env.OSD_OPERATIONS_DB = join(dir, "fleet-chain-failed.sqlite");
    const scoped = new BatchRuns(root, process.env);
    const runId = "FLEET_RUN_FAIL";
    const parentName = "FLEET_VOYAGE_FAIL";
    const childName = "FLEET_READY_WAIT";
    try {
      let parentCount, childCount;
      await dialogStep(async () => {
        parentCount = await open(parentName);
        await viaProgram("ZOSD_VOYAGE", parentName, parentCount,
          [{name: "P_RUN", value: runId}, {name: "P_FAIL", value: "X"}]);
        await close(parentCount, {jobname: parentName, tail_event_id: "VOYAGE_DONE",
          tail_event_param: runId});
        childCount = await open(childName);
        await viaProgram("ZOSD_READY", childName, childCount, [{name: "P_RUN", value: runId}]);
        await close(childCount, {jobname: childName, strtimmed: "",
          event_id: "VOYAGE_DONE", event_param: runId});
      });
      await drainJobOutbox(scoped);
      expect((await workQueuedBatch(root, scoped)).kind).to.equal("failed");
      expect(scoped.list().find((run) => run.jobName === childName).state).to.equal("WAITING");
      expect(scoped.db.prepare("SELECT COUNT(*) AS n FROM batch_named_events WHERE event_id = 'VOYAGE_DONE'").get().n)
        .to.equal(0);
      expect(await dialogStep(() => doctor(parentName, parentCount))).to.include("REVIEW: failed");
      expect(await dialogStep(() => doctor(parentName, parentCount))).to.include("Tail: VOYAGE_DONE/FLEET_RUN_FAIL not published");
      expect(await dialogStep(() => doctor(childName, childCount))).to.include("WAITING");
    } finally {
      scoped.close();
      if (prior === undefined) delete process.env.OSD_OPERATIONS_DB;
      else process.env.OSD_OPERATIONS_DB = prior;
    }
  });
  it("polls SHOW_JOBSTATE and reads the finished standard header", async () => {
    const name = "STANDARD_READ";
    const count = await dialogStep(async () => {
      const value = await open(name);
      expect((await invoke("JOB_SUBMIT", {jobname: name, jobcount: value,
        report: "ZGG_EX_012", authcknam: abap.builtin.sy.get().uname.get().trim()}, ["step_number"])).step_number).to.equal("1");
      await close(value, {jobname: name});
      return value;
    });
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    const finished = async () => (await dialogStep(() => invoke("SHOW_JOBSTATE",
      {jobname: name, jobcount: count}, ["finished", "running", "ready", "scheduled"]))).finished;
    for (let attempt = 0; attempt < 100 && await finished() !== "X"; attempt += 1) {
      await workQueuedBatch(root, store, async () => ({status: "COMPLETED"}));
    }
    expect(await finished()).to.equal("X");
    const header = jobHeaderType(abap);
    const ret = new abap.types.Integer().set(77);
    await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(19)},
      importing: {job_read_jobhead: header}, changing: {ret},
    }));
    expect(ret.get()).to.equal(0);
    expect(header.get().jobname.get().trim()).to.equal(name);
    expect(header.get().status.get()).to.equal("F");
    const table = (row) => new abap.types.Table(row, {withHeader: false, keyType: "DEFAULT",
      primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});
    const jobs = table(header.clone());
    const steps = table(new abap.types.Structure({
      jobname: new abap.types.Character(32), jobcount: new abap.types.Character(8),
      stepcount: new abap.types.Character(6), progname: new abap.types.Character(40),
    }));
    await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(20)},
      tables: {job_read_steplist: steps},
    }));
    expect(steps.array().map((step) => step.get().progname.get().trim())).to.deep.equal(["ZGG_EX_012"]);
    for (const [opcode, stepCount] of [[19, 0], [20, 1], [35, 1], [36, 1], [37, 0]]) {
      steps.clear();
      await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
        exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
          job_read_opcode: new abap.types.Integer().set(opcode)},
        importing: {job_read_jobhead: header}, tables: {job_read_steplist: steps},
      }));
      expect(header.get().status.get(), `opcode ${opcode}`).to.equal("F");
      expect(steps.array(), `opcode ${opcode}`).to.have.length(stepCount);
    }
    for (const opcode of [0, 1, 2, 18, 21, 34, 38, 999]) {
      await classic(() => dialogStep(() => abap.FunctionModules.BP_JOB_READ({
        exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
          job_read_opcode: new abap.types.Integer().set(opcode)},
      })), "invalid_opcode");
    }
    const selector = new abap.types.Structure({
      jobname: new abap.types.Character(32).set(name),
      jobcount: new abap.types.Character(8), jobgroup: new abap.types.Character(12),
      username: new abap.types.Character(12),
      from_date: new abap.types.Date(), from_time: new abap.types.Time(),
      to_date: new abap.types.Date(), to_time: new abap.types.Time(),
      no_date: new abap.types.Character(1), with_pred: new abap.types.Character(1),
      eventid: new abap.types.Character(32), eventparm: new abap.types.Character(64),
      abapname: new abap.types.Character(40),
      prelim: new abap.types.Character(1), schedul: new abap.types.Character(1),
      ready: new abap.types.Character(1), running: new abap.types.Character(1),
      finished: new abap.types.Character(1).set("X"), aborted: new abap.types.Character(1),
    });
    const found = new abap.types.Integer();
    await dialogStep(() => abap.FunctionModules.BP_JOB_SELECT({
      exporting: {jobselect_dialog: box("N"), jobsel_param_in: selector},
      importing: {nr_of_jobs_found: found}, tables: {jobselect_joblist: jobs},
    }));
    expect(found.get()).to.equal(1);
    const nameRange = table(new abap.types.Structure({
      sign: new abap.types.Character(1), option: new abap.types.Character(2),
      low: new abap.types.Character(32), high: new abap.types.Character(32),
    }));
    const userRange = table(new abap.types.Structure({
      sign: new abap.types.Character(1), option: new abap.types.Character(2),
      low: new abap.types.Character(12), high: new abap.types.Character(12),
    }));
    const nameRow = nameRange.getRowType().clone();
    nameRow.get().sign.set("I");
    nameRow.get().option.set("CP");
    nameRow.get().low.set("STANDARD_*");
    nameRange.append(nameRow);
    const userRow = userRange.getRowType().clone();
    userRow.get().sign.set("I");
    userRow.get().option.set("EQ");
    userRow.get().low.set(abap.builtin.sy.get().uname.get().trim());
    userRange.append(userRow);
    jobs.clear();
    await dialogStep(() => abap.FunctionModules.BP_JOB_SELECT({
      exporting: {jobselect_dialog: box("N"), jobsel_param_in: selector},
      importing: {nr_of_jobs_found: found},
      tables: {jobselect_joblist: jobs, jobname_ext_sel: nameRange, username_ext_sel: userRange},
    }));
    expect(found.get()).to.equal(1);
    expect(jobs.array()[0].get().status.get()).to.equal("F");
    nameRow.get().option.set("BT");
    nameRow.get().low.set("STANDARD_A");
    nameRow.get().high.set("STANDARD_Z");
    nameRange.clear();
    nameRange.append(nameRow);
    userRow.get().option.set("CP");
    userRow.get().low.set("DEV*");
    userRange.clear();
    userRange.append(userRow);
    jobs.clear();
    await dialogStep(() => abap.FunctionModules.BP_JOB_SELECT({
      exporting: {jobselect_dialog: box("N"), jobsel_param_in: selector},
      importing: {nr_of_jobs_found: found},
      tables: {jobselect_joblist: jobs, jobname_ext_sel: nameRange, username_ext_sel: userRange},
    }));
    expect(found.get()).to.equal(1);
    steps.clear();
    await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(20), job_step_number: new abap.types.Integer().set(1)},
      tables: {job_read_steplist: steps},
    }));
    expect(steps.array()).to.have.length(1);
    await classic(() => dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(20), job_step_number: new abap.types.Integer().set(2)},
      tables: {job_read_steplist: steps},
    })), "job_doesnt_have_steps");
    await dialogStep(async () => {
      const empty = await open("STANDARD_NO_STEPS");
      await classic(() => close(empty, {jobname: "STANDARD_NO_STEPS"}), "job_nosteps");
    });
  });

  it("accepts DDIC typed customer JOB_* and SHOW_JOBSTATE calls", async () => {
    const result = await dialogStep(() => abap.Classes.ZCL_OSD_JOB_TYPED_PROBE.run());
    expect(result.get().trim()).to.match(/^[0-9]{6}[0-9A-Z]{2}$/);
  });


});
