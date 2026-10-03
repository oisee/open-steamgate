import {readJSONFile} from "./trace-reader.mjs";
import {l3TableDependencies} from "./helpers/dsl-l3-tables.mjs";
import {jobDoctor, daemonDependencies} from "./helpers/dsl-doctor-mode.mjs";
// Slice 5c-1: exercise generated ABAP, actual SQL admissions, and job chains.
import {expect} from "chai";
import {fork} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, explainAlert, renderSet, SetError} from "../tools/dsl-l3.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";

const OUT = "src/l2demo", CORE = ".local/lars/open-abap-core/src";
let model;
const SET = "src/l2demo/fleet2.l3.yaml", DATE = "20261001", RUNNER = "zcl_l3_fleet2";
const TABLES = ["zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_stage", "zosd_l3_work", "zosd_l3_doctor",
  "zosd_l3_kill", "zosd_l3_conf", "zosd_l3_conf_log", "zosd_l3_run_conf", "zosd_l3_budget", "zosd_l3_event", "zosd_l3_object"];
const SOURCES = ["zosd_l2_ship", "zosd_l2_voy", "zosd_l2_crew", "zosd_l2_cargo"];
const trim = (s) => typeof s === "string" ? s.trim() : s;

describe("DSL L3 slice 5c-1: governor", function () {
  this.timeout(900000);
  before(() => { model = compileSet(SET); });
  it("fresh generation, and the set without a governor keeps every byte", async () => {
    expect(await checkSet(SET, "src/l2demo")).to.deep.equal([]);
    expect(await checkSet("src/l2demo/fleet.l3.yaml", "src/l2demo")).to.deep.equal([]);
  });
  it("checks all governor bounds and refuses future modes and ambiguous grouping", () => {
    const text = readFileSync(SET, "utf8").replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, f) => `rule: ${join(process.cwd(), "src/l2demo", f)}`);
    const dir = mkdtempSync(join(tmpdir(), "dsl-governor-manifest-"));
    try {
      for (const [from, to, pattern] of [["glass: 10", "glass: 0", /INT4/], ["glass: 10", "glass: 2147483648", /INT4/],
        ["counts: open", "counts: created", /only mode/], ["warn: 0.7", "warn: 0.9", /warn must be/],
        ["narrow_at: 0.8", "narrow_at: 1.1", /at most four/], ["per_pile: 50", "per_pile: -1", /INT4/],
        ["group_by: object", "group_by: object_all_rules", /future/], ["port:close", "port:ships", /autoclose port/]]) {
        const file = join(dir, "fleet2.l3.yaml"); writeFileSync(file, text.replace(from, to));
        expect(() => compileSet(file)).to.throw(SetError).and.to.match(pattern);
      }
      const noneFile = join(dir, "fleet2.l3.yaml");
      writeFileSync(noneFile, text.replace("autoclose: port:close", "autoclose: none").replace(", per_pile: 50", ""));
      expect(compileSet(noneFile).governor).to.include({per_pile: "0"}).and.not.to.have.property("autoclose_iface");
      const m = compileSet(SET);
      expect(m.settings.entries.filter((e) => e.name.startsWith("budget.")).map((e) => [e.name, e.default, e.scoped]))
        .to.deep.equal([["budget.glass", "10", true], ["budget.warn", "7000", true], ["budget.narrow_at", "8000", true], ["budget.per_pile", "50", true]]);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
  it("every governor method and admission line traces to governor:", () => {
    const text = readFileSync("src/l2demo/zcl_l3_fleet2.clas.abap", "utf8").split("\n");
    const trace = readJSONFile("src/l2demo/zcl_l3_fleet2.clas.trace.json", "utf8");
    const line = readFileSync(SET, "utf8").split("\n").findIndex((l) => l === "governor:") + 1;
    const remoteLine = readFileSync(SET, "utf8").split("\n").findIndex((l) => l.includes("remote: {function:")) + 1;
    for (const re of [/METHOD budget_/, /METHOD break_glass/, /METHOD continue_glass/, /METHOD release_pile/,
      /reserved = reserved [+-]/, /iv_key_offset =/, /state = 'NARROW'/,
      /budget_state\(/, /status = 'HELD' OR .*status = 'GLASS'/, /LOOP.*status <> 'HELD'/,
      /RAISE EXCEPTION.*(?:governor|alert lacks)/, /li_autoclose =/]) {
      const matches = trace.lines.filter((t) => re.test(text[t.line - 1]));
      expect(matches.length, String(re)).above(0);
      for (const t of matches) expect(t.set_line, text[t.line - 1]).to.equal(t.node.endsWith("/variant/remote") ? remoteLine : line);
    }
    const factory = readFileSync("src/l2demo/zcl_l3_fleet2_ports.clas.abap", "utf8").split("\n");
    const factoryTrace = readJSONFile("src/l2demo/zcl_l3_fleet2_ports.clas.trace.json", "utf8");
    const closeLine = readFileSync(SET, "utf8").split("\n").findIndex((l) => l === "  close:") + 1;
    for (const t of factoryTrace.lines.filter((t) => /(?:CLASS-METHODS|METHOD) get_close/.test(factory[t.line - 1]))) {
      expect(t.set_line).to.equal(closeLine);
    }
  });

  describe("file DB, jobs and competing sessions", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, dialogStep, store, drainJobOutbox, workQueuedBatch;
    const str = (v) => new abap.types.String().set(v), int = (v) => new abap.types.Integer().set(v);
    const date = () => new abap.types.Date().set(DATE), cls = () => abap.Classes.ZCL_L3_FLEET2;
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trim(v)]))); } finally { db.close(); }
    };
    const exec = (sqls) => dialogStep(async () => { for (const sql of sqls) await client.execute(sql); });
    const tune = (name, value) => dialogStep(() => cls().set_setting({iv_param: str(name), iv_value: str(value), iv_note: str("governor test")}));
    const run = (mode = "S", bind = "") => dialogStep(() => cls().run({iv_date: date(), iv_mode: new abap.types.Character(1).set(mode), iv_bind: str(bind)}));
    const id = (r) => trim(r.get().run_id.get()), status = (r) => trim(r.get().status.get());
    const budget = (run) => read("SELECT * FROM zosd_l3_budget WHERE run_id = ?", run)[0];
    const events = (run) => read("SELECT * FROM zosd_l3_event WHERE run_id = ? ORDER BY seq", run);
    const piles = (run) => read("SELECT * FROM zosd_l3_pile WHERE run_id = ? ORDER BY rule_name, pile_no", run);
    const collect = (r) => dialogStep(() => cls().collect({is_result: r}));
    const continueGlass = (run, glass, reason) => dialogStep(() => cls().continue_glass({iv_run: str(run), iv_new_glass: int(glass), iv_reason: str(reason)}));
    async function drain() {
      const outcomes = [];
      for (let i = 0; i < 80; i++) {
        await drainJobOutbox(store);
        const outcome = await workQueuedBatch(process.cwd(), store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) break;
        outcomes.push(outcome.kind);
      }
      expect(outcomes).not.to.include("failed");
      return outcomes;
    }
    async function seed({voyages = 2} = {}) {
      await exec(["INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123','S001','Maintenance','M'), ('123','S002','Active','A')",
        ...Array.from({length: voyages}, (_, i) => `INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123','V0000${i + 1}','S001','20261005')`),
        "INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123','V00009','S002','20261005')"]);
    }
    async function planned(glass = 1, cap = 50, state = "RUNNING") {
      const run = "GOVERNOR000000000000000000000001";
      await exec([
        "UPDATE zosd_l2_ship SET status='A'",
        `INSERT INTO zosd_l3_budget (mandt, run_id, set_name, reserved, consumed, refunded, glass, warn_at, narrow_at, per_pile, event_seq, state, warned) VALUES ('','${run}','fleet2',0,0,0,${glass},7000,8000,${cap},0,'${state}','')`,
        `INSERT INTO zosd_l3_run (mandt,set_name,check_date,run_id,status,started) VALUES ('','fleet2','${DATE}','${run}','HELD',20000101000000)`,
        ...[1,2].map((stage) => `INSERT INTO zosd_l3_stage (mandt,run_id,stage_no,set_name,check_date,stage_name,status,opened,ended) VALUES ('','${run}',${stage},'fleet2','${DATE}','stage','${stage === 1 ? "DONE" : "OPEN"}',20000101000000,0)`),
        ...[1,2].map((p) => `INSERT INTO zosd_l3_pile (mandt,run_id,rule_name,pile_no,set_name,stage_no,model_hash,check_date,range_low,range_high,status,job_name,job_count,alerts,started,ended,attempt,reason,per_pile) VALUES ('','${run}','ship-min-crew',${p},'fleet2',2,'','${DATE}','S00${p}','S00${p}','PLANNED','','',0,0,0,0,'',0)`),
        ...[1,2].map((p) => `INSERT INTO zosd_l3_work (mandt,run_id,worklist,key_value) VALUES ('','${run}','busy','S00${p}')`),
      ]);
      return run;
    }
    const pile = (run, p) => dialogStep(() => cls().run_rule({iv_rule: str("ship-min-crew"), iv_run: str(run), iv_date: date(), iv_pile: int(p)}));

    before(async () => {
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-governor-db-")); dbPath = join(dir, "business.sqlite");
      envBefore = Object.fromEntries(["STG_DB", "STG_DB_PATH", "OSD_OPERATIONS_DB"].map((n) => [n, process.env[n]]));
      priorAbap = globalThis.abap;
      if (priorAbap?.context) priorContext = {databaseConnections: {...priorAbap.context.databaseConnections}, RFCDestinations: {...priorAbap.context.RFCDestinations}, osdGeneration: priorAbap.context.osdGeneration};
      process.env.STG_DB = "file"; process.env.STG_DB_PATH = dbPath; process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
      await (await import("../output/init.mjs")).initializeABAP(); abap = globalThis.abap; client = abap.context.databaseConnections.DEFAULT;
      ({dialogStep} = await import("../tools/osd-dialog-step.mjs"));
      const {BatchRuns} = await import("../tools/osd-batch-runs.mjs");
      store = new BatchRuns(process.cwd(), process.env);
      ({drainJobOutbox} = await import("../tools/osd-job-outbox.mjs"));
      ({workQueuedBatch} = await import("../tools/osd-batch-runs.mjs"));
    });
    let jobMode;
    before(async () => { jobMode = await jobDoctor("fleet2", join(dir,"job-doctor")); });
    after(() => jobMode?.restore());
    beforeEach(async () => { await exec([...TABLES, ...SOURCES].map((t) => `DELETE FROM ${t}`)); await seed(); });
    after(async () => {
      await drain().catch(() => {}); store?.close(); await client?.disconnect();
      if (priorAbap === abap && priorContext) Object.assign(abap.context, priorContext);
      if (priorAbap !== undefined) globalThis.abap = priorAbap;
      for (const [k, v] of Object.entries(envBefore ?? {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      if (dir) rmSync(dir, {recursive: true, force: true});
    });

    it("settings refuse out-of-bounds governor numbers", async () => {
      for (const [name, value] of [["budget.glass", "0"], ["budget.glass", "2147483648"],
        ["budget.warn", "0"], ["budget.warn", "10001"], ["budget.narrow_at", "10001"], ["budget.per_pile", "-1"]]) {
        expect(trim((await tune(name, value)).get()), `${name}=${value}`).to.equal("");
      }
      expect(read("SELECT * FROM zosd_l3_conf WHERE origin='USER'")).to.have.length(0);
    });

    it("settings keep warn <= narrow_at, including edits of either threshold", async () => {
      expect(trim((await tune("budget.warn", "9000")).get())).to.equal("");
      expect(trim((await tune("budget.narrow_at", "6000")).get())).to.equal("");
      expect(read("SELECT * FROM zosd_l3_conf WHERE origin='USER'")).to.have.length(0);
      expect(trim((await tune("budget.narrow_at", "9000")).get())).to.equal("X");
      expect(trim((await tune("budget.warn", "9000")).get())).to.equal("X");
      expect(trim((await tune("budget.narrow_at", "8999")).get())).to.equal("");
      expect(trim((await tune("budget.narrow_at", "10001")).get())).to.equal("");
      expect(read("SELECT param_val FROM zosd_l3_conf WHERE param_name='budget.narrow_at'")[0].param_val).to.equal("9000");
    });

    it("funnel: hits become distinct keys; maintenance autoclose refunds those keys once", async () => {
      const r = await run("S", "close=maintenance"); const runId = id(r);
      expect(status(r)).to.equal("DONE");
      const b = budget(runId), objects = read("SELECT * FROM zosd_l3_object WHERE run_id = ?", runId);
      const hits = read("SELECT * FROM zosd_l3_alert WHERE run_id = ?", runId);
      expect(hits.length).to.be.greaterThan(objects.length);
      expect(b.consumed).to.equal(objects.length);
      expect(b.refunded).to.equal(objects.filter((o) => o.closed === "X").length);
      expect(b.reserved).to.equal(objects.filter((o) => o.closed !== "X").length);
      expect(b.reserved).to.equal(b.consumed - b.refunded);
      const counts = (result, field) => result.get().rules.array().reduce((n, row) => n + row.get()[field].get(), 0);
      expect(counts(r, "budget_alerts")).to.equal(b.consumed);
      expect(counts(r, "closed")).to.equal(b.refunded);
      expect(counts(r, "open_alerts")).to.equal(b.reserved);
      expect(counts(await collect(r), "open_alerts")).to.equal(b.reserved);
      expect(hits.filter((a) => a.object_key === "S001").every((a) => a.closed === "X")).to.equal(true);
      expect(events(runId).some((e) => e.kind === "REFUND")).to.equal(true);
    });
    it("two real parallel sessions: each pile fits alone; exactly one writes and no overshoot", async () => {
      const runId = await planned(1);
      const children = [];
      for (const p of [1,2]) {
        const child = fork("test/helpers/dsl-governor-pile.mjs", [], {env: {...process.env, GOVERNOR_RUN: runId, GOVERNOR_PILE: String(p)}, stdio: ["ignore","pipe","pipe","ipc"]});
        let errors = ""; child.stderr.on("data", (x) => { errors += x; });
        const ready = new Promise((resolve, reject) => { child.on("message", (m) => { if (m.ready) resolve(); }); child.once("exit", (code) => { if (code) reject(new Error(errors)); }); });
        const result = new Promise((resolve, reject) => { let answer; child.on("message", (m) => { if (m.status || m.error) answer = m; }); child.once("exit", (code) => code || answer?.error ? reject(new Error(answer?.error ?? errors)) : answer ? resolve(answer.status) : reject(new Error("child exited without a result"))); });
        result.catch(() => {});
        children.push({child, ready, result});
        await ready;
      }
      try {
        await Promise.all(children.map((c) => c.ready)); children.forEach((c) => c.child.send("go"));
        expect((await Promise.all(children.map((c) => c.result))).sort()).to.deep.equal(["DONE","GLASS"]);
        expect(budget(runId)).to.include({reserved: 1, glass: 1, state: "GLASS"});
        expect(read("SELECT * FROM zosd_l3_alert WHERE run_id = ?", runId)).to.have.length(1);
      } finally { for (const {child} of children) if (child.exitCode === null) child.kill("SIGTERM"); }
    });
    // This refund/key oracle is deliberately sequential. The reserve mutant
    // pins the predicate; the independent-session test above pins concurrency.
    it("refund allows a later pile to fit; repeated keys in other piles consume nothing more", async () => {
      const runId = await planned(1);
      await exec(["UPDATE zosd_l2_ship SET status='M' WHERE ship_id='S001'", `UPDATE zosd_l3_pile SET rule_name='maintenance-ship-no-future-voyage' WHERE run_id='${runId}' AND pile_no=1`]);
      const a = await dialogStep(() => cls().run_rule({iv_rule: str("maintenance-ship-no-future-voyage"), iv_run: str(runId), iv_date: date(), iv_pile: int(1), iv_bind: str("close=maintenance")}));
      expect(status(a)).to.equal("DONE"); expect(budget(runId)).to.include({reserved: 0, consumed: 1, refunded: 1, state: "RUNNING"});
      expect(status(await pile(runId, 2))).to.equal("DONE"); expect(budget(runId)).to.include({reserved: 1, consumed: 2, refunded: 1});
      await exec([`UPDATE zosd_l3_pile SET status='PLANNED' WHERE run_id='${runId}' AND pile_no=2`]);
      expect(status(await pile(runId, 2))).to.equal("DONE"); expect(budget(runId).consumed).to.equal(2);
    });
    it("capture refunds a CLOSED answer once and rejects duplicate or foreign rows", async () => {
      const runId = await planned(1);
      const capture = abap.Classes.ZCL_L3_FLEET2_CLOSE_CAPTURE;
      const method = "zif_l3_fleet2_close$apply", real = capture.prototype[method];
      capture.prototype[method] = async function ({it_alerts}) {
        const closed = it_alerts.clone();
        closed.array()[0].get().closed.set("X");
        closed.append(closed.array()[0].clone());
        const foreign = closed.array()[0].clone(); foreign.get().run_id.set("FOREIGN"); closed.append(foreign);
        return closed;
      };
      try {
        const r = await dialogStep(() => cls().run_rule({iv_rule: str("ship-min-crew"), iv_run: str(runId), iv_date: date(), iv_pile: int(1), iv_bind: str("close=capture")}));
        expect(status(r)).to.equal("DONE"); expect(budget(runId)).to.include({reserved: 0, consumed: 1, refunded: 1});
        expect(events(runId).filter((e) => e.kind === "REFUND").map((e) => e.amount)).to.deep.equal([1]);
      } finally { capture.prototype[method] = real; }
    });
    it("purge keeps GLASS history with its plan and removes a final run's history with its plan", async () => {
      await tune("budget.warn", "1"); const r = await run(); const finalRun = id(r);
      expect(events(finalRun).length).above(0);
      await exec([`UPDATE zosd_l3_stage SET opened=20000101000000, ended=20000101000000 WHERE run_id='${finalRun}'`]);
      await dialogStep(() => cls().purge({}));
      expect(piles(finalRun)).to.have.length(0); expect(events(finalRun)).to.have.length(0); expect(budget(finalRun)).to.equal(undefined);
      await exec(["DELETE FROM zosd_l3_run"]);
      const glassRun = await planned(1); await pile(glassRun, 1); await pile(glassRun, 2);
      const before = events(glassRun); await dialogStep(() => cls().purge({}));
      expect(piles(glassRun)).to.have.length(2); expect(events(glassRun)).to.deep.equal(before); expect(budget(glassRun).state).to.equal("GLASS");
    });
    it("WARN is an event, NARROW admits one chain and every deferred pile runs", async () => {
      const runId = await planned(5);
      await exec([`UPDATE zosd_l3_budget SET warn_at=1, narrow_at=1 WHERE run_id='${runId}'`,
        `INSERT INTO zosd_l3_pile (mandt,run_id,rule_name,pile_no,set_name,stage_no,model_hash,check_date,range_low,range_high,status,job_name,job_count,alerts,started,ended,attempt,reason,per_pile) VALUES ('','${runId}','ship-min-crew',3,'fleet2',2,'','${DATE}','S001','S001','PLANNED','','',0,0,0,0,'',0)`]);
      // A real completed pile crosses the threshold before the two waiting
      // piles are submitted. Those waiting piles have never had jobs.
      expect(status(await pile(runId, 3))).to.equal("DONE");
      const r = await dialogStep(() => cls().dry({iv_date: date()})); r.get().run_id.set(runId);
      const realUpdate = client.update;
      let conflicts = 0, samples = 0;
      client.update = async function (options) {
        const result = await realUpdate.call(this, options);
        const states = await this.query(`SELECT state FROM zosd_l3_budget WHERE run_id='${runId}'`);
        if (trim(states[0]?.state) === "NARROW" && options.table.replaceAll('"', "").toLowerCase() === "zosd_l3_pile"
            && options.set.some((s) => /GOV-CLAIM/.test(s)) && result.dbcnt === 1) {
          samples++;
          const active = await this.query(`SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE run_id='${runId}' AND (status='RUNNING' OR (status='PLANNED' AND (job_count<>'' OR reason='GOV-CLAIM')))`);
          if (Number(active[0].n) > 1) conflicts++;
        }
        return result;
      };
      try { await dialogStep(() => cls().resume({iv_run: str(runId)})); await drain(); } finally { client.update = realUpdate; }
      expect(samples).above(0); expect(conflicts).to.equal(0);
      // Basis-point threshold 1 keeps the stage-2 chain in NARROW. Only new submissions are capped; jobs
      // submitted before the crossing are allowed to finish.
      expect(status(await collect(r))).to.equal("DONE");
      expect(piles(runId).every((p) => p.status === "DONE")).to.equal(true);
      expect(events(runId).filter((e) => e.kind === "WARN")).to.have.length(1);
      expect(events(runId).some((e) => e.kind === "NARROW")).to.equal(true);

    });
    it("GLASS stops submissions; doctor is hands-off, resume refuses, reasoned continue is audited", async () => {
      await tune("budget.glass", "1"); const r = await run("P"); const runId = id(r); await drain();
      expect(status(await collect(r))).to.equal("GLASS");
      const before = piles(runId), beforeEvents = events(runId);
      const doctor = await dialogStep(() => cls().doctor({}));
      expect(doctor.array().some((a) => trim(a.get().doc_action.get()) === "GLASS")).to.equal(true);
      const resume = await dialogStep(() => cls().resume({iv_run: str(runId)}));
      expect(trim(resume.array()[0].get().doc_action.get())).to.equal("GLASS");
      expect(piles(runId)).to.deep.equal(before); expect(events(runId)).to.deep.equal(beforeEvents);
      expect(trim((await continueGlass(runId, 10, "   ")).get())).to.equal("");
      expect(trim((await continueGlass(runId, 10, "additional manual capacity")).get())).to.equal("X");
      const audit = events(runId).find((e) => e.kind === "CONTINUE");
      expect(audit).to.include({glass: 10, reason: "additional manual capacity"}); expect(audit.actor).not.to.equal(""); expect(audit.acted).above(0);
      await drain(); expect(status(await collect(r))).to.equal("DONE");
    });
    it("snapshot holds the actual glass; a default edit affects the next run", async () => {
      await tune("budget.glass", "9"); const r = await run(); await tune("budget.glass", "11");
      expect(budget(id(r)).glass).to.equal(9);
      expect(read("SELECT param_val FROM zosd_l3_run_conf WHERE run_id=? AND param_name='budget.glass'", id(r))[0].param_val).to.equal("9");
      const a = read("SELECT * FROM zosd_l3_alert WHERE run_id=? LIMIT 1", id(r))[0];
      expect((await explainAlert(`fleet2/${a.rule_name}/${a.model_hash}/${DATE}/${a.pile_no}/${a.alert_seq}`, {sets: [SET], db: dbPath} )).text).to.include("governor RUNNING: open");
      expect(budget(id(await run())).glass).to.equal(11);
    });
    it("per-pile cap holds without writing or reserving; resume ignores HELD; audited release can raise only that pile's cap", async () => {
      await exec(["UPDATE zosd_l2_ship SET status='A'"]);
      await tune("budget.per_pile", "1"); const r = await run(); const runId = id(r);
      expect(status(r)).to.equal("PARTIAL"); const held = piles(runId).find((p) => p.status === "HELD");
      expect(held).to.include({reason: "PER-PILE"});
      expect(read("SELECT * FROM zosd_l3_alert WHERE run_id=? AND rule_name=? AND pile_no=?", runId, held.rule_name, held.pile_no)).to.have.length(0);
      await dialogStep(() => cls().resume({iv_run: str(runId)})); expect(piles(runId).find((p) => p.rule_name === held.rule_name).status).to.equal("HELD");
      const release = await dialogStep(() => cls().release_pile({iv_run: str(runId), iv_rule: str(held.rule_name), iv_pile: int(held.pile_no), iv_per_pile: int(2), iv_reason: str("data checked")}));
      expect(trim(release.get())).to.equal("X"); expect(events(runId).some((e) => e.kind === "RELEASE" && e.reason === "data checked")).to.equal(true);
      expect(budget(runId).per_pile).to.equal(1);
      await dialogStep(() => cls().resume({iv_run: str(runId)})); await drain();
      // More than one abnormal rule can be held. The released pile completes;
      // others remain for their own review and the run remains PARTIAL.
      expect(piles(runId).find((p) => p.rule_name === held.rule_name).status).to.equal("DONE");
    });

    it("NARROW doctor/resume passes leave waiting attempts and audit untouched", async () => {
      expect(await waitingOracle()).to.equal(true);
      await drain();
    });
    it("NARROW retries a dumping chain to exhaustion, then runs the next pile and ends PARTIAL", async () => {
      const runId = await planned(10, 50, "NARROW");
      const check = abap.Classes.ZCL_L2_SHIP_MIN_CREW.check;
      let dumps = 0;
      abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = async function (args) {
        if (args.it_range.array().some((r) => trim(r.get().low.get()) === "S001")) {
          dumps++; throw new Error("governor chain dump");
        }
        return check.call(this, args);
      };
      try {
        await tune("retry.max", "2"); await tune("retry.backoff", "0");
        await dialogStep(() => cls().resume({iv_run: str(runId)}));
        for (let i = 0; i < 3; i++) {
          await drainJobOutbox(store);
          expect((await workQueuedBatch(process.cwd(), store)).kind).to.equal("failed");
          await exec([`UPDATE zosd_l3_pile SET ended=20000101000000 WHERE run_id='${runId}' AND pile_no=1`,
            `UPDATE zosd_l3_run SET started=20000101000000 WHERE run_id='${runId}'`]);
          // The doctor has no force flag: old timestamps make real backoff due.
          await dialogStep(() => cls().doctor({}));
        }
        expect(dumps).to.equal(3);
        await drain();
        const ps = piles(runId);
        expect(ps.find((p) => p.pile_no === 1)).to.include({status: "FAILED", attempt: 3});
        expect(ps.find((p) => p.pile_no === 2).status).to.equal("DONE");
        const r = await dialogStep(() => cls().dry({iv_date: date()}));
        r.get().run_id.set(runId);
        expect(status(await collect(r))).to.equal("PARTIAL");
        expect(read("SELECT status FROM zosd_l3_run WHERE run_id=?", runId)[0].status).to.equal("RELEASED");
      } finally { abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = check; }
    });
    // Real job failures consume attempts 1 and 2. Attempt 3 reaches an
    // operator stop, which is not a failure and must allow submit 4.
    async function retryReleaseOracle(stop) {
      await tune("retry.max", "2"); await tune("retry.backoff", "0");
      const runId = await planned(stop === "GLASS" ? 1 : 10, stop === "HELD" ? 1 : 50);
      await exec([`DELETE FROM zosd_l3_pile WHERE run_id='${runId}' AND pile_no=2`,
        `UPDATE zosd_l3_pile SET range_high='S002' WHERE run_id='${runId}'`]);
      // Capture the result shape while this run holds its date lock. A dry
      // run after completion would replace the released row with a new run.
      const r = await dialogStep(() => cls().dry({iv_date: date()})); r.get().run_id.set(runId);
      const check = abap.Classes.ZCL_L2_SHIP_MIN_CREW.check;
      let calls = 0;
      abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = async function (args) {
        calls++;
        if (calls <= 2 || stop === "FAILED") throw new Error("retry release regression dump");
        return check.call(this, args);
      };
      const work = async (kind) => {
        await drainJobOutbox(store);
        expect((await workQueuedBatch(process.cwd(), store)).kind).to.equal(kind);
      };
      const heal = async () => {
        await exec([`UPDATE zosd_l3_pile SET ended=20000101000000 WHERE run_id='${runId}'`,
          `UPDATE zosd_l3_run SET started=20000101000000 WHERE run_id='${runId}'`]);
        await dialogStep(() => cls().doctor({}));
      };
      try {
        await dialogStep(() => cls().resume({iv_run: str(runId)}));
        for (let attempt = 1; attempt <= 2; attempt++) {
          await work("failed"); await heal();
          expect(piles(runId)[0].attempt).to.equal(attempt + 1);
        }
        if (stop === "KILLED") await exec(["INSERT INTO zosd_l3_kill (mandt,set_name,reason) VALUES ('','fleet2','operator pause')"]);
        await work(stop === "FAILED" ? "failed" : "completed");
        if (stop === "FAILED") {
          await heal();
          await dialogStep(() => cls().resume({iv_run: str(runId)}));
          await drainJobOutbox(store);
          const outcome = await workQueuedBatch(process.cwd(), store);
          return outcome.kind !== "completed" && outcome.kind !== "failed"
            && piles(runId)[0].status === "FAILED" && piles(runId)[0].attempt === 3 && calls === 3;
        }
        expect(piles(runId)[0]).to.include({status: stop === "KILLED" ? "PLANNED" : stop, attempt: 3});
        if (stop === "GLASS") {
          expect(trim((await continueGlass(runId, 10, "capacity reviewed after retries")).get())).to.equal("X");
        } else {
          if (stop === "HELD") {
            const released = await dialogStep(() => cls().release_pile({iv_run: str(runId), iv_rule: str("ship-min-crew"),
              iv_pile: int(1), iv_per_pile: int(2), iv_reason: str("pile reviewed after retries")}));
            expect(trim(released.get())).to.equal("X");
          } else await exec(["DELETE FROM zosd_l3_kill"]);
          await dialogStep(() => cls().resume({iv_run: str(runId)}));
        }
        await drain();
        const result = await collect(r);
        return piles(runId)[0].status === "DONE" && piles(runId)[0].attempt === 4
          && status(result) === "DONE" && read("SELECT status FROM zosd_l3_run WHERE run_id=?", runId)[0].status === "RELEASED";
      } finally { abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = check; }
    }
    for (const stop of ["GLASS", "HELD", "KILLED", "FAILED"]) {
      it(`retry cap: ${stop} after retries ${stop === "FAILED" ? "remains capped" : "can be operator-released and finishes DONE"}`, async () => {
        expect(await retryReleaseOracle(stop)).to.equal(true);
      });
    }
    for (const stop of ["GLASS", "HELD", "KILLED"]) {
      it(`mutant retry cap before branch: ${stop} release is red, restored green`, async () => {
        expect(await retryReleaseOracle(stop)).to.equal(true);
        await fresh();
        const edit = methodEdit("heal", "IF ls_pile-status = 'FAILED'.\n        \" cap failed retries only; operator-released PLANNED piles keep submit history\n        IF ls_pile-attempt > gs_settings-vals-retry_max.\n          CONTINUE.\n        ENDIF.",
          "IF ls_pile-attempt > gs_settings-vals-retry_max.\n        CONTINUE.\n      ENDIF.\n      IF ls_pile-status = 'FAILED'.");
        expect(await mutant(`zcl_l3_fleet2_g_retry_${stop.toLowerCase()}`, edit, () => retryReleaseOracle(stop))).to.equal(false);
        await fresh(); expect(await retryReleaseOracle(stop)).to.equal(true);
      });
    }

    it("RUNNING after a refund has its own event kind", async () => {
      await tune("budget.glass", "5"); await tune("budget.warn", "1"); await tune("budget.narrow_at", "1");
      const r = await run("S", "close=maintenance"), es = events(id(r));
      expect(es.some((e) => e.kind === "RUNNING")).to.equal(true);
      expect(es.some((e) => e.kind === "NARROW" && e.reason === "RUNNING")).to.equal(false);
    });
    it("continue_glass reopens only stages stopped by the current GLASS episode", async () => {
      const runId = await planned(1);
      await exec([`UPDATE zosd_l3_stage SET status='PARTIAL' WHERE run_id='${runId}' AND stage_no=1`,
        `INSERT INTO zosd_l3_stage (mandt,run_id,stage_no,set_name,check_date,stage_name,status,opened,ended) VALUES ('','${runId}',3,'fleet2','${DATE}','later','NOT-RUN',0,0)`]);
      await pile(runId, 1); await pile(runId, 2);
      expect(events(runId).filter((e) => e.kind === "GLASS-STAGE").map((e) => e.amount)).to.deep.equal([2]);
      expect(trim((await continueGlass(runId, 10, "capacity reviewed")).get())).to.equal("X");
      expect(read("SELECT status FROM zosd_l3_stage WHERE run_id=? AND stage_no=1", runId)[0].status).to.equal("PARTIAL");
      expect(read("SELECT status FROM zosd_l3_stage WHERE run_id=? AND stage_no=2", runId)[0].status).to.equal("OPEN");
      expect(read("SELECT status FROM zosd_l3_stage WHERE run_id=? AND stage_no=3", runId)[0].status).to.equal("NOT-RUN");
      await drain();
    });
    it("a governed filter pile only reads GLASS and never reserves or writes the budget", async () => {
      const runId = await planned(10);
      await exec([`UPDATE zosd_l3_pile SET rule_name='ship-busy', stage_no=1 WHERE run_id='${runId}'`]);
      const select = client.select, update = client.update;
      let reads = 0, writes = 0;
      client.select = async function (o) { if (/FROM "?zosd_l3_budget/i.test(o.select)) reads++; return select.call(this, o); };
      client.update = async function (o) { if (o.table.replaceAll('"', "").toLowerCase() === "zosd_l3_budget") writes++; return update.call(this, o); };
      try {
        const r = await dialogStep(() => cls().run_rule({iv_rule: str("ship-busy"), iv_run: str(runId), iv_date: date(), iv_pile: int(1)}));
        expect(status(r)).to.equal("DONE"); expect(reads).to.equal(1); expect(writes).to.equal(0);
      } finally { client.select = select; client.update = update; }
    });
    it("jobs submitted before the NARROW crossing still execute", async () => {
      const runId = await planned(10);
      await exec([`UPDATE zosd_l3_budget SET warn_at=1, narrow_at=1 WHERE run_id='${runId}'`]);
      const rows = await dialogStep(() => cls().plan({iv_run: str(runId), iv_date: date(), iv_stage: int(2)}));
      const base = rows.array().find((r) => trim(r.get().rule_name.get()) === "ship-min-crew");
      for (const n of [1, 2]) {
        const p = base.clone(); p.get().pile_no.set(n); p.get().range_low.set(`S00${n}`); p.get().range_high.set(`S00${n}`);
        await dialogStep(() => cls().submit({iv_run: str(runId), iv_date: date(), iv_jobname: str("L3_FLEET2_206"), cs_pile: p}));
      }
      await drainJobOutbox(store);
      expect((await workQueuedBatch(process.cwd(), store)).kind).to.equal("completed");
      expect(budget(runId).state).to.equal("NARROW");
      expect((await workQueuedBatch(process.cwd(), store)).kind).to.equal("completed");
      expect(piles(runId).every((p) => p.status === "DONE")).to.equal(true);
    });
    for (const terminal of ["HELD", "FUSED"]) {
      it(`a NARROW chain ending ${terminal} submits its next pile`, async () => {
        const runId = await planned(10, terminal === "HELD" ? 1 : 50, "NARROW");
        if (terminal === "HELD") {
          await exec([`UPDATE zosd_l3_pile SET range_high='S002' WHERE run_id='${runId}' AND pile_no=1`]);
        } else {
          await exec(["UPDATE zosd_l2_ship SET status='M' WHERE ship_id='S001'",
            `UPDATE zosd_l3_pile SET rule_name='maintenance-ship-no-future-voyage' WHERE run_id='${runId}' AND pile_no=1`,
            `INSERT INTO zosd_l3_run_conf (mandt,run_id,set_name,param_name,param_val,origin,dsl_value) VALUES ('','${runId}','fleet2','fuses.max_alerts','1','DSL','500')`]);
        }
        await dialogStep(() => cls().resume({iv_run: str(runId)})); await drain();
        expect(piles(runId).find((p) => p.pile_no === 1).status).to.equal(terminal);
        expect(piles(runId).find((p) => p.pile_no === 2).status).to.equal("DONE");
      });
    }
    it("non-narrow piles hold no budget lock across L2; B admits while A checks", async () => {
      expect(await lockOracle()).to.equal(true);
    });

    const loaded = new Map();
    async function loadClass(real, name, edit) {
      const out = join(dir, name);
      mkdirSync(out, {recursive: true});
      const {Transpiler, core} = modulesOf(process.cwd());
      const reg = new core.Registry();
      const text = (jobMode.files[`${real}.clas.abap`] ?? readFileSync(join(OUT, `${real}.clas.abap`), "utf8")).replace(new RegExp(`\\b${real}\\b`, "g"), name);
      const edited = edit(text);
      expect(edited, `${name} differs from ${real}`).to.not.equal(text);
      writeFileSync(join(out, `${name}.clas.abap`), edited);
      loaded.set(name.toUpperCase(), {source: join(out, `${name}.clas.abap`), module: pathToFileURL(join(out, `${name}.clas.mjs`)).href});
      const files = {[`${name}.clas.abap`]: edited, [`${name}.clas.xml`]: readFileSync(join(OUT, `${real}.clas.xml`), "utf8").replace(real.toUpperCase(), name.toUpperCase())};
      for (const [f, t] of Object.entries(files)) reg.addFile(new core.MemoryFile(f, lowerNarrowSubmit(t, f, core)));
      const deps = [...daemonDependencies(),...l3TableDependencies(), "src/jobs/tbtcjob.tabl.xml", "src/jobs/btcselect.tabl.xml", "src/jobs/btch0000.tabl.xml",
        "gen/gui/zcl_osd_batch_report.clas.abap", "src/jobs/zcl_osd_submit_semantics.clas.abap", "src/jobs/zcl_osd_submit_ranges.clas.abap",
        ".local/lars/open-abap-gui/framework/zif_gg_selection_screen_types.intf.abap",
        ...readdirSync(OUT).filter((f) => /^zosd_l2_.*\.(tabl|dtel)\.xml$/.test(f)).map((f) => join(OUT, f)),
        ...readdirSync(OUT).filter((f) => /^(zif_l3_fleet2_|zcx_l3_fleet2_port|zcl_l3_fleet2)[a-z_]*\.(clas|intf)\.(abap|xml)$/.test(f) && !f.startsWith(`${real}.`)).map((f) => join(OUT, f)),
        ...model.rules.flatMap((r) => [`${OUT}/${r.check_class}.clas.abap`, `${OUT}/${r.check_class}.clas.xml`]),
        ...["ddic/ttyp/string_table.ttyp.xml", "ddic/structures/symsg.tabl.xml"].map((x) => join(CORE, x)),
        ...["uuid", "exceptions", ".", "ddic/dtel", "ddic/doma", "date_time"].flatMap((folder) => readdirSync(join(CORE, folder))
          .filter((f) => /\.(clas|intf)\.abap$|\.(dtel|doma)\.xml$/.test(f)).map((f) => join(CORE, folder, f)))];
      for (const dep of deps) {
        try { reg.addDependency(new core.MemoryFile(basename(dep), readFileSync(dep, "utf8"))); } catch { /* not in this checkout */ }
      }
      const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
      const output = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: []}).run(reg);
      const own = new Set(output.objects.map((o) => o.filename));
      const outputDir = pathToFileURL(join(process.cwd(), "output") + sep).href;
      for (const o of output.objects.filter((x) => x.object.type === "CLAS")) {
        writeFileSync(join(out, o.filename), o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (m, file) => own.has(file) ? m : `import("${outputDir}${file}")`));
      }
      const cxRoot = abap.Classes.CX_ROOT;
      await import(pathToFileURL(join(out, `${name}.clas.mjs`)).href);
      if (cxRoot) abap.Classes.CX_ROOT = cxRoot;
      expect(abap.Classes[name.toUpperCase()], `${name} loaded`).to.exist;
    }
    // the jobs reach the runner by name: the copy answers for it while `work` runs
    const withClass = async (real, name, work) => {
      const was = abap.Classes[real.toUpperCase()];
      abap.Classes[real.toUpperCase()] = abap.Classes[name.toUpperCase()];
      try { return await work(); } finally { abap.Classes[real.toUpperCase()] = was; }
    };
    const mutate = (from, to) => (text) => {
      expect(text, `the class holds ${JSON.stringify(from)}`).to.include(from);
      return text.replace(from, to);
    };
    const mutant = async (name, edit, work) => { await loadClass(RUNNER, name, edit); return withClass(RUNNER, name, work); };

    const fresh = async () => { await drain(); await exec([...TABLES, ...SOURCES].map((t) => `DELETE FROM ${t}`)); await seed(); };
    const methodEdit = (method, from, to) => (text) => {
      const start = text.indexOf(`  METHOD ${method}.`), end = text.indexOf("  ENDMETHOD.", start);
      const part = text.slice(start, end); expect(part).to.include(from);
      return text.slice(0, start) + part.replace(from, to) + text.slice(end);
    };
    async function admissionOracle() {
      const runId = await planned(1); await pile(runId, 1); await pile(runId, 2);
      const b = budget(runId); return b.reserved <= b.glass && b.state === "GLASS" && read("SELECT * FROM zosd_l3_alert WHERE run_id=?", runId).length === 1;
    }
    async function refundOracle() {
      const runId = await planned(1);
      await exec(["UPDATE zosd_l2_ship SET status='M' WHERE ship_id='S001'", `UPDATE zosd_l3_pile SET rule_name='maintenance-ship-no-future-voyage' WHERE run_id='${runId}' AND pile_no=1`]);
      await dialogStep(() => cls().run_rule({iv_rule: str("maintenance-ship-no-future-voyage"), iv_run: str(runId), iv_date: date(), iv_pile: int(1), iv_bind: str("close=maintenance")}));
      const next = await pile(runId, 2), b = budget(runId);
      return status(next) === "DONE" && b.reserved === b.consumed - b.refunded;
    }
    async function waitingOracle() {
      const runId = await planned(10, 50, "NARROW");
      await dialogStep(() => cls().resume({iv_run: str(runId)}));
      const audit = read("SELECT * FROM zosd_l3_doctor WHERE run_id=?", runId);
      for (let i = 0; i < 5; i++) {
        await dialogStep(() => cls().resume({iv_run: str(runId)}));
        await dialogStep(() => cls().doctor({}));
      }
      const waiting = piles(runId).find((p) => p.pile_no === 2);
      return waiting.attempt === 0 && !waiting.job_count
        && read("SELECT * FROM zosd_l3_doctor WHERE run_id=? AND doc_action='RESUBMIT' AND pile_no=2", runId).length === 0
        && read("SELECT * FROM zosd_l3_doctor WHERE run_id=?", runId).length === audit.length;
    }
    async function lockOracle() {
      const runId = await planned(10);
      const name = cls().INTERNAL_NAME, variant = loaded.get(name);
      const children = [];
      function launch(p) {
        const child = fork("test/helpers/dsl-governor-lock.mjs", [], {env: {...process.env,
          GOVERNOR_RUN: runId, GOVERNOR_PILE: String(p), GOVERNOR_PAUSE: p === 1 ? "1" : "0",
          GOVERNOR_LOCK: join(dir, "budget-row.lock"), GOVERNOR_CLASS: name,
          GOVERNOR_SOURCE: variant?.source ?? join(process.cwd(), OUT, `${RUNNER}.clas.abap`),
          ...(variant ? {GOVERNOR_MODULE: variant.module} : {})}, stdio: ["ignore", "pipe", "pipe", "ipc"]});
        let errors = "", answer;
        child.stderr.on("data", (x) => { errors += x; });
        const message = (field) => new Promise((resolve, reject) => {
          child.on("message", (m) => { if (m[field]) resolve(m); });
          child.once("exit", () => reject(new Error(errors || "child exited before " + field)));
        });
        const ready = message("ready"), checking = message("checking");
        checking.catch(() => {});
        const result = new Promise((resolve, reject) => {
          child.on("message", (m) => { if (m.status || m.error) answer = m; });
          child.once("exit", (code) => code || answer?.error ? reject(new Error(answer?.error ?? errors)) : resolve(answer));
        });
        result.catch(() => {}); children.push(child);
        return {child, ready, checking, result};
      }
      const a = launch(1); let b, timer;
      try {
        await a.ready; a.child.send("go");
        const checking = await a.checking;
        b = launch(2); await b.ready; b.child.send("go");
        const beforeRelease = await Promise.race([b.result, new Promise((resolve) => { timer = setTimeout(() => resolve(undefined), 1500); })]);
        return !checking.budgetLocked && checking.pilePending && beforeRelease?.status === "DONE";
      } finally {
        clearTimeout(timer);
        if (a.child.connected) a.child.send("release");
        await Promise.all([a.result, b?.result]);
        for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
      }
    }
    async function narrowOracle() {
      const runId = await planned(10, 50, "NARROW");
      const rows = await dialogStep(() => cls().plan({iv_run: str(runId), iv_date: date(), iv_stage: int(2)}));
      const base = rows.array().find((r) => trim(r.get().rule_name.get()) === "ship-min-crew");
      for (const n of [1, 2]) {
        const p = base.clone(); p.get().pile_no.set(n);
        await dialogStep(() => cls().submit({iv_run: str(runId), iv_date: date(), iv_jobname: str("L3_FLEET2_206"), cs_pile: p}));
      }
      return piles(runId).filter((p) => p.status === "PLANNED" && p.job_count).length === 1;
    }
    async function glassOracle() {
      const runId = await planned(1, 50, "GLASS");
      const plannedRows = await dialogStep(() => cls().plan({iv_run: str(runId), iv_date: date(), iv_stage: int(2)}));
      const p = plannedRows.array().find((x) => trim(x.get().rule_name.get()) === "ship-min-crew");
      await dialogStep(() => cls().submit({iv_run: str(runId), iv_date: date(), iv_jobname: str("L3_FLEET2_206"), cs_pile: p}));
      return piles(runId).every((p) => !p.job_count);
    }
    async function auditOracle() {
      const runId = await planned(1, 50, "GLASS"); await continueGlass(runId, 10, "human approved");
      return events(runId).some((e) => e.kind === "CONTINUE" && e.actor && e.acted > 0 && e.reason === "human approved");
    }
    async function distinctOracle() {
      const r = await run();
      const hits = read("SELECT * FROM zosd_l3_alert WHERE run_id=?", id(r)).length;
      const alerts = read("SELECT * FROM zosd_l3_object WHERE run_id=?", id(r)).length;
      return alerts < hits && budget(id(r)).consumed === alerts;
    }
    async function capOracle() {
      await exec(["UPDATE zosd_l2_ship SET status='A'"]);
      await tune("budget.per_pile", "1"); const r = await run();
      const held = piles(id(r)).filter((p) => p.status === "HELD");
      return held.length > 0 && held.every((p) => read("SELECT * FROM zosd_l3_alert WHERE run_id=? AND rule_name=? AND pile_no=?", id(r), p.rule_name, p.pile_no).length === 0);
    }
    for (const [name, edit, oracle] of [
      ["heal_narrow", (text) => methodEdit("heal", "attempt = ls_claim-attempt", "attempt = lv_next")(
        methodEdit("heal", "IF lv_chains > 0.", "IF abap_false = abap_true.")(text)), waitingOracle],
      ["early_lock", methodEdit("run_rule", "SELECT SINGLE * FROM zosd_l3_budget INTO ls_budget", "SELECT SINGLE FOR UPDATE * FROM zosd_l3_budget INTO ls_budget"), lockOracle],
      ["reserve", mutate("        AND reserved <= lv_room AND consumed <= lv_total_room.", "        AND consumed <= lv_total_room."), admissionOracle],
      ["refund", mutate("reserved = reserved - lv_closed refunded = refunded + lv_closed", "reserved = reserved - 0 refunded = refunded + lv_closed"), refundOracle],
      ["narrow", methodEdit("submit", "IF ls_guard-state = 'NARROW'.", "IF abap_false = abap_true."), narrowOracle],
      ["glass", methodEdit("submit", "IF sy-subrc <> 0 OR ls_guard-state = 'GLASS'.", "IF sy-subrc <> 0."), glassOracle],
      ["audit", mutate("    budget_event( iv_run = iv_run iv_kind = 'CONTINUE' iv_amount = iv_new_glass iv_reason = iv_reason ).", "    budget_refresh( iv_run )."), auditOracle],
      ["hits", mutate("    lv_room = ls_guard-glass - lv_new.", "    lv_new = lines( lt_rows ).\n    lv_room = ls_guard-glass - lv_new."), distinctOracle],
      ["cap", mutate("IF lv_cap > 0 AND lv_candidates > lv_cap.", "IF abap_false = abap_true."), capOracle],
    ]) {
      it(`mutant ${name}: the same oracle is green, red, then restored green`, async () => {
        expect(await oracle(), "original green").to.equal(true);
        await fresh();
        expect(await mutant(`zcl_l3_fleet2_g_${name}`, edit, oracle), "mutant red").to.equal(false);
        await fresh(); expect(await oracle(), "restored green").to.equal(true);
        await drain();
      });
    }
  });
});
