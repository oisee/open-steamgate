import {expect} from "chai";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns, workQueuedBatch} from "../tools/osd-batch-runs.mjs";
import {drainJobOutbox} from "../tools/osd-job-outbox.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {JOB_INPUT_JSON_MAX, jobInputJson} from "../tools/osd-job-input.mjs";
import {jobHeaderType} from "./fixtures/job-header.mjs";

const root = resolve(".");
const expectedRanges = [
  ["I", "EQ", "a'b", ""], ["E", "EQ", "a\\b", ""],
  ["I", "NE", "a&b", ""], ["E", "NE", "<tag>", ""],
  ["I", "GT", "café", ""], ["E", "GT", "tail  ", ""],
  ["I", "GE", "A", ""], ["E", "GE", "B", ""],
  ["I", "LT", "C", ""], ["E", "LT", "D", ""],
  ["I", "LE", "E", ""], ["E", "LE", "F", ""],
  ["I", "BT", "G", "Z"], ["E", "BT", "H", "Y"],
  ["I", "NB", "I", "X"], ["E", "NB", "J", "W"],
  ["I", "CP", "K*", ""], ["E", "CP", "L*", ""],
  ["I", "NP", "M*", ""], ["E", "NP", "N*", ""],
].map(([sign, option, low, high]) => ({sign, option, low, high}));

