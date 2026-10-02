// JOBCOUNT as a system allocates it (0.6 should): hhmmss of the creation
// second, then two base-36 digits counted per (job name, second). The A4H sequences of
// 2026-10-02 are the fixture (test/fixtures/job-count/contract.json,
// EXPECT = A4H); the rest checks what follows from them here: a count alone
// is not a key, the 1297th open of a name in one second is refused, the
// periodic successor takes its creation second from the same allocator.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {BatchRuns} from "../tools/osd-batch-runs.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {JobScheduler, installAbapClock, manualClock} from "../tools/osd-job-scheduler.mjs";
import {msStamp, stampMs, successorIntentId} from "../tools/osd-job-schedule.mjs";
import {identity as runtimeIdentity} from "../tools/osd-identity.mjs";
import {readJobSnapshot} from "../tools/osd-job-snapshot.mjs";
import {reorgJobs, retentionDays} from "../tools/osd-job-reorg.mjs";
import {nextJobCount, JobCountExhausted, suffixOf, suffixValue} from "../tools/osd-job-count.mjs";
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
  function world(start, {retention = null, execute = async () => ({status: "COMPLETED"})} = {}) {
    worlds += 1;
    const clock = manualClock(start);
    restoreClock?.();
    restoreClock = installAbapClock(abap, clock);
    process.env.OSD_OPERATIONS_DB = join(dir, `operations-${worlds}.sqlite`);
    const w = {clock, t0: clock.now(), prefix: `C${worlds}_`};
    w.store = new BatchRuns(root, process.env);
    // retention null: no job reorganisation unless a case asks for one
    w.scheduler = new JobScheduler({root, store: w.store, env: process.env, clock, execute, retention});
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
  const schedule = (name, start, period = {}) => dialogStep(async () => {
    const count = await openIn(name);
    await abap.FunctionModules.JOB_SUBMIT({exporting: {jobname: box(name), jobcount: box(count),
      report: box("ZGG_EX_012"), authcknam: box(user())}});
    const exporting = {jobname: box(name), jobcount: box(count)};
    if (start) { exporting.sdlstrtdt = box(start.slice(0, 8)); exporting.sdlstrttm = box(start.slice(8)); }
    else exporting.strtimmed = box("X");
    for (const [key, value] of Object.entries(period)) exporting[key] = box(String(value));
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
  const selected = async (name, count) => dialogStep(async () => {
    const jobs = new abap.types.Table(jobHeaderType(abap), {withHeader: false, keyType: "DEFAULT",
      primaryKey: {name: "primary_key", type: "STANDARD", keyFields: [], isUnique: false}, secondary: []});
    const selector = new abap.types.Structure({
      jobname: new abap.types.Character(32).set(name), jobcount: new abap.types.Character(8).set(count),
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

  for (const fixture of contract.cases) {
    it(`${fixture.id} (EXPECT ${fixture.EXPECT})`, async () => {
      const w = world(fixture.clock);
      // rows of earlier days at this second: the key has no date in it
      for (const [job, numbers] of Object.entries(fixture.held ?? {})) {
        const writer = new DatabaseSync(dbPath);
        try {
          for (const nn of numbers) writer.prepare(`INSERT INTO zosd_job_identity (mandt, jobname, jobcount, owner, intent_id)
            VALUES ('123', ?, ?, ?, '')`).run(w.name(job), msStamp(w.t0).slice(8) + nn, user());
        } finally { writer.close(); }
      }
      const got = [];
      for (const call of fixture.opens) {
        if (typeof call === "object") {
          await w.scheduler.tick();
          expect(await deleteJob(w.name(call.delete), msStamp(w.t0).slice(8) + call.count)).to.equal(0);
          got.push(null);
          continue;
        }
        if (call.startsWith("+")) { w.clock.set(w.clock.now() + Number(call.slice(1)) * 1000); got.push(null); continue; }
        got.push(fixture.deletable ? await schedule(w.name(call), w.at(3600)) : await open(w.name(call)));
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

  it("a letter suffix survives status, read, select, delete, snapshot, and predecessor import", async () => {
    const w = world("2026-10-02T11:22:33Z");
    const name = w.name("LETTERS");
    for (let i = 0; i < 10; i++) await schedule(name, w.at(3600));
    const count = await schedule(name, w.at(3600));
    expect(count).to.equal("1122330A");
    expect(await status(name, count)).to.equal("S");
    expect((await header(name, count)).jobcount.get().trim()).to.equal(count);
    expect((await selected(name, count)).map((row) => row.jobcount.get().trim())).to.deep.equal([count]);
    const who = runtimeIdentity(process.env);
    const caller = {client: who.client, user: who.user, sid: who.sid};
    expect(readJobSnapshot({sourceDb: dbPath, jobName: name, jobCount: count, caller, root}).jobCount).to.equal(count);
    const waiter = w.name("WAITER");
    await dialogStep(async () => {
      const next = await openIn(waiter);
      await abap.FunctionModules.JOB_SUBMIT({exporting: {jobname: box(waiter), jobcount: box(next),
        report: box("ZGG_EX_012"), authcknam: box(user())}});
      await abap.FunctionModules.JOB_CLOSE({exporting: {jobname: box(waiter), jobcount: box(next),
        pred_jobname: box(name), pred_jobcount: box(count), predjob_checkstat: box("X")},
      importing: {job_was_released: new abap.types.String()}});
    });
    await w.scheduler.tick();
    expect(w.store.db.prepare("SELECT after_job_count FROM batch_runs WHERE job_name = ?").get(waiter).after_job_count)
      .to.equal(count);
    expect(await deleteJob(name, count)).to.equal(0);
    w.scheduler.stop();
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
    // a delete by pair of the reserved job (P, deleted as on the sandbox,
    // test/fixtures/job-delete) touches the scheduled one not at all
    expect(await deleteJob(b, countB)).to.equal(0);
    expect(identity(b)).to.deep.equal([]);
    expect(await status(a, countA)).to.equal("S");
  });

  it("1296 opens of one name in one second fill 00 to ZZ; the next is refused", async function () {
    this.timeout(600000);
    const w = world("2026-10-02T05:06:07Z");
    const name = w.name("HUNDRED");
    const counts = [];
    let refused;
    await dialogStep(async () => {
      for (let i = 0; i < 1296; i++) counts.push(await openIn(name));
      const returned = box();
      try { await abap.FunctionModules.JOB_OPEN({exporting: {jobname: box(name)}, importing: {jobcount: returned}}); }
      catch (error) {
        refused = {classic: String(error.classic).toLowerCase(), text: abap.builtin.sy.get().msgv1.get().trim(),
          id: abap.builtin.sy.get().msgid.get().trim()};
      }
      expect(returned.get()).to.equal("");
    });
    expect(counts[0]).to.equal("05060700");
    expect(counts[10]).to.equal("0506070A");
    expect(counts[1295]).to.equal("050607ZZ");
    expect(new Set(counts).size).to.equal(1296);
    expect(refused?.classic).to.include("cant_create_job");
    expect(refused.text).to.match(/^No free JOBCOUNT/);
    expect(identity(name)).to.have.length(1296);
    // another name in that second is untouched; the next second is free again
    expect(await open(w.name("OTHER"))).to.equal("05060700");
    w.clock.set(w.clock.now() + 1000);
    expect(await open(name)).to.equal("05060800");
  });

  it("the allocator compares suffixes in base 36 and takes max+1 over identity rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE zosd_job_identity (mandt TEXT, jobname TEXT, jobcount TEXT)");
    const put = db.prepare("INSERT INTO zosd_job_identity VALUES ('123', 'N', ?)");
    const ms = Date.parse("2026-10-02T01:20:00Z");
    expect(suffixValue("0A")).to.equal(10);
    expect(suffixValue("2R")).to.equal(99);
    expect(suffixOf(1295)).to.equal("ZZ");
    for (let nn = 0; nn < 100; nn++) put.run(`012000${suffixOf(nn)}`);
    expect(nextJobCount(db, {client: "123", jobname: "N", ms}).count).to.equal("0120002S");
    // Removing a middle row does not lower the next value.
    db.exec("DELETE FROM zosd_job_identity WHERE jobcount = '0120000A'");
    expect(nextJobCount(db, {client: "123", jobname: "N", ms}).count).to.equal("0120002S");
    // Removing the top row makes that top value available again.
    db.exec("DELETE FROM zosd_job_identity WHERE jobcount = '0120002R'");
    expect(nextJobCount(db, {client: "123", jobname: "N", ms}).count).to.equal("0120002R");
    put.run("012000ZZ");
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
    const count = await schedule(name, w.at(60), {prdmins: 2});
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
  describe("fixed-second daily jobs and reorganisation", () => {
    const DAY = 24 * 3600;
    const now = () => Math.floor(Date.now() / 1000) * 1000;
    const daily = (w, job) => schedule(w.name(job), w.at(60), {prddays: 1});

    it("a daily chain climbs by one for 120 days despite reorganisation", async function () {
      this.timeout(600000);
      const w = world(now(), {retention: 14});
      const proposals = [];
      w.scheduler.candidate = (proposal) => { proposals.push(proposal.count); return proposal.count; };
      const first = await daily(w, "DAILY");
      await w.scheduler.start();
      await w.clock.advance(120 * DAY * 1000);
      expect(w.scheduler.failures).to.deep.equal([]);
      const name = w.name("DAILY");
      const runs = w.store.db.prepare("SELECT job_count, state FROM batch_runs WHERE job_name = ?").all(name);
      // the chain is alive: one waiting successor, 120 days on, and (name, count) is unique in both stores
      // (the runs' own ended_at is the wall clock, so what stays of the history here is not asserted)
      const waiting = w.store.db.prepare("SELECT sdl_at FROM batch_runs WHERE job_name = ? AND state = 'WAITING'").all(name);
      expect(waiting.map((run) => stampMs(run.sdl_at) - w.t0)).to.deep.equal([(120 * DAY + 60) * 1000]);
      const rows = identity(name);
      expect(new Set(rows).size).to.equal(rows.length);
      const successorSecond = w.at(60).slice(8);
      expect(proposals.map((count) => count.slice(6)))
        .to.deep.equal(Array.from({length: 120}, (_, i) => suffixOf(i)));
      expect(proposals.every((count) => count.startsWith(successorSecond))).to.equal(true);
      expect(rows).to.include(successorSecond + suffixOf(119));
      expect(rows.length).to.be.below(20);
      expect(runs.filter((run) => run.state === "COMPLETED").length).to.be.below(20);
      expect(first).to.match(/^[0-9]{6}[0-9A-Z]{2}$/);
      w.scheduler.stop();
    });

    it("a chain reaching ZZ refuses once, retries in the next second, and other jobs run", async function () {
      this.timeout(600000);
      const w = world(now(), {retention: null});
      const name = w.name("DAILY");
      const first = await daily(w, "DAILY");
      const writer = new DatabaseSync(dbPath);
      try {
        for (let i = 0; i < 1295; i++) writer.prepare(`INSERT INTO zosd_job_identity (mandt, jobname, jobcount, owner, intent_id)
          VALUES ('123', ?, ?, ?, '')`).run(name, w.at(60).slice(8) + suffixOf(i), user());
      } finally { writer.close(); }
      await w.scheduler.start();
      w.scheduler.onFailure = () => {};
      await w.clock.advance((DAY + 600) * 1000);
      expect(w.scheduler.failures).to.have.length(1);
      expect(w.scheduler.failures[0].error).to.match(/No free JOBCOUNT/);
      expect(w.scheduler.failures[0].name).to.equal(w.name("DAILY"));
      // the failed run stays RELEASING, to be retried; nothing else is lost
      // the run stays RELEASING for the retry a minute on, and that retry is a new second:
      // the successor takes the count of the moment it is made
      const capped = w.store.db.prepare("SELECT id, job_count FROM batch_runs WHERE job_name = ? AND job_count LIKE '%ZZ'").get(name);
      expect(capped.job_count.slice(6)).to.equal("ZZ");
      const retried = w.store.db.prepare("SELECT job_count FROM batch_runs WHERE chain_pred = ?").get(capped.id);
      expect(retried.job_count.slice(0, 6)).to.not.equal(capped.job_count.slice(0, 6));
      await schedule(w.name("OTHER"), w.at(DAY + 700));
      await w.scheduler.tick(); // imports it
      await w.clock.advance(1000 * 1000);
      expect(w.store.db.prepare("SELECT state FROM batch_runs WHERE job_name = ?").all(w.name("OTHER")).map((r) => r.state))
        .to.deep.equal(["COMPLETED"]);
      expect(w.scheduler.timer).to.not.equal(undefined);
      w.scheduler.stop();
    });

    it("the reorganisation keeps what is not final, what a waiting job is chained behind and the latest periodic instance", async () => {
      const w = world(now(), {retention: 14});
      const age = (state, name) => w.store.db.prepare(`UPDATE batch_runs SET state = ?,
        ended_at = '2020-01-01T00:00:00.000Z' WHERE job_name = ?`).run(state, name);
      const a = await schedule(w.name("GONE"), w.at(3600));
      const b = await schedule(w.name("WAITING"), w.at(3600));
      const c = await schedule(w.name("LATEST"), w.at(3600), {prddays: 1});
      await w.scheduler.tick(); // imports the three
      age("COMPLETED", w.name("GONE"));
      age("WAITING", w.name("WAITING"));
      age("COMPLETED", w.name("LATEST"));
      w.clock.set(w.clock.now() + 1000);
      w.scheduler.nextReorg = undefined;
      await w.scheduler.tick();
      const left = (name) => w.store.db.prepare("SELECT 1 FROM batch_runs WHERE job_name = ?").all(w.name(name)).length;
      expect([left("GONE"), left("WAITING"), left("LATEST")]).to.deep.equal([0, 1, 1]);
      expect(identity(w.name("GONE"))).to.deep.equal([]);
      expect(identity(w.name("WAITING"))).to.deep.equal([b]);
      expect(identity(w.name("LATEST"))).to.deep.equal([c]);
      expect(a).to.match(/^[0-9]{6}[0-9A-Z]{2}$/);
      w.scheduler.stop();
    });
    it("the reorganisation finds the runs when the connection's path is relative, as the default STG_DB_PATH is", async () => {
      const w = world(now(), {retention: 14});
      await schedule(w.name("REL"), w.at(3600));
      await w.scheduler.tick();
      w.store.db.prepare(`UPDATE batch_runs SET state = 'COMPLETED', ended_at = '2020-01-01T00:00:00.000Z'
        WHERE job_name = ?`).run(w.name("REL"));
      const relativeClient = {db: client.db, path: relative(process.cwd(), dbPath), inTransaction: false};
      expect(relativeClient.path).to.not.equal(dbPath);
      const done = await reorgJobs({store: w.store, client: relativeClient, ms: w.clock.now(), days: 14});
      expect(done.removed).to.equal(1);
      expect(identity(w.name("REL"))).to.deep.equal([]);
      w.scheduler.stop();
    });

    it("a run something waits behind is kept: a real JOB_CLOSE with PRED_JOBNAME/PRED_JOBCOUNT", async () => {
      const w = world(now(), {retention: 14});
      const pred = w.name("PRED"), waiter = w.name("WAITER");
      const predCount = await schedule(pred, w.at(3600));
      await dialogStep(async () => {
        const count = await openIn(waiter);
        await abap.FunctionModules.JOB_SUBMIT({exporting: {jobname: box(waiter), jobcount: box(count),
          report: box("ZGG_EX_012"), authcknam: box(user())}});
        await abap.FunctionModules.JOB_CLOSE({exporting: {jobname: box(waiter), jobcount: box(count),
          pred_jobname: box(pred), pred_jobcount: box(predCount), predjob_checkstat: box("X")},
        importing: {job_was_released: new abap.types.String()}});
      });
      await w.scheduler.tick(); // imports both
      const aged = (name, state) => w.store.db.prepare(`UPDATE batch_runs SET state = ?,
        ended_at = '2020-01-01T00:00:00.000Z' WHERE job_name = ?`).run(state, name);
      aged(pred, "COMPLETED");
      expect(w.store.db.prepare("SELECT state, after_job_name FROM batch_runs WHERE job_name = ?").get(waiter))
        .to.deep.include({state: "WAITING", after_job_name: pred});
      w.scheduler.nextReorg = undefined;
      w.clock.set(w.clock.now() + 1000);
      await w.scheduler.tick();
      expect(w.store.db.prepare("SELECT 1 FROM batch_runs WHERE job_name = ?").all(pred)).to.have.length(1);
      // once the waiter is final too, both may go
      aged(waiter, "COMPLETED");
      w.scheduler.nextReorg = undefined;
      w.clock.set(w.clock.now() + 1000);
      await w.scheduler.tick();
      expect(w.store.db.prepare("SELECT 1 FROM batch_runs WHERE job_name IN (?, ?)").all(pred, waiter)).to.have.length(0);
      w.scheduler.stop();
    });

    it("one run stuck RELEASING delays only itself: the other timed jobs start at their due time", async () => {
      const w = world(now(), {retention: null});
      await schedule(w.name("STUCK"), w.at(60), {prdmins: 2});
      await schedule(w.name("OTHER"), w.at(65));
      const real = w.scheduler.ensureSuccessor.bind(w.scheduler);
      w.scheduler.ensureSuccessor = async (run, next) => {
        if (run.job_name === w.name("STUCK")) throw new Error("no count today");
        return real(run, next);
      };
      w.scheduler.onFailure = () => {};
      await w.scheduler.start();
      await w.clock.advance(70 * 1000);
      expect([...new Set(w.scheduler.failures.map((item) => item.name))]).to.deep.equal([w.name("STUCK")]);
      const state = (name) => w.store.db.prepare("SELECT state FROM batch_runs WHERE job_name = ?").all(w.name(name)).map((r) => r.state);
      expect(state("OTHER")).to.deep.equal(["COMPLETED"]); // at +65 s, not at +120 s
      expect(state("STUCK")).to.deep.equal(["RELEASING"]);
      w.scheduler.stop();
    });

    it("a retention that is not a number falls back to the default, with a warning", () => {
      const warned = [];
      const warn = console.warn;
      console.warn = (text) => warned.push(text);
      try {
        expect(retentionDays({OSD_JOB_RETENTION_DAYS: "soon"})).to.equal(14);
        expect(retentionDays({OSD_JOB_RETENTION_DAYS: "7"})).to.equal(7);
        expect(retentionDays({OSD_JOB_RETENTION_DAYS: "off"})).to.equal(null);
        expect(retentionDays({}, "x")).to.equal(14);
      } finally { console.warn = warn; }
      expect(warned.length).to.be.at.least(1);
    });
  });
});
