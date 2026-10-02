// DSL L3, slice 5a (docs/dsl-l3.md, "Resilience"): a run that heals itself
// and stops itself, every property from the set's `resilience:` block. The
// doctor marks a pile whose job is over FAILED and submits it again after its
// backoff within the retry budget, re-plans an OPEN gate whose plan was lost,
// advances a gate a dying job did not get to, and releases a stale lock of a
// run that is final or never planned; two doctors at once act once. The fuse
// stops a rule past max_alerts, the kill switch stops piles and gates until
// resume( ), a dry run writes nothing to the log, and purge( ) keeps open runs
// and the alert log. The manifest's refusals at their lines, the trace, the
// runs on a file database with the jobs facade and the injectable clock, and
// each mutant of the slice against the test that names it.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, renderSet, SetError, unitFindings} from "../tools/dsl-l3.mjs";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const SET = "src/l2demo/fleet2.l3.yaml";
const ONE = "src/l2demo/fleet.l3.yaml";
const OUT = "src/l2demo";
const CORE = ".local/lars/open-abap-core/src";
const RUNNER = "zcl_l3_fleet2";
const REPORT = "zl3_fleet2";
const SET_TEXT = readFileSync(SET, "utf8");
const DATE = "20261001";
const setLine = (re, text = SET_TEXT) => text.split("\n").findIndex((l) => re.test(l)) + 1;
const where = (file) => relative(process.cwd(), file).split(sep).join("/");

// the fleet of test/dsl-l3-stages.mjs: the filter keeps S001 and S002
const FLEET = {
  zosd_l2_ship: [["S001", "Albatross", "M"], ["S002", "Bluebird", "A"], ["S003", "Condor", "A"], ["S004", "Dove", "A"]],
  zosd_l2_voy: [["V00001", "S001", "20261005"], ["V00002", "S002", "20261010"], ["V00003", "S002", "20261011"],
    ["V00004", "S002", "20261012"], ["V00005", "S004", "20260901"]],
  zosd_l2_crew: [["C00001", "S001", "P", "20260101"], ["C00002", "S002", "C", "20260101"],
    ["C00003", "S004", "C", "20260101"], ["C00004", "S004", "P", "20260101"]],
  zosd_l2_cargo: [["K00001", "S003", "600.50"], ["K00002", "S003", "500.00"], ["K00003", "S004", "1.25"]],
};
const COLUMNS = {zosd_l2_ship: ["ship_id", "name", "status"], zosd_l2_voy: ["voyage_id", "ship_id", "dep_date"],
  zosd_l2_crew: ["crew_id", "ship_id", "role", "since"], zosd_l2_cargo: ["cargo_id", "ship_id", "weight"]};
const TABLES = ["zosd_l3_budget", "zosd_l3_event", "zosd_l3_object", "zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_stage", "zosd_l3_work", "zosd_l3_doctor", "zosd_l3_kill", "zosd_l3_conf", "zosd_l3_conf_log", "zosd_l3_run_conf"];
// the sections of this slice in the templates
const SECTIONS = ["resilience", "fused", "killable"];