describe("compiled ABAP jobs end to end", function () {
  this.timeout(120000);
  let dir, dbPath, beforeEnv, priorAbap, priorContext, abap, client, store;
  const box = (value = "") => new abap.types.String().set(value);
  const invoke = async (name, input, outputs = []) => {
    const importing = Object.fromEntries(outputs.map((key) => [key, box()]));
    await abap.FunctionModules[name]({
      exporting: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, box(value)])), importing,
    });
    return Object.fromEntries(Object.entries(importing).map(([key, value]) => [key, value.get()]));
  };
  const open = async (name) => (await invoke("JOB_OPEN", {jobname: name}, ["jobcount"])).jobcount;
  const close = (name, count, options = {}) => invoke("JOB_CLOSE", {
    jobname: name, jobcount: count, strtimmed: "X", ...options,
  });
  const readBusiness = (sql, ...args) => {
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try { return db.prepare(sql).all(...args); } finally { db.close(); }
  };
  const run = (name) => store.list().find((item) => item.jobName === name);
  const work = () => workQueuedBatch(root, store);
  const table = (row) => new abap.types.Table(row, {withHeader: false, keyType: "DEFAULT",
    primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});
  const headerType = () => jobHeaderType(abap);

  const selectorType = () => new abap.types.Structure({
    jobname: new abap.types.Character(32), jobcount: new abap.types.Character(8),
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
  const selectJobs = async (selector) => {
    const jobs = table(headerType());
    const count = new abap.types.Integer();
    await dialogStep(() => abap.FunctionModules.BP_JOB_SELECT({
      exporting: {jobselect_dialog: box("N"), jobsel_param_in: selector},
      importing: {nr_of_jobs_found: count}, tables: {jobselect_joblist: jobs},
    }));
    return jobs.array().map((row) => ({name: row.get().jobname.get().trim(),
      count: row.get().jobcount.get().trim(), status: row.get().status.get()}));
  };
  const expectSelectFailure = async (selector, code, field) => {
    let failure;
    try { await selectJobs(selector); } catch (error) { failure = error; }
    expect(failure, `BP_JOB_SELECT should raise ${code}`).to.exist;
    expect(String(failure.classic ?? failure.message).toLowerCase()).to.include(code);
    if (field) expect(abap.builtin.sy.get().msgv1.get().trim()).to.equal(field);
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-jobs-e2e-"));
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
    process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
    const {initializeABAP} = await import("../output/init.mjs");
    await initializeABAP();
    abap = globalThis.abap;
    client = abap.context.databaseConnections.DEFAULT;
    store = new BatchRuns(root, process.env);
  });
  after(async () => {
    store?.close();
    await client?.disconnect?.();
    if (priorAbap === abap && priorContext) {
      abap.context.databaseConnections = priorContext.databaseConnections;
      abap.context.RFCDestinations = priorContext.RFCDestinations;
      if (priorContext.osdGeneration === undefined) delete abap.context.osdGeneration;
      else abap.context.osdGeneration = priorContext.osdGeneration;
    }
    // Keep the registered class object when this suite was the first importer:
    // output/init.mjs is cached, and later suites call initializeABAP again.
    if (priorAbap !== undefined) globalThis.abap = priorAbap;
    for (const [name, value] of Object.entries(beforeEnv ?? {})) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (dir) rmSync(dir, {recursive: true, force: true});
  });

  it("takes ABAP SUBMIT WITH p and s IN through the committed store and worker", async () => {
    const name = "E2E_RANGES";
    const sourceRanges = await abap.Classes.ZCL_OSD_JOB_E2E_DRIVER.ranges();
    expect(sourceRanges.array().map((row) => row.get().low.get())[5]).to.equal("tail  ");
    const count = await dialogStep(async () => {
      const value = await open(name);
      await abap.Classes.ZCL_OSD_JOB_E2E_DRIVER.schedule({
        iv_jobname: box(name), iv_jobcount: box(value), iv_run: box("RANGE_1"),
      });
      await close(name, value);
      return value;
    });
    const payload = JSON.parse(readBusiness("SELECT input_json FROM zosd_job_step")
      .find((row) => row.input_json?.includes("S_TEXT"))?.input_json ?? "null");
    expect(payload).to.be.an("array");
    expect(payload.find((item) => item.name === "S_TEXT").ranges).to.deep.equal(expectedRanges);
    expect(payload.find((item) => item.name === "P_RUN").value).to.equal("RANGE_1");
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect(store.get(run(name).id, {revealInput: true}).steps[0].input).to.deep.equal(payload);
    expect((await work()).kind).to.equal("completed");
    const seen = readBusiness("SELECT * FROM zosd_job_seen WHERE run_id = ? ORDER BY row_no", "RANGE_1");
    expect(seen).to.have.length(expectedRanges.length + 1);
    expect(seen[0].param.trim()).to.equal("RANGE_1");
    expect(seen.slice(1).map(({sign, option, low, high}) => ({
      sign: sign.trim(), option: option.trim(), low: JSON.parse(low), high: JSON.parse(high),
    }))).to.deep.equal(expectedRanges.map((row, index) =>
      index === 0 ? {...row, low: row.low.toUpperCase()} : row));
    expect((await dialogStep(() => invoke("SHOW_JOBSTATE", {jobname: name, jobcount: count}, ["finished"]))).finished).to.equal("X");
  });

  it("accepts valid JSON at the exact payload cap and rejects one extra character", () => {
    const json = JSON.stringify([{name: "P_RUN", value: "x"}]);
    const boundary = json + " ".repeat(JOB_INPUT_JSON_MAX - json.length);
    expect(boundary.length).to.equal(JOB_INPUT_JSON_MAX);
    expect(jobInputJson(boundary)).to.deep.equal([{name: "P_RUN", value: "x"}]);
    expect(() => jobInputJson(boundary + " ")).to.throw(/too large/);
  });

  it("evaluates I EQ, E EQ and I CP in the compiled report", async () => {
    for (const [mode, expected] of [["I_EQ", 1], ["E_EQ", 2], ["I_CP", 1]]) {
      const name = `E2E_${mode}`;
      const runId = `SEL_${mode}`;
      await dialogStep(async () => {
        const count = await open(name);
        await abap.Classes.ZCL_OSD_JOB_E2E_DRIVER.schedule_supported({
          iv_jobname: box(name), iv_jobcount: box(count), iv_run: box(runId), iv_mode: box(mode),
        });
        await close(name, count);
      });
      expect((await drainJobOutbox(store)).imported).to.equal(1);
      expect((await work()).kind).to.equal("completed");
      const hit = readBusiness("SELECT param FROM zosd_job_seen WHERE run_id = ? AND row_no = 99", runId);
      expect(hit).to.have.length(1);
      expect(Number(hit[0].param)).to.equal(expected);
    }
  });

  it("shows a committed JOB_OPEN reservation as preliminary", async () => {
    const name = "E2E_PRELIMINARY";
    const count = await dialogStep(() => open(name));
    const state = await dialogStep(() => invoke("SHOW_JOBSTATE",
      {jobname: name, jobcount: count}, ["preliminary", "ready", "running", "finished"]));
    expect(state).to.deep.equal({preliminary: "X", ready: "", running: "", finished: ""});
  });

  it("runs standard JOB_* and reads status, header, steps and name selection", async () => {
    const name = "E2E_STANDARD";
    const count = await dialogStep(async () => {
      const value = await open(name);
      const added = await invoke("JOB_SUBMIT", {jobname: name, jobcount: value,
        report: "ZGG_EX_012", authcknam: abap.builtin.sy.get().uname.get().trim()}, ["step_number"]);
      expect(added.step_number).to.equal("1");
      expect((await invoke("JOB_CLOSE", {jobname: name, jobcount: value,
        strtimmed: "X"}, ["job_was_released"])).job_was_released).to.equal("X");
      return value;
    });
    const state = () => dialogStep(() => invoke("SHOW_JOBSTATE",
      {jobname: name, jobcount: count}, ["preliminary", "finished", "running", "ready", "scheduled"]));
    expect((await state()).ready).to.equal("X");
    const readyHeader = headerType();
    await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(19)},
      importing: {job_read_jobhead: readyHeader},
    }));
    expect(readyHeader.get().status.get()).to.equal("Y");
    const readySelector = new abap.types.Structure({
      jobname: new abap.types.Character(32).set(name),
      jobcount: new abap.types.Character(8), jobgroup: new abap.types.Character(12),
      username: new abap.types.Character(12),
      from_date: new abap.types.Date(), from_time: new abap.types.Time(),
      to_date: new abap.types.Date(), to_time: new abap.types.Time(),
      no_date: new abap.types.Character(1), with_pred: new abap.types.Character(1),
      eventid: new abap.types.Character(32), eventparm: new abap.types.Character(64),
      abapname: new abap.types.Character(40), prelim: new abap.types.Character(1),
      schedul: new abap.types.Character(1),
      ready: new abap.types.Character(1).set("X"),
      running: new abap.types.Character(1), finished: new abap.types.Character(1),
      aborted: new abap.types.Character(1),
    });
    const readyJobs = table(headerType());
    await dialogStep(() => abap.FunctionModules.BP_JOB_SELECT({
      exporting: {jobselect_dialog: box("N"), jobsel_param_in: readySelector},
      tables: {jobselect_joblist: readyJobs},
    }));
    expect(readyJobs.array().map((row) => row.get().status.get())).to.deep.equal(["Y"]);
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    expect((await state()).ready).to.equal("X");
    for (let i = 0; i < 20 && (await state()).finished !== "X"; i += 1) {
      const pending = work();
      for (let poll = 0; poll < 10 && run(name)?.state === "RUNNING"; poll += 1) {
        expect((await state()).running).to.equal("X");
      }
      await pending;
    }
    expect((await state()).finished).to.equal("X");
    const header = headerType();
    const ret = new abap.types.Integer().set(1);
    await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(19)},
      importing: {job_read_jobhead: header}, changing: {ret},
    }));
    expect(ret.get()).to.equal(0);
    expect(header.get().status.get()).to.equal("F");
    const steps = table(new abap.types.Structure({
      jobname: new abap.types.Character(32), jobcount: new abap.types.Character(8),
      stepcount: new abap.types.Character(6), progname: new abap.types.Character(40),
    }));
    await dialogStep(() => abap.FunctionModules.BP_JOB_READ({
      exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
        job_read_opcode: new abap.types.Integer().set(20)},
      tables: {job_read_steplist: steps},
    }));
    expect(steps.array().map((row) => row.get().progname.get().trim())).to.deep.equal(["ZGG_EX_012"]);
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
    const jobs = table(header.clone());
    const nameRange = table(new abap.types.Structure({
      sign: new abap.types.Character(1), option: new abap.types.Character(2),
      low: new abap.types.Character(32), high: new abap.types.Character(32),
    }));
    const row = nameRange.getRowType().clone();
    row.get().sign.set("I"); row.get().option.set("EQ"); row.get().low.set(name);
    nameRange.append(row);
    const found = new abap.types.Integer();
    await dialogStep(() => abap.FunctionModules.BP_JOB_SELECT({
      exporting: {jobselect_dialog: box("N"), jobsel_param_in: selector},
      importing: {nr_of_jobs_found: found},
      tables: {jobselect_joblist: jobs, jobname_ext_sel: nameRange},
    }));
    expect(found.get()).to.equal(1);
    expect(jobs.array()[0].get().jobname.get().trim()).to.equal(name);
  });

  it("selects PRELIM and SCHEDUL, matches JOBCOUNT and known step/event fields", async () => {
    const preliminary = "E2E_SELECT_PRELIM";
    const waiting = "E2E_SELECT_EVENT";
    const preliminaryCount = await dialogStep(() => open(preliminary));
    const waitingCount = await dialogStep(async () => {
      const count = await open(waiting);
      await invoke("JOB_SUBMIT", {jobname: waiting, jobcount: count,
        report: "ZGG_EX_012", authcknam: abap.builtin.sy.get().uname.get().trim()});
      await invoke("JOB_CLOSE", {jobname: waiting, jobcount: count,
        strtimmed: "", event_id: "E2E_SELECT_SIGNAL", event_param: "A"});
      return count;
    });
    expect((await drainJobOutbox(store)).imported).to.equal(1);
    const prelim = selectorType();
    prelim.get().jobname.set(preliminary);
    prelim.get().prelim.set("X");
    expect(await selectJobs(prelim)).to.deep.equal([{name: preliminary,
      count: preliminaryCount, status: "P"}]);
    const patterned = selectorType();
    patterned.get().jobname.set("E2E_SELECT_*");
    expect(await selectJobs(patterned)).to.deep.equal([
      {name: waiting, count: waitingCount, status: "S"},
      {name: preliminary, count: preliminaryCount, status: "P"},
    ]);
    patterned.get().jobname.set("E2E_SELECT_+VENT*");
    expect(await selectJobs(patterned)).to.deep.equal([
      {name: waiting, count: waitingCount, status: "S"},
    ]);
    patterned.get().jobname.set("E2E_SELECT_MISSING*");
    await expectSelectFailure(patterned, "no_jobs_found");
    const schedul = selectorType();
    schedul.get().jobname.set(waiting);
    schedul.get().jobcount.set(waitingCount);
    schedul.get().schedul.set("X");
    expect(await selectJobs(schedul)).to.have.length(1);
    const username = abap.builtin.sy.get().uname.get().trim();
    schedul.get().username.set(`${username.slice(0, 1)}*`);
    expect(await selectJobs(schedul)).to.have.length(1);
    schedul.get().username.set("NO_SUCH_USER*");
    await expectSelectFailure(schedul, "no_jobs_found");
    schedul.get().username.set("");
    schedul.get().abapname.set("ZGG_EX_012");
    expect(await selectJobs(schedul)).to.have.length(1);
    schedul.get().abapname.set("ZGG_EX_MISSING");
    await expectSelectFailure(schedul, "no_jobs_found");
    schedul.get().abapname.set("ZGG_EX_012");
    schedul.get().eventid.set("E2E_SELECT_SIGNAL");
    expect(await selectJobs(schedul)).to.have.length(1);
    schedul.get().eventid.set("E2E_OTHER_SIGNAL");
    await expectSelectFailure(schedul, "no_jobs_found");
    schedul.get().eventid.set("E2E_SELECT_SIGNAL");
    schedul.get().eventparm.set("A");
    expect(await selectJobs(schedul)).to.deep.equal([{name: waiting,
      count: waitingCount, status: "S"}]);
    schedul.get().eventparm.set("B");
    await expectSelectFailure(schedul, "no_jobs_found");
    schedul.get().eventparm.set("A");
    schedul.get().jobcount.set("99999999");
    await expectSelectFailure(schedul, "no_jobs_found");
    schedul.get().jobcount.set(waitingCount);
    schedul.get().from_date.set("20260930");
    await expectSelectFailure(schedul, "selection_canceled", "FROM_DATE");
  });

  it("records a failing report as ABORTED with a job log line", async () => {
    const name = "E2E_ABORTED";
    const count = await dialogStep(async () => {
      const value = await open(name);
      await invoke("JOB_SUBMIT", {jobname: name, jobcount: value,
        report: "ZOSD_SUB_RANGE", authcknam: abap.builtin.sy.get().uname.get().trim()});
      await close(name, value);
      return value;
    });
    await drainJobOutbox(store);
    expect((await work()).kind).to.equal("failed");
    expect((await dialogStep(() => invoke("SHOW_JOBSTATE",
      {jobname: name, jobcount: count}, ["aborted"]))).aborted).to.equal("X");
    const lines = store.db.prepare("SELECT event_code, text FROM batch_job_log WHERE run_id = ? ORDER BY seq")
      .all(run(name).id);
    expect(lines.some(({event_code, text}) => event_code === "STEP_FAILED" && /failed/i.test(text))).to.equal(true);
  });

  it("releases a predecessor, a raised event and a committed tail event", async () => {
    const add = async (name, options = {}) => {
      const count = await open(name);
      await invoke("JOB_SUBMIT", {jobname: name, jobcount: count,
        report: "ZGG_EX_012", authcknam: abap.builtin.sy.get().uname.get().trim()});
      await close(name, count, options);
      return count;
    };
    let parentCount, childCount;
    await dialogStep(async () => {
      parentCount = await add("E2E_PARENT", {tail_event_id: "E2E_TAIL", tail_event_param: "RUN_1"});
      childCount = await add("E2E_CHILD", {strtimmed: "", pred_jobname: "E2E_PARENT",
        pred_jobcount: parentCount, predjob_checkstat: "X"});
      await add("E2E_EVENT", {strtimmed: "", event_id: "E2E_MANUAL", event_param: "RUN_1"});
      await add("E2E_TAIL_WAIT", {strtimmed: "", event_id: "E2E_TAIL", event_param: "RUN_1"});
    });
    expect((await drainJobOutbox(store)).imported).to.equal(4);
    for (const name of ["E2E_CHILD", "E2E_EVENT", "E2E_TAIL_WAIT"])
      expect(run(name).state, name).to.equal("WAITING");
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM batch_named_events WHERE event_id = 'E2E_TAIL'").get().n)
      .to.equal(0);
    expect((await work()).kind).to.equal("completed");
    expect(run("E2E_PARENT").state).to.equal("COMPLETED");
    expect(run("E2E_CHILD").state).to.equal("QUEUED");
    expect(run("E2E_TAIL_WAIT").state).to.equal("QUEUED");
    expect(run("E2E_EVENT").state).to.equal("WAITING");
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM batch_named_events WHERE event_id = 'E2E_TAIL'").get().n)
      .to.equal(1);
    await dialogStep(() => invoke("BP_EVENT_RAISE", {eventid: "E2E_MANUAL", eventparm: "RUN_1"}));
    expect(run("E2E_EVENT").state).to.equal("QUEUED");
    for (let i = 0; i < 3; i += 1) expect((await work()).kind).to.equal("completed");
    for (const name of ["E2E_CHILD", "E2E_EVENT", "E2E_TAIL_WAIT"])
      expect(run(name).state, name).to.equal("COMPLETED");
    expect((await dialogStep(() => invoke("SHOW_JOBSTATE",
      {jobname: "E2E_CHILD", jobcount: childCount}, ["finished"]))).finished).to.equal("X");
  });

  for (const {sign, option} of expectedRanges.filter(({sign, option}) =>
    !["I/EQ", "E/EQ", "I/CP"].includes(`${sign}/${option}`))) {
    it.skip(`ANOMALY-2026-09-29-runtime-in-options: ${sign} ${option} report evaluation awaits runtime fix`);
  }
});
