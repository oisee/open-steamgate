// JOBCOUNT as a system allocates it (0.6 should): hhmmss of the creation
// second, then NN counted per (job name, second). The A4H sequences of
// 2026-10-02 are the fixture (test/fixtures/job-count/contract.json,
// EXPECT = A4H); the rest checks what follows from them here: a count alone
// is not a key, the 100th open of a name in one second is refused, the
// periodic successor takes its creation second from the same allocator.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {JobScheduler, installAbapClock, manualClock} from "../tools/osd-job-scheduler.mjs";
import {msStamp, successorIntentId} from "../tools/osd-job-schedule.mjs";
import {identity as runtimeIdentity} from "../tools/osd-identity.mjs";
import {readJobSnapshot} from "../tools/osd-job-snapshot.mjs";
import {nextJobCount, JobCountExhausted} from "../tools/osd-job-count.mjs";
import {jobHeaderType} from "./fixtures/job-header.mjs";

const root = resolve(".");
const contract = JSON.parse(readFileSync(join(root, "test/fixtures/job-count/contract.json"), "utf8"));

describe("JOBCOUNT: creation second plus a counter per job name", function () {
  this.timeout(120000);
  let dir, dbPath, beforeEnv, priorAbap, priorContext, abap, client, restoreClock, worlds = 0;
  const box = (value = "") => new abap.types.String().set(value);
  const user = () => abap.builtin.sy.get().uname.get().trim();
  const readBusiness = (sql, ...args) => {
    const db = new DatabaseSync(dbPath, {readOnly: true});
    try { return db.prepare(sql).all(...args); } finally { db.close(); }
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "osd-job-count-"));
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

  // one frozen clock per case, its own operations store, a name prefix
  function world(start) {
    worlds += 1;
    const clock = manualClock(start);
    restoreClock?.();
    restoreClock = installAbapClock(abap, clock);
    process.env.OSD_OPERATIONS_DB = join(dir, `operations-${worlds}.sqlite`);
    const w = {clock, t0: clock.now(), prefix: `C${worlds}_`};
    w.store = new BatchRuns(root, process.env);
    w.scheduler = new JobScheduler({root, store: w.store, env: process.env, clock,
      execute: async () => ({status: "COMPLETED"})});
    w.name = (job) => w.prefix + job;
    w.at = (seconds) => msStamp(w.t0 + seconds * 1000);
    return w;
  }
  const openIn = async (name) => {
    const count = new abap.types.String();
    await abap.FunctionModules.JOB_OPEN({exporting: {jobname: box(name)}, importing: {jobcount: count}});
    return count.get();
  };
  const open = (name) => dialogStep(() => openIn(name));
  // open, submit and close in one dialog step (a definition lives in its LUW)
  const schedule = (name, start, period) => dialogStep(async () => {
    const count = await openIn(name);
    await abap.FunctionModules.JOB_SUBMIT({exporting: {jobname: box(name), jobcount: box(count),
      report: box("ZGG_EX_012"), authcknam: box(user())}});
    const exporting = {jobname: box(name), jobcount: box(count)};
    if (start) { exporting.sdlstrtdt = box(start.slice(0, 8)); exporting.sdlstrttm = box(start.slice(8)); }
    else exporting.strtimmed = box("X");
    if (period) exporting.prdmins = box(String(period));
    await abap.FunctionModules.JOB_CLOSE({exporting, importing: {job_was_released: new abap.types.String()}});
    return count;
  });
  const status = (name, count) => dialogStep(async () => {
    const out = Object.fromEntries(["preliminary", "scheduled", "ready", "running", "finished", "aborted"]
      .map((key) => [key, new abap.types.String()]));
    await abap.FunctionModules.SHOW_JOBSTATE({exporting: {jobname: box(name), jobcount: box(count)}, importing: out});
    const flag = Object.keys(out).find((key) => out[key].get() === "X");
    return {preliminary: "P", scheduled: "S", ready: "Y", running: "R", finished: "F", aborted: "A"}[flag];
  });
  const header = (name, count) => dialogStep(async () => {
    const head = jobHeaderType(abap);
    await abap.FunctionModules.BP_JOB_READ({exporting: {job_read_jobname: box(name), job_read_jobcount: box(count),
      job_read_opcode: new abap.types.Integer().set(19)}, importing: {job_read_jobhead: head}});
    return head.get();
  });
  const deleteJob = (name, count) => dialogStep(async () => {
    try { await abap.FunctionModules.BP_JOB_DELETE({exporting: {jobname: box(name), jobcount: box(count)}}); return 0; }
    catch (error) { if (error.classic === undefined) throw error; return String(error.classic).toUpperCase(); }
  });
  const identity = (name) => readBusiness(`SELECT TRIM(jobcount) AS count FROM zosd_job_identity
    WHERE jobname = ? ORDER BY jobcount`, name).map((row) => row.count);

  for (const fixture of contract.cases) {
    it(`${fixture.id} (EXPECT ${fixture.EXPECT})`, async () => {
      const w = world(fixture.clock);
      const got = [];
      for (const call of fixture.opens) {
        if (call.startsWith("+")) { w.clock.set(w.clock.now() + Number(call.slice(1)) * 1000); got.push(null); continue; }
        got.push(await open(w.name(call)));
      }
      expect(got).to.deep.equal(fixture.counts);
    });
  }

  it("frozen clock: two opens of one name in one second are distinct pairs, 00 then 01", async () => {
    const w = world("2026-10-02T11:22:33Z");
    const first = await open(w.name("FROZEN"));
    const second = await open(w.name("FROZEN"));
    expect([first, second]).to.deep.equal(["11223300", "11223301"]);
    expect(identity(w.name("FROZEN"))).to.deep.equal([first, second]);
  });

  it("a count alone is not a key: two names share one, a lookup by count alone is wrong, the pair is right", async () => {
    const w = world("2026-10-02T04:44:00Z");
    const a = w.name("ALONE_A"), b = w.name("ALONE_B");
    const countA = await schedule(a, w.at(3600)); // scheduled
    const countB = await open(b); // only reserved
    expect(countA).to.equal(countB);
    // a lookup by the count alone finds two jobs and cannot say which is meant
    const alone = readBusiness("SELECT jobname FROM zosd_job_identity WHERE jobcount = ?", countA).map((r) => r.jobname.trim());
    expect(alone.sort()).to.deep.equal([a, b].sort());
    // the lookups by pair pick the right one
    expect(await status(a, countA)).to.equal("S");
    expect(await status(b, countB)).to.equal("P");
    expect((await header(a, countA)).jobname.get().trim()).to.equal(a);
    const who = runtimeIdentity(process.env);
    const caller = {client: who.client, user: who.user, sid: who.sid};
    expect(readJobSnapshot({sourceDb: dbPath, jobName: a, jobCount: countA, caller, root}).phase).to.not.equal("RESERVED");
    expect(readJobSnapshot({sourceDb: dbPath, jobName: b, jobCount: countB, caller, root}).phase).to.equal("RESERVED");
    // a delete by pair of the reserved job touches the scheduled one not at all
    expect(await deleteJob(b, countB)).to.equal("CANT_DELETE_JOB");
    expect(await status(a, countA)).to.equal("S");
  });

  it("the 100th open of one name in one second is refused, with a message, and borrows no other second", async () => {
    const w = world("2026-10-02T05:06:07Z");
    const name = w.name("HUNDRED");
    const counts = [];
    let refused;
    await dialogStep(async () => {
      for (let i = 0; i < 100; i++) counts.push(await openIn(name));
      const returned = box();
      try { await abap.FunctionModules.JOB_OPEN({exporting: {jobname: box(name)}, importing: {jobcount: returned}}); }
      catch (error) {
        refused = {classic: String(error.classic).toLowerCase(), text: abap.builtin.sy.get().msgv1.get().trim(),
          id: abap.builtin.sy.get().msgid.get().trim()};
      }
      expect(returned.get()).to.equal("");
    });
    expect(counts[0]).to.equal("05060700");
    expect(counts[99]).to.equal("05060799");
    expect(new Set(counts).size).to.equal(100);
    expect(refused?.classic).to.include("cant_create_job");
    expect(refused.text).to.match(/^No free JOBCOUNT/);
    expect(identity(name)).to.have.length(100);
    // another name in that second is untouched; the next second is free again
    expect(await open(w.name("OTHER"))).to.equal("05060700");
    w.clock.set(w.clock.now() + 1000);
    expect(await open(name)).to.equal("05060800");
  });

  it("the allocator itself refuses past 99 and does not wrap", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE zosd_job_identity (mandt TEXT, jobname TEXT, jobcount TEXT)");
    const put = db.prepare("INSERT INTO zosd_job_identity VALUES ('123', 'N', ?)");
    put.run("01200099");
    const ms = Date.parse("2026-10-02T01:20:00Z");
    expect(() => nextJobCount(db, {client: "123", jobname: "N", ms})).to.throw(JobCountExhausted);
    expect(nextJobCount(db, {client: "123", jobname: "M", ms}).count).to.equal("01200000");
    // a count held elsewhere (a definition in this LUW) is skipped, not reused
    expect(nextJobCount(db, {client: "123", jobname: "M", ms, taken: (c) => c === "01200000"}).count).to.equal("01200001");
  });

  it("the identity key is (client, jobname, jobcount), in the DDIC and in the SQLite table", () => {
    const keys = readBusiness("SELECT name FROM pragma_table_info('zosd_job_identity') WHERE pk > 0 ORDER BY pk")
      .map((row) => row.name.toLowerCase());
    expect(keys).to.deep.equal(["mandt", "jobname", "jobcount"]);
    const ddic = readFileSync(join(root, "src/jobs/zosd_job_identity.tabl.xml"), "utf8");
    expect([...ddic.matchAll(/<FIELDNAME>(\w+)<\/FIELDNAME><KEYFLAG>X/g)].map((m) => m[1]))
      .to.deep.equal(["MANDT", "JOBNAME", "JOBCOUNT"]);
  });

  it("an old random count keeps working and is not taken for a new one", async () => {
    const w = world("2026-10-02T03:47:32Z");
    const name = w.name("OLD");
    const writer = new DatabaseSync(dbPath);
    try {
      writer.prepare(`INSERT INTO zosd_job_identity (mandt, jobname, jobcount, owner, intent_id)
        VALUES ('123', ?, '00000042', ?, ''), ('123', ?, '03473200', ?, '')`)
        .run(name, user(), name, user()); // one random, one that collides with the new rule
    } finally { writer.close(); }
    expect(await open(name)).to.equal("03473201");
    expect(await status(name, "00000042")).to.equal("P");
  });

  it("the periodic successor takes its creation second from the allocator, and stays unique against an open of its name", async () => {
    const w = world("2026-10-02T09:00:00Z");
    const name = w.name("PERIODIC");
    const count = await schedule(name, w.at(60), 2);
    expect(count).to.equal("09000000");
    w.clock.set(w.clock.now() + 60 * 1000); // the predecessor starts at 09:01:00
    const opened = await open(name); // an open of the same name in that same second
    expect(opened).to.equal("09010000");
    await w.scheduler.tick();
    const run = w.store.db.prepare("SELECT id FROM batch_runs WHERE job_name = ? AND chain_pred IS NULL").get(name);
    const successor = identity(name).filter((c) => c !== count && c !== opened);
    expect(successor).to.deep.equal(["09010001"]);
    const row = w.store.db.prepare("SELECT job_count FROM batch_runs WHERE chain_pred = ?").get(run.id);
    expect(row.job_count).to.equal("09010001");
    expect(readBusiness("SELECT TRIM(jobcount) AS c FROM zosd_job_identity WHERE TRIM(intent_id) = ?",
      successorIntentId(run.id)).map((r) => r.c)).to.deep.equal(["09010001"]);
    // and an open after it carries on
    expect(await open(name)).to.equal("09010002");
    w.scheduler.stop();
  });
});