describe("DSL L3 slice 5a: resilience, the doctor, fuses, a dry run and retention", function () {
  this.timeout(900000);
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), "dsl-l3-resilience-")); });
  after(() => rmSync(scratch, {recursive: true, force: true}));

  describe("the manifest", () => {
    it("the committed fleet2 is a fresh build, and the one-stage fleet without resilience: is too", async () => {
      expect(await checkSet(SET, OUT)).to.deep.equal([]);
      expect(await checkSet(ONE, OUT)).to.deep.equal([]);
    });

    it("the model: retry, stale, the fuses, dry run, keep; the doctor's job every 15 minutes", () => {
      const {resilience, fused, killable} = compileSet(SET);
      expect([resilience.retry.max, resilience.retry.backoff, resilience.stale.seconds, resilience.dry_run.value, resilience.keep.days])
        .to.deep.equal(["2", "60", "900", "abap_false", "30"]);
      expect(resilience.stale.job).to.include({name: "L3_FLEET2_DOC", field: "prdmins", count: "15"});
      expect([fused.count, killable.table]).to.deep.equal(["500", "zosd_l3_kill"]);
    });

    it("a staged set without resilience: renders what the templates render with every section of slice 5a taken out", async () => {
      const strip = (template) => {
        let text = readFileSync(template, "utf8");
        for (const n of SECTIONS) {
          text = text.replace(new RegExp(`^\\{\\{#${n}\\}\\}\\n[\\s\\S]*?^\\{\\{/${n}\\}\\}\\n`, "gm"), "")
            .replace(new RegExp(`\\{\\{#${n}\\}\\}[^\\n]*?\\{\\{/${n}\\}\\}`, "g"), "");
        }
        return text;
      };
      const file = join(OUT, `zz_plain_${process.pid}.l3.yaml`);
      writeFileSync(file, SET_TEXT.replace(/^governor:\n(  .*\n)+/m, "").replace(/^resilience:\n(  .*\n)+/m, "").replace(/^settings:\n(  .*\n|    .*\n)+/m, ""));
      try {
        const model = compileSet(file);
        expect([model.resilience, model.fused, model.killable]).to.deep.equal([undefined, undefined, undefined]);
        const {renderRecipe} = await import("../tools/dsl-abap.mjs");
        const {files} = await renderSet(model);
        for (const [template, out] of [["recipes/l3-set/template.tpl", `${model.class}.clas.abap`], ["recipes/l3-job/template.tpl", `${model.report}.prog.abap`]]) {
          const stripped = join(scratch, `plain-${basename(dirname(template))}.tpl`);
          writeFileSync(stripped, strip(template));
          expect(readFileSync(stripped, "utf8"), template).to.not.match(/doctor|resume|purge|killed|attempt|c_max_alerts|dry_run|\bFUSED\b|\bKILLED\b/i);
          expect(files[out], out).to.equal((await renderRecipe(model, stripped)).text);
        }
      } finally { rmSync(file, {force: true}); }
    });

    // a copy of the set with some lines replaced, its rules beside it by path
    const manifest = (name, edits, text = SET_TEXT) => {
      const dir = join(scratch, name);
      mkdirSync(dir, {recursive: true});
      for (const [from, to] of edits) {
        expect(text, `the set has ${JSON.stringify(from)}`).to.include(from);
        text = text.replace(from, to);
      }
      text = text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => `rule: ${relative(dir, join(process.cwd(), OUT, f)).split(sep).join("/")}`);
      const file = join(dir, basename(text.includes("stages:") ? SET : ONE));
      writeFileSync(file, text);
      return file;
    };
    const refusedAt = (file, message, at) => {
      const line = readFileSync(file, "utf8").split("\n").findIndex((l) => at.test(l)) + 1;
      expect(line, `a line matches ${at}`).to.be.greaterThan(0);
      let error;
      try { compileSet(file); } catch (e) { error = e; }
      expect(error, "refused").to.be.instanceOf(SetError);
      expect(error.message.slice(where(file).length), error.message).to.match(new RegExp(`^:${line}: ${message.source}`));
    };
    const BLOCK = SET_TEXT.slice(SET_TEXT.indexOf("resilience:\n"), SET_TEXT.indexOf("settings:\n"));

    it("refusals, each at its line", () => {
      refusedAt(manifest("nostages", [], readFileSync(ONE, "utf8") + BLOCK), /resilience needs stages:/, /^resilience:$/);
      refusedAt(manifest("unknown", [["  stale: 900\n", "  stale: 900\n  retries: 3\n"]]), /unknown key retries in resilience/, /retries: 3/);
      refusedAt(manifest("nostale", [["  stale: 900\n", ""]]), /resilience needs stale:/, /^resilience:$/);
      refusedAt(manifest("shortstale", [["  stale: 900\n", "  stale: 10\n"]]), /stale \(seconds\) is a whole number from 60 to 356400, not "10"/, /stale: 10/);
      refusedAt(manifest("nokeep", [["  keep: {days: 30}\n", ""]]), /resilience needs keep:/, /^resilience:$/);
      refusedAt(manifest("kill", [["kill: ZOSD_L3_KILL", "kill: ZMY_KILL"]]), /fuses\.kill names ZOSD_L3_KILL/, /kill: ZMY_KILL/);
      refusedAt(manifest("fuse0", [["max_alerts: 500", "max_alerts: 0"]]), /fuses\.max_alerts is a whole number from 1/, /max_alerts: 0/);
      refusedAt(manifest("retry", [["{max: 2, backoff: 60}", "{max: 100, backoff: 60}"]]), /retry\.max is a whole number from 0 to 99/, /retry: \{max: 100/);
      refusedAt(manifest("dry", [["dry_run: false", "dry_run: maybe"]]), /dry_run is true or false/, /dry_run: maybe/);
      refusedAt(manifest("nocapture", [["      dummy: generated\n      capture: generated\n", "      dummy: generated\n"]]),
        /resilience needs the generated capture variant of sink alerts/, /^resilience:$/);
    });

    it("the doctor's period: stale rounded to minutes, hours past 99 minutes", () => {
      const job = (stale) => compileSet(manifest(`period${stale}`, [["  stale: 900\n", `  stale: ${stale}\n`]])).resilience.stale.job;
      expect(job(7200)).to.include({field: "prdhours", count: "2"});
      expect(job(90)).to.include({field: "prdmins", count: "2"});
    });

    it("the trace: each constant and branch of slice 5a traces to its own manifest line", () => {
      const text = (f) => readFileSync(join(OUT, f), "utf8").split("\n");
      const trace = (f) => JSON.parse(readFileSync(join(OUT, f.replace(/\.abap$/, ".trace.json")), "utf8"));
      const of = (f, re) => trace(f).lines.filter((e) => re.test(text(f)[e.line - 1]));
      const runner = `${RUNNER}.clas.abap`;
      for (const f of [runner, `${REPORT}.prog.abap`]) {
        expect(trace(f).lines.length, f).to.equal(text(f).length - 1);
      }
      expect(of(runner, /CONSTANTS c_retry_max /)[0]).to.include({node: "set/fleet2/resilience/retry", set_line: setLine(/^  retry:/)});
      expect(of(runner, /CONSTANTS c_stale /)[0]).to.include({node: "set/fleet2/resilience/stale", set_line: setLine(/^  stale:/)});
      expect(of(runner, /CONSTANTS c_doctor /)[0].set_line).to.equal(setLine(/^  stale:/));
      expect(of(runner, /CONSTANTS c_max_alerts /)[0]).to.include({node: "set/fleet2/resilience/fuses/max_alerts", set_line: setLine(/max_alerts:/)});
      expect(of(runner, /CONSTANTS c_keep_days /)[0]).to.include({node: "set/fleet2/resilience/keep", set_line: setLine(/^  keep:/)});
      expect(of(runner, /iv_dry_run TYPE abap_bool DEFAULT abap_false/)[0]).to.include({node: "set/fleet2/resilience/dry_run", set_line: setLine(/dry_run:/)});
      expect(of(runner, /SELECT SINGLE set_name FROM zosd_l3_kill/)[0]).to.include({node: "set/fleet2/resilience/fuses/kill", set_line: setLine(/kill: ZOSD_L3_KILL/)});
      expect(of(runner, /IF lv_total > gs_settings-vals-fuses_max_alerts\./)[0].set_line).to.equal(setLine(/max_alerts:/));
      expect(of(runner, /METHOD doctor\./)[0]).to.include({node: "set/fleet2/resilience", set_line: setLine(/^resilience:/)});
      expect(of(runner, /^ +prd[a-z]+ = lv_(period|minutes|hours)$/).map((e) => e.set_line), "the driver's period, the doctor's").to.deep.equal([setLine(/^schedule:/), setLine(/^settings:/), setLine(/^settings:/)]);
      expect(of(`${REPORT}.prog.abap`, /IF p_mode = 'H'\./)[0].set_line).to.equal(setLine(/^resilience:/));
    });

    it("the runner still ends no unit of work: the doctor and resume( ) run in the caller's LUW", () => {
      expect(unitFindings(readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8"), `${RUNNER}.clas.abap`, {writes: true, jobs: true})).to.deep.equal([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("on a durable database, with the jobs facade and the injectable clock", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, store, dialogStep, drainJobOutbox, workQueuedBatch;
    let clock, restoreClock, JobScheduler, installAbapClock, manualClock;
    const START = Date.parse("2026-10-01T08:00:00Z");
    const root = process.cwd();
    const date = (d = DATE) => new abap.types.Date().set(d);
    const str = (s) => new abap.types.String().set(s);
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    const clearAll = () => exec(TABLES.map((t) => `DELETE FROM ${t}`));
    const stamp = (ms = clock.now()) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const model = compileSet(SET);
    const checks = model.rules.filter((r) => !r.filter);
    const log = () => read("SELECT * FROM zosd_l3_alert WHERE set_name = 'fleet2' ORDER BY rule_name, pile_no, alert_seq")
      .map((r) => ({rule: r.rule_name.trim(), pile: Number(r.pile_no), text: String(r.alert_text), run: r.run_id.trim(), date: r.check_date}));
    const content = (rows) => rows.map(({rule, text}) => `${rule}: ${String(text).trimEnd()}`).sort();
    const trim = (v) => (typeof v === "string" ? v.trim() : v);
    const plain = (raw) => {
      const r = raw.get();
      return {run: trim(r.run_id.get()), status: trim(r.status.get()), alerts: r.alerts.get(), raw,
        stages: r.stages.array().map((s) => ({no: s.get().stage_no.get(), status: trim(s.get().status.get())})),
        rules: r.rules.array().map((x) => Object.fromEntries(["rule", "status", "alerts", "piles", "piles_done"].map((k) => [k, trim(x.get()[k].get())]))),
        dry: r.dry.array().map((x) => ({rule: trim(x.get().rule_name.get()), text: x.get().alert_text.get()}))};
    };
    const report = (raw) => raw.array().map((x) => Object.fromEntries(["run_id", "stage_no", "rule_name", "pile_no", "doc_action", "reason"]
      .map((k) => [k, trim(x.get()[k].get())])));
    const cls = (name = RUNNER) => abap.Classes[name.toUpperCase()];
    const runSet = ({className = RUNNER, mode = "S", day = DATE, dry} = {}) => dialogStep(() => cls(className).run({
      iv_date: date(day), iv_mode: new abap.types.Character(1).set(mode),
      ...(dry ? {iv_dry_run: new abap.types.Character(1).set("X")} : {})})).then(plain);
    const doctor = (className = RUNNER) => dialogStep(async () => report(await cls(className).doctor({})));
    const resume = (run, className = RUNNER) => dialogStep(async () => report(await cls(className).resume({iv_run: str(run)})));
    const purge = (className = RUNNER) => dialogStep(async () => report(await cls(className).purge({})));
    const actions = (rows) => rows.map((r) => `${r.doc_action} ${r.reason}${r.rule_name ? ` ${r.rule_name} ${r.pile_no}` : r.stage_no ? ` stage ${r.stage_no}` : ""}`);
    const plan = (run, stage) => read("SELECT rule_name, pile_no, status, attempt, reason, job_count FROM zosd_l3_pile WHERE run_id = ? AND stage_no = ? ORDER BY rule_name, pile_no", run, stage)
      .map((r) => ({rule: r.rule_name.trim(), pile: Number(r.pile_no), status: r.status.trim(), attempt: Number(r.attempt ?? 0), reason: String(r.reason ?? "").trim(), job: String(r.job_count ?? "").trim()}));
    const pileOf = (run, rule) => plan(run, 2).find((p) => p.rule === rule);
    const gates = (run) => read("SELECT stage_no, status FROM zosd_l3_stage WHERE run_id = ? ORDER BY stage_no", run).map((r) => r.status.trim());
    const lockRow = (day = DATE) => read("SELECT run_id, status FROM zosd_l3_run WHERE set_name = 'fleet2' AND check_date = ?", day)
      .map((r) => ({run: r.run_id.trim(), status: r.status.trim()}))[0];
    const audit = (run) => read("SELECT seq, doc_action, reason FROM zosd_l3_doctor WHERE run_id = ? ORDER BY seq", run)
      .map((r) => `${r.doc_action.trim()} ${r.reason.trim()}`);
    const jobsNamed = (name, since) => store.db.prepare("SELECT job_name, state FROM batch_runs WHERE job_name = ? AND rowid > ? ORDER BY rowid").all(name, since);
    const lastJob = () => store.db.prepare("SELECT MAX(rowid) AS n FROM batch_runs").get().n ?? 0;
    const drainAndWork = async (limit = 60) => {
      await drainJobOutbox(store);
      const outcomes = [];
      for (let i = 0; i < limit; i++) {
        const outcome = await workQueuedBatch(root, store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) {
          if ((await drainJobOutbox(store)).imported) continue;
          break;
        }
        outcomes.push(outcome.kind);
      }
      return outcomes;
    };
    const tick = (seconds) => clock.set(clock.now() + seconds * 1000);
    // what the check rules of stage 2 answer over the ships the filter keeps, called directly
    const expected = async () => {
      const busy = await abap.Classes.ZCL_L2_SHIP_BUSY.keys({iv_date: date()});
      const rows = [];
      for (const r of checks) {
        const alerts = await abap.Classes[r.check_class.toUpperCase()].check({iv_date: date(), it_range: busy});
        for (const a of alerts.array()) rows.push(`${r.name}: ${String(a.get()).trimEnd()}`);
      }
      return rows.sort();
    };
    // a check class that dumps: `times` calls throw (Infinity: every call), the rest answer
    const dumping = (className, times) => {
      const real = abap.Classes[className].check;
      let left = times;
      abap.Classes[className].check = async function (...args) {
        if (left > 0) { left--; throw new Error(`${className} dumps (a test fault)`); }
        return real.apply(this, args);
      };
      return () => { abap.Classes[className].check = real; };
    };
    const MIN_CREW = "ZCL_L2_SHIP_MIN_CREW";
    const MIN_CREW_RULE = "ship-min-crew";

    before(async () => {
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-l3-resilience-db-"));
      dbPath = join(dir, "business.sqlite");
      envBefore = Object.fromEntries(["STG_DB", "STG_DB_PATH", "OSD_OPERATIONS_DB"].map((n) => [n, process.env[n]]));
      priorAbap = globalThis.abap;
      if (priorAbap?.context) priorContext = {databaseConnections: {...priorAbap.context.databaseConnections},
        RFCDestinations: {...priorAbap.context.RFCDestinations}, osdGeneration: priorAbap.context.osdGeneration};
      process.env.STG_DB = "file";
      process.env.STG_DB_PATH = dbPath;
      process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
      const {initializeABAP} = await import("../output/init.mjs");
      await initializeABAP();
      abap = globalThis.abap;
      client = abap.context.databaseConnections.DEFAULT;
      ({dialogStep} = await import("../tools/osd-dialog-step.mjs"));
      ({drainJobOutbox} = await import("../tools/osd-job-outbox.mjs"));
      const batch = await import("../tools/osd-batch-runs.mjs");
      workQueuedBatch = batch.workQueuedBatch;
      store = new batch.BatchRuns(root, process.env);
      ({JobScheduler, installAbapClock, manualClock} = await import("../tools/osd-job-scheduler.mjs"));
      clock = manualClock(START);
      restoreClock = installAbapClock(abap, clock);
      const inserts = Object.entries(FLEET).flatMap(([table, rows]) => rows.map((row) =>
        `INSERT INTO ${table} (mandt, ${COLUMNS[table].join(", ")}) VALUES ('123', ${row.map((v) => `'${v}'`).join(", ")})`));
      await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), ...inserts]);
    });
    let classesBefore;
    before(() => { classesBefore = {...globalThis.abap.Classes}; });
    after(() => {
      const classes = globalThis.abap.Classes;
      for (const key of Object.keys(classes)) if (!(key in classesBefore)) delete classes[key];
      Object.assign(classes, classesBefore);
    });
    after(async () => {
      restoreClock?.();
      if (client) await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), ...TABLES.map((t) => `DELETE FROM ${t}`)]).catch(() => {});
      store?.close();
      await client?.disconnect?.();
      if (priorAbap === abap && priorContext) {
        abap.context.databaseConnections = priorContext.databaseConnections;
        abap.context.RFCDestinations = priorContext.RFCDestinations;
        if (priorContext.osdGeneration === undefined) delete abap.context.osdGeneration;
        else abap.context.osdGeneration = priorContext.osdGeneration;
      }
      if (priorAbap !== undefined) globalThis.abap = priorAbap;
      for (const [name, value] of Object.entries(envBefore ?? {})) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      if (dir) rmSync(dir, {recursive: true, force: true});
    });
    // every test starts at the same clock and an empty plan, and leaves no job queued
    beforeEach(async () => { clock.set(START); await drainAndWork(); await clearAll(); });

    // ---- mutants: a copy of a committed class under another name, one edit made ----
    async function loadClass(real, name, edit) {
      const out = join(scratch, name);
      mkdirSync(out, {recursive: true});
      const {Transpiler, core} = modulesOf(process.cwd());
      const reg = new core.Registry();
      const text = readFileSync(join(OUT, `${real}.clas.abap`), "utf8").replace(new RegExp(`\\b${real}\\b`, "g"), name);
      const edited = edit(text);
      expect(edited, `${name} differs from ${real}`).to.not.equal(text);
      const files = {[`${name}.clas.abap`]: edited, [`${name}.clas.xml`]: readFileSync(join(OUT, `${real}.clas.xml`), "utf8").replace(real.toUpperCase(), name.toUpperCase())};
      for (const [f, t] of Object.entries(files)) reg.addFile(new core.MemoryFile(f, lowerNarrowSubmit(t, f, core)));
      const deps = [...TABLES.map((t) => `src/dsl/${t}.tabl.xml`), "src/jobs/tbtcjob.tabl.xml", "src/jobs/btcselect.tabl.xml", "src/jobs/btch0000.tabl.xml",
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

    // ---- a pile job that dumps, the backoff, the retry ----------------------
    // mode P with the min-crew check dumping `times` times; the doctor at each
    // moment named; what is wrong, as a list
    async function dumpProblems({times = 1} = {}) {
      const problems = [];
      const want = await expected();
      const since = lastJob();
      const restore = dumping(MIN_CREW, times);
      try {
        const run = (await runSet({mode: "P"})).run;
        await drainAndWork();
        const lost = pileOf(run, MIN_CREW_RULE);
        if (lost.status !== "PLANNED" || !lost.job) problems.push(`the dumped pile is ${JSON.stringify(lost)}, not PLANNED with its job`);
        if (JSON.stringify(gates(run)) !== JSON.stringify(["DONE", "OPEN"])) problems.push(`gates ${JSON.stringify(gates(run))} before the doctor`);
        const first = actions(await doctor());
        if (JSON.stringify(first) !== JSON.stringify([`FAILED JOB-ENDED ${MIN_CREW_RULE} 1`])) problems.push(`the first pass: ${JSON.stringify(first)}`);
        // the backoff: 60 s after the failure, doubled per attempt
        let resubmits = 0;
        for (let attempt = 1; attempt <= 4; attempt++) {
          const wait = 60 * 2 ** (attempt - 1);
          tick(wait - 1);
          const early = actions(await doctor());
          if (early.length) problems.push(`attempt ${attempt}, 1 s before its backoff: ${JSON.stringify(early)}`);
          tick(1);
          const due = actions(await doctor());
          if (!due.length) break;
          if (JSON.stringify(due) !== JSON.stringify([`RESUBMIT RETRY ${MIN_CREW_RULE} 1`])) problems.push(`attempt ${attempt}: ${JSON.stringify(due)}`);
          resubmits++;
          await drainAndWork();
          if (pileOf(run, MIN_CREW_RULE).status === "DONE") break;
          const again = actions(await doctor());
          if (JSON.stringify(again) !== JSON.stringify([`FAILED JOB-ENDED ${MIN_CREW_RULE} 1`])) problems.push(`after attempt ${attempt + 1}: ${JSON.stringify(again)}`);
        }
        const jobs = jobsNamed("L3_FLEET2_206_0001", since).length;
        return {problems, run, want, resubmits, jobs};
      } finally { restore(); }
    }

    it("a pile job that dumps: the doctor marks it FAILED, submits it again after its backoff, and the run completes with a clean run's log", async () => {
      const {problems, run, want, resubmits, jobs} = await dumpProblems();
      expect(problems).to.deep.equal([]);
      expect([resubmits, jobs]).to.deep.equal([1, 2]);
      expect(pileOf(run, MIN_CREW_RULE)).to.include({status: "DONE", attempt: 2, reason: "RETRY"});
      expect(gates(run)).to.deep.equal(["DONE", "DONE"]);
      expect(lockRow()).to.deep.equal({run, status: "RELEASED"});
      expect(content(log())).to.deep.equal(want);
      expect(audit(run)).to.deep.equal(["FAILED JOB-ENDED", "RESUBMIT RETRY"]);
    });

    it("retry.max exceeded: three submits, then the doctor stops; once stale the lock goes and the rule is PARTIAL", async () => {
      const {problems, run, resubmits, jobs} = await dumpProblems({times: Infinity});
      expect(problems).to.deep.equal([]);
      expect([resubmits, jobs], "the first submit and retry.max (2) more").to.deep.equal([2, 3]);
      expect(pileOf(run, MIN_CREW_RULE)).to.include({status: "FAILED", attempt: 3, reason: "JOB-ENDED"});
      expect(lockRow().status, "not stale yet").to.equal("HELD");
      tick(900);
      expect(actions(await doctor())).to.deep.equal(["RELEASE ALL-FINAL"]);
      expect(lockRow()).to.deep.equal({run, status: "RELEASED"});
      expect(gates(run)).to.deep.equal(["DONE", "PARTIAL"]);
      // the other rules of the stage are final; the failed one keeps no row of this run
      expect(log().filter((r) => r.rule === MIN_CREW_RULE)).to.deep.equal([]);
      expect(new Set(log().map((r) => r.rule)).size).to.be.greaterThan(1);
      expect(actions(await doctor()), "a released run is not the doctor's").to.deep.equal([]);
    });

    it("mutant: the backoff ignored: the pile goes again in the pass that marks it FAILED", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_backoff", mutate("        IF due( is_pile = ls_pile iv_now = iv_now iv_force = iv_force ) = abap_false.\n",
        "        IF abap_false = abap_true.\n"), () => dumpProblems());
      expect(problems.join("\n")).to.match(/the first pass: \["FAILED JOB-ENDED ship-min-crew 1","RESUBMIT RETRY ship-min-crew 1"\]/);
    });

    it("mutant: the retry budget ignored: a fourth submit", async () => {
      const {resubmits} = await mutant("zcl_l3_fleet2_m_budget", mutate("      IF ls_pile-attempt > gs_settings-vals-retry_max.\n        CONTINUE.\n      ENDIF.\n      IF ls_pile-status = 'FAILED'.\n",
        "      IF ls_pile-status = 'FAILED'.\n"), () => dumpProblems({times: Infinity}));
      expect(resubmits).to.be.greaterThan(2);
    });

    // ---- two doctors at once ---------------------------------------------------
    // a FAILED pile past its backoff; the second doctor runs whole inside the
    // first one's pass, after the first has read the pile and before it claims it
    async function twoDoctorProblems(className = RUNNER) {
      const problems = [];
      const since = lastJob();
      const restore = dumping(MIN_CREW, 1);
      try {
        const run = (await runSet({mode: "P"})).run;
        await drainAndWork();
        await doctor();
        tick(60);
        const real = cls(RUNNER).due;
        let inner;
        cls(RUNNER).due = async function (...args) {
          if (inner === undefined) {
            inner = "running";
            inner = report(await cls(RUNNER).doctor({}));
          }
          return real.apply(this, args);
        };
        let outer;
        try { outer = await dialogStep(async () => report(await cls(RUNNER).doctor({}))); } finally { cls(RUNNER).due = real; }
        const all = [...actions(inner ?? []), ...actions(outer)].filter((a) => a.startsWith("RESUBMIT"));
        if (all.length !== 1) problems.push(`${all.length} resubmits: ${JSON.stringify(all)}`);
        await drainJobOutbox(store);
        const jobs = jobsNamed("L3_FLEET2_206_0001", since).length;
        if (jobs !== 2) problems.push(`${jobs} jobs of the pile, the first and one retry expected`);
        const again = [...actions(await doctor()), ...actions(await doctor())];
        if (again.length) problems.push(`two more doctors: ${JSON.stringify(again)}`);
        if (JSON.stringify(audit(run).filter((a) => a.startsWith("RESUBMIT"))) !== JSON.stringify(["RESUBMIT RETRY"])) problems.push(`audit ${JSON.stringify(audit(run))}`);
        await drainAndWork();
        if (lockRow().status !== "RELEASED") problems.push("the run did not complete");
      } finally { restore(); }
      return {problems, className};
    }

    it("two doctors at once: every action happens once (one resubmit, one job), and two more passes find nothing to do", async () => {
      expect((await twoDoctorProblems()).problems).to.deep.equal([]);
    });

    it("mutant: the doctor's claim without the conditional UPDATE: a double resubmit", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_claim", mutate("          AND status = ls_pile-status\n          AND attempt = ls_pile-attempt.\n", ".\n"),
        () => twoDoctorProblems());
      expect(problems.join("\n")).to.match(/2 resubmits/);
    });

    // ---- stale locks -----------------------------------------------------------
    it("a HELD lock of a dead run (no plan row): released once stale, with the reason, and a new run can start", async () => {
      // the rows the runner writes carry no client here (ANORMALIES no-implicit-mandt)
      await exec([`INSERT INTO zosd_l3_run (mandt, set_name, check_date, run_id, status, started) VALUES ('', 'fleet2', '${DATE}', 'DEAD0000000000000000000000000001', 'HELD', ${stamp()})`]);
      expect((await runSet()).status).to.equal("BUSY");
      tick(899);
      expect(actions(await doctor())).to.deep.equal([]);
      tick(1);
      expect(actions(await doctor())).to.deep.equal(["RELEASE NO-PLAN"]);
      expect(audit("DEAD0000000000000000000000000001")).to.deep.equal(["RELEASE NO-PLAN"]);
      const next = await runSet();
      expect(next.status).to.equal("DONE");
      expect(lockRow()).to.deep.equal({run: next.run, status: "RELEASED"});
    });

    // a run in jobs whose jobs have not run, its lock older than stale
    async function openLockProblems() {
      const problems = [];
      const run = (await runSet({mode: "P"})).run;
      tick(901);
      const pass = actions(await doctor());
      if (pass.length) problems.push(`the doctor acted: ${JSON.stringify(pass)}`);
      if (lockRow().status !== "HELD") problems.push(`the lock is ${lockRow().status} while the run's jobs are open`);
      await drainAndWork();
      if (JSON.stringify(lockRow()) !== JSON.stringify({run, status: "RELEASED"})) problems.push("the jobs did not complete the run");
      return {problems};
    }

    it("a stale lock whose run still has open jobs is left alone", async () => {
      expect((await openLockProblems()).problems).to.deep.equal([]);
    });

    it("mutant: a stale lock released while its piles' jobs are still open", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_lock", mutate("        IF lv_final = abap_false.\n          CONTINUE.\n        ENDIF.\n", ""), () => openLockProblems());
      expect(problems.join("\n")).to.match(/the lock is RELEASED while the run's jobs are open/);
    });

    // ---- gates ------------------------------------------------------------------
    it("a pile job that dumps after its commit, before the gate: the doctor advances the stage", async () => {
      const want = await expected();
      const real = cls(RUNNER).advance;
      let left = 2;
      cls(RUNNER).advance = async function (...args) {
        if (left > 0) { left--; throw new Error("advance dumps (a test fault)"); }
        return real.apply(this, args);
      };
      let run;
      try {
        run = (await runSet({mode: "P"})).run;
        await drainAndWork();
      } finally { cls(RUNNER).advance = real; }
      expect(plan(run, 1).map((p) => p.status)).to.deep.equal(["DONE", "DONE"]);
      expect(gates(run)).to.deep.equal(["OPEN", "WAITING"]);
      expect(actions(await doctor())).to.deep.equal(["ADVANCE STAGE-DONE stage 1"]);
      await drainAndWork();
      expect(gates(run)).to.deep.equal(["DONE", "DONE"]);
      expect(lockRow()).to.deep.equal({run, status: "RELEASED"});
      expect(content(log())).to.deep.equal(want);
    });

    it("an OPEN gate with no piles (the gate's crash window): planned again once stale, and the run completes", async () => {
      const want = await expected();
      const run = (await runSet({mode: "P"})).run;
      await drainAndWork(2);
      // stage 1 is done; as if a system had committed stage 2's gate and lost its piles
      await drainAndWork();
      await exec([`UPDATE zosd_l3_run SET status = 'HELD' WHERE run_id = '${run}'`,
        `DELETE FROM zosd_l3_pile WHERE run_id = '${run}' AND stage_no = 2`, `DELETE FROM zosd_l3_alert WHERE run_id = '${run}'`,
        `UPDATE zosd_l3_stage SET status = 'OPEN', opened = ${stamp()} WHERE run_id = '${run}' AND stage_no = 2`]);
      tick(899);
      expect(actions(await doctor())).to.deep.equal([]);
      tick(1);
      expect(actions(await doctor())).to.deep.equal(["REPLAN OPEN-NO-PILES stage 2"]);
      expect(plan(run, 2).length).to.equal(checks.length);
      await drainAndWork();
      expect(gates(run)).to.deep.equal(["DONE", "DONE"]);
      expect(lockRow()).to.deep.equal({run, status: "RELEASED"});
      expect(content(log())).to.deep.equal(want);
    });

    // ---- a job that comes late: its pile is no longer PLANNED ------------------------
    // On a system with several background work processes a job can start before
    // the step that submitted it commits (A4H, slice 5a run 2): it read the pile as
    // it was before the doctor's claim, worked it and wrote that stale copy back, so
    // collect( ) found a RUNNING pile without a job and made the run PARTIAL. A job
    // works only a pile that is PLANNED, read FOR UPDATE (so it waits for the
    // submitter's commit on a system). Here: the pile of a submitted job is taken
    // as FAILED before the job runs; the job must not work it
    async function latePileProblems() {
      const problems = [];
      const run = (await runSet({mode: "P"})).run;
      await exec([`UPDATE zosd_l3_pile SET status = 'FAILED', reason = 'JOB-GONE' WHERE run_id = '${run}' AND stage_no = 1 AND pile_no = 1`]);
      const outcomes = await drainAndWork(2);
      const [first] = plan(run, 1);
      if (first.status !== "FAILED" || first.reason !== "JOB-GONE") problems.push(`the late job worked the pile: ${JSON.stringify(first)}`);
      if (!outcomes.includes("failed")) problems.push(`the late job ended ${JSON.stringify(outcomes)}, not aborted`);
      if (read("SELECT COUNT(*) AS n FROM zosd_l3_work WHERE run_id = ? AND key_value IN ('S001', 'S002')", run)[0].n) problems.push("the late job filled the worklist");
      return {problems};
    }

    it("a job whose pile is no longer PLANNED (taken as FAILED before it ran) works nothing and aborts", async () => {
      expect((await latePileProblems()).problems).to.deep.equal([]);
    });

    it("mutant: a job that works a pile that is not PLANNED", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_late", mutate("    IF ls_pile-status <> 'PLANNED'.\n      rs_rule-status = 'NOT-PLANNED'.\n",
        "    IF abap_false = abap_true.\n      rs_rule-status = 'NOT-PLANNED'.\n"), () => latePileProblems());
      expect(problems.join("\n")).to.match(/the late job worked the pile/);
    });

    // ---- the kill switch set by another session during the doctor's pass ----------
    // stage 1 done, its gate still OPEN: the job that ended the stage dumped in advance( )
    async function gateLeftOpen() {
      const real = cls(RUNNER).advance;
      let left = 2;
      cls(RUNNER).advance = async function (...args) {
        if (left > 0) { left--; throw new Error("advance dumps (a test fault)"); }
        return real.apply(this, args);
      };
      try {
        const run = (await runSet({mode: "P"})).run;
        await drainAndWork();
        return run;
      } finally { cls(RUNNER).advance = real; }
    }
    const KILL = "INSERT INTO zosd_l3_kill (mandt, set_name, reason) VALUES ('', 'fleet2', 'another session stops the set')";
    // a stale run whose gate the doctor would advance; the switch is set in the
    // doctor's own step, `at` "check": right after its first killed( ), or
    // "advance": between its ADVANCE (OPEN to DONE) and advance( ). Then the
    // switch goes and a second pass and the jobs must complete the run
    async function killRaceProblems(at) {
      const problems = [];
      const want = await expected();
      const run = await gateLeftOpen();
      tick(901);
      const key = at === "advance" ? "advance" : "killed";
      const real = cls(RUNNER)[key];
      let armed = true;
      cls(RUNNER)[key] = async function (...args) {
        if (!armed) return real.apply(this, args);
        armed = false;
        if (at === "advance") { await client.execute(KILL); return real.apply(this, args); }
        const answer = await real.apply(this, args);
        await client.execute(KILL);
        return answer;
      };
      let pass;
      try { pass = actions(await doctor()); } finally { cls(RUNNER)[key] = real; }
      const between = gates(run);
      if (lockRow().status !== "HELD") problems.push(`the lock is ${lockRow().status} after a pass that could not advance`);
      if (at === "check" && (pass.length || JSON.stringify(between) !== JSON.stringify(["OPEN", "WAITING"]))) {
        problems.push(`the switch set before the ADVANCE: ${JSON.stringify(pass)}, gates ${JSON.stringify(between)}`);
      }
      await exec(["DELETE FROM zosd_l3_kill"]);
      const healed = actions(await doctor());
      await drainAndWork();
      if (JSON.stringify(gates(run)) !== JSON.stringify(["DONE", "DONE"]) || lockRow().status !== "RELEASED") {
        problems.push(`once the switch is gone: ${JSON.stringify(healed)}, gates ${JSON.stringify(gates(run))}, lock ${lockRow().status}`);
      }
      if (JSON.stringify(content(log())) !== JSON.stringify(want)) problems.push("the log is not a clean run's");
      return {problems, pass, between, healed};
    }

    it("the kill switch set before the doctor's ADVANCE: the gate stays OPEN and the lock HELD; once it is gone the run completes", async () => {
      const {problems, healed} = await killRaceProblems("check");
      expect(problems).to.deep.equal([]);
      expect(healed).to.deep.equal(["ADVANCE STAGE-DONE stage 1"]);
    });

    it("the kill switch set between the ADVANCE and advance( ): stage 1 DONE, stage 2 WAITING, the lock HELD; once it is gone the doctor opens stage 2", async () => {
      const {problems, pass, between, healed} = await killRaceProblems("advance");
      expect(problems).to.deep.equal([]);
      expect([pass, between]).to.deep.equal([["ADVANCE STAGE-DONE stage 1"], ["DONE", "WAITING"]]);
      expect(healed).to.deep.equal(["ADVANCE NEXT-WAITING stage 1"]);
    });

    it("mutant: the doctor's ADVANCE without its kill check: the stage goes DONE with the next gate shut", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_advkill", mutate("        IF killed( ) = abap_true.\n          CONTINUE.\n        ENDIF.\n        UPDATE zosd_l3_stage SET status = 'DONE'",
        "        UPDATE zosd_l3_stage SET status = 'DONE'"), () => killRaceProblems("check"));
      expect(problems.join("\n")).to.match(/the switch set before the ADVANCE: \["ADVANCE STAGE-DONE stage 1"\], gates \["DONE","WAITING"\]/);
    });

    it("mutant: the release ignoring an OPEN gate that could still advance: the lock goes while the gate cannot", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_relopen", mutate("          IF lv_open = 0.\n            lv_final = abap_false.\n          ENDIF.\n", ""),
        () => killRaceProblems("check"));
      expect(problems.join("\n")).to.match(/the lock is RELEASED after a pass that could not advance/);
    });

    it("mutant: the release ignoring a WAITING gate after a DONE one: the lock goes with stage 2 never opened", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_relwait", mutate("          IF sy-subrc = 0 AND ls_prev-status = 'DONE'.\n            lv_final = abap_false.\n          ENDIF.\n",
        "          IF sy-subrc = 0 AND ls_prev-status = 'DONE'.\n          ENDIF.\n"), () => killRaceProblems("advance"));
      expect(problems.join("\n")).to.match(/the lock is RELEASED after a pass that could not advance/);
    });

    // ---- the fuse ---------------------------------------------------------------
    // a copy of the runner whose c_max_alerts is `limit`: a complete run of the real
    // runner first, then the copy's run; what is wrong, as a list
    async function fuseProblems({limit, label = "f", edit = (t) => t}) {
      const problems = [];
      // S003 gets a voyage ahead: three busy ships, two piles of stage 2, and
      // ship-min-crew alerts in both (S002 in pile 1, S003 in pile 2)
      await exec(["INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123', 'V00099', 'S003', '20261020')"]);
      try { return await fuseRuns({limit, label, edit, problems}); } finally {
        await exec(["DELETE FROM zosd_l2_voy WHERE voyage_id = 'V00099'"]);
      }
    }
    async function fuseRuns({limit, label, edit, problems}) {
      const first = await runSet();
      const name = `zcl_l3_fleet2_${label}${limit}`;
      await loadClass(RUNNER, name, (text) => edit(mutate("CONSTANTS c_max_alerts TYPE i VALUE 500.", `CONSTANTS c_max_alerts TYPE i VALUE ${limit}.`)(text)));
      const before = log();
      const counts = {};
      for (const r of before) counts[r.rule] = (counts[r.rule] ?? 0) + 1;
      const [big] = Object.entries(counts).filter(([, n]) => n > limit).map(([rule]) => rule);
      if (!big) problems.push(`no rule writes more than ${limit} alerts: ${JSON.stringify(counts)}`);
      await dialogStep(() => cls().set_setting({iv_param: str("fuses.max_alerts"), iv_value: str(String(limit)), iv_note: str("resilience test")}));
      const second = await runSet({className: name});
      const rule = second.rules.find((r) => r.rule === big);
      if (rule?.status !== "FUSED") problems.push(`rule ${big} is ${rule?.status}`);
      const mine = log().filter((r) => r.rule === big && r.run === second.run);
      if (mine.length > limit) problems.push(`rule ${big} wrote ${mine.length} rows in the run, past ${limit}`);
      // the fused pile wrote nothing: its group holds the first run's rows, as they were
      const fused = plan(second.run, 2).filter((p) => p.rule === big && p.status === "FUSED").map((p) => p.pile);
      if (!fused.length) problems.push(`no pile of ${big} is FUSED: ${JSON.stringify(plan(second.run, 2).filter((p) => p.rule === big))}`);
      const kept = (rows) => JSON.stringify(rows.filter((r) => r.rule === big && fused.includes(r.pile)).map((r) => [r.pile, r.text, r.run]));
      if (kept(log()) !== kept(before)) problems.push(`the older rows of the fused pile(s) ${JSON.stringify(fused)}: ${kept(log())}, were ${kept(before)}`);
      if (!before.some((r) => r.rule === big && fused.includes(r.pile))) problems.push("the fused pile had no older row to keep");
      const others = second.rules.filter((r) => r.rule !== big && r.rule !== "ship-busy");
      if (others.some((r) => r.status !== "DONE")) problems.push(`the other rules: ${JSON.stringify(others.map((r) => r.status))}`);
      if (second.stages[1]?.status !== "PARTIAL") problems.push(`stage 2 is ${second.stages[1]?.status}`);
      return {problems, big};
    }

    it("max_alerts: the rule is FUSED, nothing past the limit is written, and the older rows are kept", async () => {
      const {problems, big} = await fuseProblems({limit: 1});
      expect(problems).to.deep.equal([]);
      expect(big).to.be.a("string");
    });

    it("mutant: a fuse that keeps writing", async () => {
      const {problems} = await fuseProblems({limit: 1, label: "m_fuse", edit: mutate("    IF lv_total > gs_settings-vals-fuses_max_alerts.\n", "    IF lv_total < 0.\n")});
      expect(problems.join("\n")).to.match(/wrote \d+ rows in the run, past 1/);
    });

    it("settings mutant: re-reading at each fuse use changes one run midway", async () => {
      await exec(["INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123', 'V00099', 'S003', '20261020')"]);
      const name = "zcl_l3_fleet2_m_refresh";
      await loadClass(RUNNER, name, mutate("    IF lv_total > gs_settings-vals-fuses_max_alerts.\n",
        "    gs_settings = zcl_l3_fleet2_conf=>load( ).\n    IF lv_total > gs_settings-vals-fuses_max_alerts.\n"));
      const source = abap.Classes.ZCL_L2_SHIP_BUSY;
      const old = source.keys;
      let changed = false;
      source.keys = async function (...args) {
        if (!changed) {
          changed = true;
          await client.execute("UPDATE zosd_l3_conf SET param_val = '1', origin = 'USER' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'");
        }
        return old.apply(this, args);
      };
      let result;
      try { result = await runSet({className: name}); } finally {
        source.keys = old;
        await exec(["DELETE FROM zosd_l2_voy WHERE voyage_id = 'V00099'"]);
      }
      expect(changed).to.equal(true);
      expect(result.rules.some((r) => r.status === "FUSED"), "the mutant used the mid-run edit").to.equal(true);
      expect(trim(read("SELECT param_val FROM zosd_l3_run_conf WHERE run_id = ? AND param_name = 'fuses.max_alerts'", result.run)[0].param_val)).to.equal("500");
    });

    // ---- the kill switch --------------------------------------------------------
    async function killProblems() {
      const problems = [];
      const want = await expected();
      const run = (await runSet({mode: "P"})).run;
      await exec(["INSERT INTO zosd_l3_kill (mandt, set_name, reason) VALUES ('', 'fleet2', 'a test stops the set')"]);
      const outcomes = await drainAndWork();
      if (outcomes.some((o) => o !== "completed")) problems.push(`the killed jobs ended ${JSON.stringify(outcomes)}, not completed`);
      const piles = plan(run, 1);
      if (piles.some((p) => p.status !== "PLANNED" || p.job || p.attempt !== 0)) problems.push(`stage 1 while killed: ${JSON.stringify(piles)}`);
      if (JSON.stringify(gates(run)) !== JSON.stringify(["OPEN", "WAITING"])) problems.push(`gates while killed: ${JSON.stringify(gates(run))}`);
      const other = await runSet({day: "20261002"});
      if (other.status !== "KILLED") problems.push(`a run while killed is ${other.status}`);
      tick(901);
      const pass = actions(await doctor());
      if (JSON.stringify(pass) !== JSON.stringify(["KILLED the kill switch is set"])) problems.push(`the doctor while killed: ${JSON.stringify(pass)}`);
      if (JSON.stringify(plan(run, 1)) !== JSON.stringify(piles) || audit(run).length) problems.push("the doctor changed something while killed");
      await exec(["DELETE FROM zosd_l3_kill"]);
      const resumed = actions(await resume(run));
      if (JSON.stringify(resumed) !== JSON.stringify(["RESUBMIT STALE-PLAN ship-busy 1", "RESUBMIT STALE-PLAN ship-busy 2"])) problems.push(`resume( ): ${JSON.stringify(resumed)}`);
      await drainAndWork();
      if (JSON.stringify(gates(run)) !== JSON.stringify(["DONE", "DONE"])) problems.push(`gates after resume: ${JSON.stringify(gates(run))}`);
      if (JSON.stringify(content(log())) !== JSON.stringify(want)) problems.push("the log after resume is not a clean run's");
      return {problems};
    }

    it("the kill switch stops new piles and gates (the jobs end, their piles go back to PLANNED), and resume( ) continues once the row is gone", async () => {
      expect((await killProblems()).problems).to.deep.equal([]);
    });

    it("mutant: the kill switch ignored by a pile job", async () => {
      const {problems} = await mutant("zcl_l3_fleet2_m_kill", mutate("    IF killed( ) = abap_true.\n      ls_pile-status = 'PLANNED'.\n", "    IF abap_false = abap_true.\n      ls_pile-status = 'PLANNED'.\n"),
        () => killProblems());
      expect(problems.join("\n")).to.match(/stage 1 while killed: .*"status":"DONE"/);
    });

    // ---- the dry run ------------------------------------------------------------
    async function dryProblems(className = RUNNER) {
      const problems = [];
      const empty = await runSet({className, dry: true});
      if (empty.status !== "DRY") problems.push(`a dry run is ${empty.status}`);
      if (log().length) problems.push(`a dry run wrote ${log().length} rows to the log`);
      const real = await runSet();
      const written = log();
      const dry = await runSet({className, dry: true});
      if (JSON.stringify(log()) !== JSON.stringify(written)) problems.push("a dry run changed the log of the real run (it wrote or finalised)");
      if (JSON.stringify(content(dry.dry)) !== JSON.stringify(content(written))) problems.push(`the dry run's report ${JSON.stringify(content(dry.dry))} is not what the real run wrote`);
      if (dry.rules.some((r) => r.status !== "DRY")) problems.push(`rules ${JSON.stringify(dry.rules.map((r) => r.status))}`);
      if (real.status !== "DONE") problems.push(`the real run is ${real.status}`);
      return {problems};
    }

    it("a dry run writes nothing and finalises nothing, and its report holds what a real run writes; every row says DRY", async () => {
      expect((await dryProblems()).problems).to.deep.equal([]);
    });

    it("mutant: a dry run that writes to the log", async () => {
      await loadClass(RUNNER, "zcl_l3_fleet2_m_dry", mutate("    CONCATENATE iv_bind ',alerts=capture' INTO lv_bind.\n", "    lv_bind = iv_bind.\n"));
      const {problems} = await dryProblems("zcl_l3_fleet2_m_dry");
      expect(problems.join("\n")).to.match(/a dry run wrote \d+ rows to the log/);
    });

    // ---- retention ----------------------------------------------------------------
    async function purgeProblems(className = RUNNER) {
      const problems = [];
      const old = await runSet({day: "20260901"});
      const open = await runSet({mode: "P"});
      const rowsOf = (run) => ({piles: read("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE run_id = ?", run)[0].n,
        gates: read("SELECT COUNT(*) AS n FROM zosd_l3_stage WHERE run_id = ?", run)[0].n,
        work: read("SELECT COUNT(*) AS n FROM zosd_l3_work WHERE run_id = ?", run)[0].n});
      const alerts = log().length;
      const openBefore = rowsOf(open.run);
      tick(29 * 86400);
      if ((await purge(className)).length) problems.push("purge( ) before keep.days acted");
      tick(2 * 86400);
      const purged = actions(await purge(className));
      if (!purged.includes("PURGE a final run past c_keep_days")) problems.push(`purge( ): ${JSON.stringify(purged)}`);
      if (JSON.stringify(rowsOf(old.run)) !== JSON.stringify({piles: 0, gates: 0, work: 0})) problems.push(`the old final run kept ${JSON.stringify(rowsOf(old.run))}`);
      if (JSON.stringify(rowsOf(open.run)) !== JSON.stringify(openBefore)) problems.push(`the open run's rows: ${JSON.stringify(rowsOf(open.run))}, were ${JSON.stringify(openBefore)}`);
      if (log().length !== alerts || !alerts) problems.push(`the log has ${log().length} rows, had ${alerts}`);
      if (lockRow("20260901") !== undefined) problems.push("the old date's released lock is kept");
      if (lockRow()?.status !== "HELD") problems.push("the open run's lock is gone");
      return {problems};
    }

    it("purge( ) keeps open runs and the alert log, and removes old final runs' plan, worklist and gate rows and their lock", async () => {
      expect((await purgeProblems()).problems).to.deep.equal([]);
    });

    it("mutant: purge( ) touching an open run", async () => {
      await loadClass(RUNNER, "zcl_l3_fleet2_m_purge_open", mutate("      IF ls_lock-run_id = ls_run-run_id AND ls_lock-status = 'HELD'.\n", "      IF abap_false = abap_true.\n"));
      const {problems} = await purgeProblems("zcl_l3_fleet2_m_purge_open");
      expect(problems.join("\n")).to.match(/the open run's rows: \{"piles":0/);
    });

    it("mutant: purge( ) deleting alerts", async () => {
      await loadClass(RUNNER, "zcl_l3_fleet2_m_purge_log", mutate("      DELETE FROM zosd_l3_work WHERE run_id = ls_run-run_id.\n",
        "      DELETE FROM zosd_l3_work WHERE run_id = ls_run-run_id.\n      DELETE FROM zosd_l3_alert WHERE run_id = ls_run-run_id.\n"));
      const {problems} = await purgeProblems("zcl_l3_fleet2_m_purge_log");
      expect(problems.join("\n")).to.match(/the log has \d+ rows, had \d+/);
    });

    // ---- the doctor's schedule ----------------------------------------------------
    it("schedule( ) schedules the doctor too, every 15 minutes; unschedule( ) removes both jobs", async () => {
      const scheduler = new JobScheduler({root, store, env: process.env, clock});
      const jobs = (name) => store.db.prepare("SELECT state, prd_mins, started_at FROM batch_runs WHERE job_name = ? ORDER BY rowid").all(name)
        .map((r) => ({state: r.state, mins: String(r.prd_mins ?? "").trim(), started: Boolean(r.started_at)}));
      store.db.prepare("DELETE FROM batch_runs WHERE job_name IN ('L3_FLEET2_D', 'L3_FLEET2_DOC')").run();
      const call = (method) => dialogStep(async () => (await cls()[method]()).get());
      try {
        expect(String(await call("schedule")).trim()).to.not.equal("");
        expect(String(await call("schedule")).trim(), "a second call opens no second chain").to.not.equal("");
        await scheduler.tick();
        expect(jobs("L3_FLEET2_DOC").filter((j) => j.state === "WAITING").length).to.equal(1);
        expect(jobs("L3_FLEET2_DOC")[0].mins).to.match(/^0*15$/);
        await clock.advance(15 * 60 * 1000 + 1000);
        for (let i = 0; i < 4; i++) await scheduler.tick();
        expect(jobs("L3_FLEET2_DOC").filter((j) => j.started).length, "the doctor ran as its job").to.be.greaterThan(0);
        expect(await call("unschedule")).to.equal(2);
        const started = jobs("L3_FLEET2_DOC").filter((j) => j.started).length;
        await clock.advance(86400 * 1000);
        for (let i = 0; i < 4; i++) await scheduler.tick();
        expect(jobs("L3_FLEET2_DOC").filter((j) => j.started).length, "nothing runs after unschedule").to.equal(started);
        expect(jobs("L3_FLEET2_D").filter((j) => j.state === "WAITING")).to.deep.equal([]);
      } finally { scheduler.stop(); }
    });

    it("schedule( ) replaces a waiting doctor job when its tuned period changes", async () => {
      const waiting = () => store.db.prepare("SELECT id, job_count, prd_mins FROM batch_runs WHERE job_name = 'L3_FLEET2_DOC' AND state = 'WAITING'").all();
      store.db.prepare("DELETE FROM batch_runs WHERE job_name IN ('L3_FLEET2_D', 'L3_FLEET2_DOC')").run();
      const call = () => dialogStep(async () => (await cls().schedule()).get());
      await call();
      await drainJobOutbox(store);
      const original = waiting();
      expect(original).to.have.length(1);
      expect(Number(original[0].prd_mins)).to.equal(15);
      const tuned = await dialogStep(() => cls().set_setting({iv_param: str("stale"), iv_value: str("1200"), iv_note: str("doctor period")}));
      expect(trim(tuned.get())).to.equal("X");
      await call();
      await drainJobOutbox(store);
      const changed = waiting();
      expect(changed).to.have.length(1);
      // a new job, not the old one retimed: compare the run, not the count. A
      // system hands a deleted top count out again in the same second (A4H,
      // ANOMALY-2026-10-02-jobcount-unique-per-name), so the count may repeat
      expect(changed[0].id).to.not.equal(original[0].id);
      expect(store.db.prepare("SELECT state FROM batch_runs WHERE id = ?").get(original[0].id).state).to.equal("DELETED");
      expect(Number(changed[0].prd_mins)).to.equal(20);
      await dialogStep(() => cls().unschedule());
    });
  });
});
