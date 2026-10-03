// DSL L3 with a range set parameter (docs/dsl-l3.md, "Range set parameters"; the
// L2 side is test/dsl-l2.mjs, "slice 8"). A set parameter of `range: true` is a
// selection table: the runner holds it in ty_params, gives an initial one its
// default (the set's rows, or the operator's list when it is tunable), hands it to
// the rules that declare it, submits it to the job as a SELECT-OPTIONS, and an
// operator tunes it as a list of values ("M,D"). The manifest's refusals at
// their lines, the generated text, and the runs on a file database: mode S, mode
// P (the table through the job's selection field), the setting's round trip.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, sep} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, renderSet, SetError} from "../tools/dsl-l3.mjs";
import {jobInput} from "../tools/osd-job-input.mjs";

const SET = "src/l2demo/fleet3.l3.yaml";
const OUT = "src/l2demo";
const DATE = "20261001";
const SET_TEXT = readFileSync(SET, "utf8");
const RULE = "ship-restricted-status-no-voyage";
const trim = (v) => typeof v === "string" ? v.trim() : v;

// S001 in maintenance (M) with a voyage ahead, S002 active with one, S003
// decommissioned (D) with one, S004 active with only a past voyage, S901 in maintenance
// with one and exempt by default (S900 to S999). The captains are aboard, so only the
// restricted-status rule alerts.
const FLEET = {
  zosd_l2_ship: [["S001", "Albatross", "M"], ["S002", "Bluebird", "A"], ["S003", "Condor", "D"], ["S004", "Dove", "A"], ["S901", "Skiff", "M"]],
  zosd_l2_voy: [["V00001", "S001", "20261005"], ["V00002", "S002", "20261010"], ["V00003", "S003", "20261006"], ["V00004", "S004", "20260901"], ["V00005", "S901", "20261007"]],
  zosd_l2_crew: [["C00001", "S002", "C", "20260101"], ["C00002", "S004", "C", "20260101"]],
  zosd_l2_cargo: [],
};
const COLUMNS = {zosd_l2_ship: ["ship_id", "name", "status"], zosd_l2_voy: ["voyage_id", "ship_id", "dep_date"],
  zosd_l2_crew: ["crew_id", "ship_id", "role", "since"], zosd_l2_cargo: ["cargo_id", "ship_id", "weight"]};
const TABLES = ["zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_conf", "zosd_l3_conf_log", "zosd_l3_run_conf"];

describe("DSL L3: a range set parameter", function () {
  this.timeout(900000);
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), "dsl-l3-range-")); });
  after(() => rmSync(scratch, {recursive: true, force: true}));

  describe("the manifest and the generated text", () => {
    let n = 0;
    // a copy of the manifest in a folder of its own, its rules named by path, edits applied
    const manifest = (...edits) => {
      const dir = join(scratch, `m-${n++}`);
      mkdirSync(dir);
      let text = SET_TEXT;
      for (const [from, to] of edits) {
        expect(text, `the set has ${JSON.stringify(from)}`).to.include(from);
        text = text.replace(from, to);
      }
      text = text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => `rule: ${relative(dir, join(process.cwd(), OUT, f)).split(sep).join("/")}`);
      const file = join(dir, "fleet3.l3.yaml");
      writeFileSync(file, text);
      return file;
    };
    const refusedAt = (file, message, at) => {
      const where = relative(process.cwd(), file).split(sep).join("/");
      const line = readFileSync(file, "utf8").split("\n").findIndex((l) => at.test(l)) + 1;
      expect(line, `a line matching ${at}`).to.be.greaterThan(0);
      let error;
      try { compileSet(file); } catch (e) { error = e; }
      expect(error, "an error").to.be.instanceOf(SetError);
      expect(error.message.startsWith(`${where}:${line}: `), error.message).to.equal(true);
      expect(error.message.slice(`${where}:${line}: `.length)).to.match(message);
    };
    const RANGE = "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [M, D]}\n";
    const AT = /^  restricted:/;

    it("compiles: a range and a scalar parameter side by side, the range with its rows, its selection field and its tunable list", () => {
      const model = compileSet(SET);
      expect(model.params.map((p) => [p.name, p.screen, p.is_selopt === true])).to.deep.equal([["active_status", "p_active", false], ["restricted", "s_restri", true], ["exempt", "s_exempt", true]]);
      const restricted = model.params[1];
      expect(model.params[2].default_rows.map((r) => [r.sign, r.option, r.low, r.high])).to.deep.equal([["I", "BT", "S900", "S999"]]);
      expect(model.params[2], "a BT default is not the operator's").to.not.have.property("tunable");
      expect(restricted.default_rows.map((r) => [r.sign, r.option, r.low])).to.deep.equal([["I", "EQ", "M"], ["I", "EQ", "D"]]);
      expect(restricted).to.include({sel: "gv_s_restricted", has_default: true, tunable: true});
      for (const row of restricted.default_rows) expect(row.set_line).to.equal(SET_TEXT.split("\n").findIndex((l) => AT.test(l)) + 1);
      expect(model.rules.map((r) => [r.name, (r.param_args ?? []).map((a) => a.ref)])).to.deep.equal([["ship-in-service-has-a-captain", ["iv_active_status"]], [RULE, ["iv_restricted", "iv_exempt"]]]);
      expect(model.settings.entries.map((e) => [e.name, e.default, e.list === true, e.scoped])).to.deep.equal([["params.restricted", "M,D", true, true]]);
      expect(model.settings.entries[0].list_regex).to.equal("^([^, ]{1,1}(,[^, ]{1,1})*)?$");
    });

    it("the committed files are a fresh build, and the sets that were there before are byte-identical to what they were", async () => {
      expect(await checkSet(SET, OUT)).to.deep.equal([]);
      expect(await checkSet("src/l2demo/fleet.l3.yaml", OUT)).to.deep.equal([]);
      expect(await checkSet("src/l2demo/fleet2.l3.yaml", OUT)).to.deep.equal([]);
    });

    it("the runner holds the table in ty_params, defaults it, and submits it with IN; the job reads it from a SELECT-OPTIONS", () => {
      const runner = readFileSync(join(OUT, "zcl_l3_fleet3.clas.abap"), "utf8");
      const job = readFileSync(join(OUT, "zl3_fleet3.prog.abap"), "utf8");
      const conf = readFileSync(join(OUT, "zcl_l3_fleet3_conf.clas.abap"), "utf8");
      expect(runner).to.include("    TYPES tt_p_restricted TYPE RANGE OF zosd_l2_ship-status.\n");
      expect(runner).to.include("             restricted TYPE tt_p_restricted,\n");
      expect(runner).to.include("      ls_params-restricted = zcl_l3_fleet3_conf=>range_restricted( gs_settings-vals-params_restricted ).\n");
      expect(runner).to.include("      WITH s_restri IN is_params-restricted\n");
      expect(runner).to.include("{ref}".replace("{ref}", "iv_restricted = ls_params-restricted"));
      expect(job).to.include("DATA gv_s_restricted TYPE zosd_l2_ship-status.\nSELECT-OPTIONS s_restri FOR gv_s_restricted.\n");
      expect(job).to.include("  ls_params-restricted = s_restri[].\n");
      expect(job, "a scalar parameter is still a PARAMETERS").to.include("PARAMETERS p_active TYPE zosd_l2_ship-status.\n");
      expect(runner).to.include("      ls_params-exempt = def_exempt( ).\n");
      expect(runner).to.include("      WITH s_exempt IN is_params-exempt\n");
      expect(runner).to.include("    ls_row-option = 'BT'.\n    ls_row-low = 'S900'.\n    ls_row-high = 'S999'.\n");
      expect(job).to.include("SELECT-OPTIONS s_exempt FOR gv_s_exempt.\n");
      expect(conf, "the BT range is not a setting").to.not.include("params.exempt");
      expect(conf).to.include("    TYPES tt_p_restricted TYPE RANGE OF zosd_l2_ship-status.\n");
      expect(conf).to.include("    rs_vals-params_restricted = 'M,D'.\n");
      expect(conf).to.include("FIND REGEX `^([^, ]{1,1}(,[^, ]{1,1})*)?$` IN lv_text.");
    });

    it("without settings the default rows are a method of the runner, def_<name>, never a list the caller must give", () => {
      const file = manifest(["settings:\n  tunable: [params.restricted]\n", ""]);
      const model = compileSet(file);
      expect(model.settings).to.equal(undefined);
      return renderSet(model).then(({files}) => {
        const runner = files["zcl_l3_fleet3.clas.abap"];
        expect(runner).to.include("    CLASS-METHODS def_restricted RETURNING VALUE(rt_range) TYPE tt_p_restricted.\n");
        expect(runner).to.include("      ls_params-restricted = def_restricted( ).\n");
        expect(runner).to.include("    ls_row-low = 'D'.\n");
      });
    });

    it("refuses, at its line, a range the rules do not declare as one, and the other way round", () => {
      refusedAt(manifest(["  active_status: {type: ZOSD_L2_SHIP-STATUS, default: A}\n", "  active_status: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [A]}\n"]),
        /^set parameter active_status is a range \(range: true\); rule ship-in-service-has-a-captain declares \$active_status as a scalar/, /^  active_status:/);
      refusedAt(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, default: M}\n"], ["settings:\n  tunable: [params.restricted]\n", ""]),
        /^set parameter restricted is a scalar; rule ship-restricted-status-no-voyage declares \$restricted as a range/, AT);
    });

    it("refuses a range without a default over a rule that has one, a default of more than 20 rows and a default that is not a list", () => {
      refusedAt(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true}\n"], ["settings:\n  tunable: [params.restricted]\n", ""]),
        /^set parameter restricted is a range with no default, and rule ship-restricted-status-no-voyage has one for \$restricted/, AT);
      const letters = "ABCDEFGHIJKLMNOPQRSTU".split("").join(", ");
      refusedAt(manifest([RANGE, `  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [${letters}]}\n`], ["settings:\n  tunable: [params.restricted]\n", ""]),
        /^the default of set parameter restricted has 21 rows; a job carries up to 20 rows per selection field/, AT);
      refusedAt(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: M}\n"]), /must be a list of rows/, AT);
      refusedAt(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [MM]}\n"]),
        /^range low must fit ZOSD_L2_SHIP-STATUS: 'MM' is 2 characters, longer than CHAR 1/, AT);
      refusedAt(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [{sign: I, option: CP, low: M}]}\n"]),
        /^unknown option "CP" \(EQ or BT\)/, AT);
      refusedAt(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: maybe, default: [M]}\n"]), /^range is true or false, not "maybe"/, /^  restricted:.*range: maybe/);
      refusedAt(manifest([RANGE, `  ${"r".repeat(25)}: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [M]}\n`]),
        /^range set parameter r{25} is at most 24 characters/, new RegExp(`^  ${"r".repeat(25)}:`));
    });

    it("a tunable list must round-trip: a default with the separator or a blank value is refused in words, at the manifest line", () => {
      const EX = "  exempt: {type: ZOSD_L2_SHIP-SHIP_ID, range: true, default: [{sign: I, option: BT, low: S900, high: S999}]}\n";
      for (const value of ["\"A,B\"", "\"\"", "\"A B\""]) {
        refusedAt(manifest([EX, `  exempt: {type: ZOSD_L2_SHIP-SHIP_ID, range: true, default: [${value}]}\n`], ["tunable: [params.restricted]", "tunable: [params.restricted, params.exempt]"]),
          /^the default of exempt holds .*which a list of values cannot carry/, /^  tunable:/);
      }
      // the same defaults are fine as the API's rows when not tunable
      expect(() => compileSet(manifest([EX, "  exempt: {type: ZOSD_L2_SHIP-SHIP_ID, range: true, default: [\"A,B\"]}\n"]))).to.not.throw();
    });

    it("a default with a BT or an E row stays the manifest's: the operator tunes a list of values only", () => {
      for (const [tag, rows] of [["bt", "[{sign: I, option: BT, low: A, high: D}]"], ["e", "[M, {sign: E, option: EQ, low: D}]"]]) {
        refusedAt(manifest([RANGE, `  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: ${rows}}\n`]),
          /^unknown or unavailable tunable "params\.restricted"; available: /, new RegExp(`^  tunable: \\[params\\.restricted\\]`));
        expect(tag).to.be.a("string");
      }
      // the demo's own BT range is no setting either
      refusedAt(manifest(["tunable: [params.restricted]", "tunable: [params.restricted, params.exempt]"]), /^unknown or unavailable tunable "params\.exempt"; available: piles\.size, params\.active_status, params\.restricted$/, /^  tunable:/);
      // without the setting the same defaults are accepted: they are the API's full rows
      const model = compileSet(manifest([RANGE, "  restricted: {type: ZOSD_L2_SHIP-STATUS, range: true, default: [{sign: I, option: BT, low: A, high: D}, {sign: E, option: EQ, low: B}]}\n"],
        ["settings:\n  tunable: [params.restricted]\n", ""]));
      expect(model.params[1].default_rows.map((r) => [r.sign, r.option, r.low, r.high])).to.deep.equal([["I", "BT", "A", "D"], ["E", "EQ", "B", undefined]]);
    });
  });

  describe("the job input check", () => {
    const row = (ranges) => [{name: "S_X", value: "", ranges}];
    it("takes the facade's empty IN (one row of sign #, its option blank or trimmed), and nothing else with that sign", () => {
      expect(jobInput(row([{sign: "#", option: "", low: "", high: ""}]))).to.deep.equal(row([{sign: "#", option: "  ", low: "", high: ""}]));
      expect(jobInput(row([{sign: "#", option: "  ", low: "", high: ""}]))[0].ranges).to.have.length(1);
      for (const bad of [[{sign: "#", option: "", low: "", high: ""}, {sign: "I", option: "EQ", low: "A", high: ""}],
        [{sign: "#", option: "EQ", low: "", high: ""}], [{sign: "#", option: "", low: "A", high: ""}], [{sign: "#", option: "", low: "", high: "B"}]]) {
        expect(() => jobInput(row(bad)), JSON.stringify(bad)).to.throw(/Invalid job input range/);
      }
      for (const odd of [{option: "\t"}, {option: "\n"}, {option: " ".repeat(300)}, {low: " "}, {high: "\t"}, {option: " "}]) {
        expect(() => jobInput(row([{sign: "#", option: "", low: "", high: "", ...odd}])), JSON.stringify(odd)).to.throw(/Invalid job input range/);
      }
      expect(jobInput(row([{sign: "#", option: "  ", low: "", high: ""}]))).to.have.length(1);
      expect(jobInput(row([{sign: "E", option: "BT", low: "A", high: "C"}]))[0].ranges).to.deep.equal([{sign: "E", option: "BT", low: "A", high: "C"}]);
    });
  });

  describe("on a file database", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, dialogStep, drainJobOutbox, workQueuedBatch, store, classesBefore;
    const root = process.cwd();
    const model = compileSet(SET);
    const cls = () => abap.Classes.ZCL_L3_FLEET3;
    const conf = () => abap.Classes.ZCL_L3_FLEET3_CONF;
    const date = () => new abap.types.Date().set(DATE);
    const str = (s) => new abap.types.String().set(s);
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    // is_params with a restricted table: rows of [sign, option, low, high]
    const paramsOf = (rows, exempt = []) => {
      const value = cls().ty_params.clone();
      value.get().active_status.set("A");
      for (const [table, list] of [["restricted", rows], ["exempt", exempt]]) {
        for (const [sign, option, low, high] of list) {
          const row = value.get()[table].appendInitial();
          row.get().sign.set(sign);
          row.get().option.set(option);
          row.get().low.set(low);
          if (high) row.get().high.set(high);
        }
      }
      return value;
    };
    const plain = (result) => {
      const r = result.get();
      return {run: r.run_id.get().trim(), alerts: r.alerts.get(), status: r.status.get().trim(),
        rules: r.rules.array().map((x) => ({rule: x.get().rule.get().trim(), status: x.get().status.get().trim(), alerts: x.get().alerts.get()}))};
    };
    const run = (mode, rows, exempt) => dialogStep(() => cls().run({iv_date: date(), iv_mode: new abap.types.Character(1).set(mode),
      ...(rows === undefined ? {} : {is_params: paramsOf(rows, exempt)})})).then((raw) => ({...plain(raw), raw}));
    const log = () => read("SELECT rule_name, alert_text FROM zosd_l3_alert ORDER BY rule_name, alert_text").map((r) => `${trim(r.rule_name)}: ${trim(String(r.alert_text)).slice(0, 4)} ${String(r.alert_text).match(/status (\w)/)?.[1]}`);
    const clear = () => exec(TABLES.map((t) => `DELETE FROM ${t}`));
    const set = (name, value, note = "test tune") => dialogStep(() => cls().set_setting({iv_param: str(name), iv_value: str(value), iv_note: str(note)})).then((x) => trim(x.get()) === "X");
    const reset = (name) => dialogStep(() => cls().reset_setting({iv_param: str(name)})).then((x) => trim(x.get()) === "X");
    const confRow = () => read("SELECT * FROM zosd_l3_conf WHERE set_name = 'fleet3' AND param_name = 'params.restricted'")[0];
    const ships = (list) => list.map((s) => `${RULE}: ${s}`);
    // what the log holds after a run, as rule: ship status
    const DEFAULT = ships(["S001 M", "S003 D"]);

    before(async () => {
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-l3-range-db-"));
      dbPath = join(dir, "business.sqlite");
      envBefore = Object.fromEntries(["STG_DB", "STG_DB_PATH", "OSD_OPERATIONS_DB"].map((name) => [name, process.env[name]]));
      priorAbap = globalThis.abap;
      if (priorAbap?.context) priorContext = {databaseConnections: {...priorAbap.context.databaseConnections},
        RFCDestinations: {...priorAbap.context.RFCDestinations}, osdGeneration: priorAbap.context.osdGeneration};
      process.env.STG_DB = "file";
      process.env.STG_DB_PATH = dbPath;
      process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
      const {initializeABAP} = await import("../output/init.mjs");
      await initializeABAP();
      abap = globalThis.abap;
      classesBefore = {...abap.Classes};
      client = abap.context.databaseConnections.DEFAULT;
      ({dialogStep} = await import("../tools/osd-dialog-step.mjs"));
      ({drainJobOutbox} = await import("../tools/osd-job-outbox.mjs"));
      const batch = await import("../tools/osd-batch-runs.mjs");
      workQueuedBatch = batch.workQueuedBatch;
      store = new batch.BatchRuns(root, process.env);
      const inserts = Object.entries(FLEET).flatMap(([table, data]) => data.map((row) =>
        `INSERT INTO ${table} (mandt, ${COLUMNS[table].join(", ")}) VALUES ('123', ${row.map((v) => `'${v}'`).join(", ")})`));
      await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), ...inserts]);
    });
    beforeEach(() => clear());
    after(async () => {
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

    it("mode S with no table given: the set's default rows reach the rule, and the scalar parameter its own value", async () => {
      const result = await run("S");
      expect(result.rules.map((r) => [r.rule, r.status, r.alerts])).to.deep.equal([["ship-in-service-has-a-captain", "DONE", 0], [RULE, "DONE", 2]]);
      expect(log()).to.deep.equal(DEFAULT);
    });

    it("mode S with a table given: rows of I EQ, I BT and E reach the rule as they are", async () => {
      expect((await run("S", [["I", "EQ", "A"]])).alerts).to.equal(1);
      expect(log()).to.deep.equal(ships(["S002 A"]));
      await clear();
      expect((await run("S", [["I", "BT", "A", "M"]])).alerts).to.equal(3);
      expect(log()).to.deep.equal(ships(["S001 M", "S002 A", "S003 D"]));
      await clear();
      expect((await run("S", [["I", "BT", "A", "M"], ["E", "EQ", "D"]])).alerts).to.equal(2);
      expect(log()).to.deep.equal(ships(["S001 M", "S002 A"]));
    });

    it("an empty table reads as not given, as an initial scalar does: the default stands (a limit of ty_params, stated in the docs)", async () => {
      await run("S", []);
      expect(log()).to.deep.equal(DEFAULT);
    });

    it("a second range with a BT default: exempt by default, and a table of its own replaces it (S901 is checked once S001 is the exempt one)", async () => {
      await run("S", [["I", "EQ", "M"]]);
      expect(log(), "S901 is in maintenance with a voyage ahead and in the default BT row, so exempt").to.deep.equal(ships(["S001 M"]));
      await clear();
      await run("S", [["I", "EQ", "M"]], [["I", "EQ", "S001"]]);
      expect(log()).to.deep.equal(ships(["S901 M"]));
      await clear();
      await run("S", [["I", "EQ", "M"]], [["E", "EQ", "S001"]]);
      expect(log(), "an E row alone exempts every ship but its own").to.deep.equal(ships(["S001 M"]));
    });

    it("mode P: the table travels to the job as a SELECT-OPTIONS, and the log is what mode S wrote for the same table", async () => {
      await run("S", [["I", "EQ", "A"]]);
      const sequential = log();
      expect(sequential).to.deep.equal(ships(["S002 A"]));
      await clear();
      const submitted = await run("P", [["I", "EQ", "A"]]);
      expect(submitted.rules.map((r) => r.status)).to.deep.equal(["SUBMITTED", "SUBMITTED"]);
      await drainJobOutbox(store);
      for (let i = 0; i < 40; i++) {
        const outcome = await workQueuedBatch(root, store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) break;
      }
      const collected = await dialogStep(() => cls().collect({is_result: submitted.raw})).then(plain);
      expect(collected.rules.map((r) => r.status)).to.deep.equal(["DONE", "DONE"]);
      expect(log(), "the jobs ran with the table that was submitted, not the default").to.deep.equal(sequential);
    });

    it("mode P with a table of the second range: BT and EQ rows reach the job as they are", async () => {
      await run("S", [["I", "EQ", "M"]], [["I", "BT", "S001", "S002"]]);
      const sequential = log();
      expect(sequential).to.deep.equal(ships(["S901 M"]));
      await clear();
      const submitted = await run("P", [["I", "EQ", "M"]], [["I", "BT", "S001", "S002"]]);
      await drainJobOutbox(store);
      for (let i = 0; i < 40; i++) {
        const outcome = await workQueuedBatch(root, store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) break;
      }
      await dialogStep(() => cls().collect({is_result: submitted.raw}));
      expect(log()).to.deep.equal(sequential);
    });

    it("mode P with no table: the job applies the default itself, and the log is the default's", async () => {
      const submitted = await run("P");
      await drainJobOutbox(store);
      for (let i = 0; i < 40; i++) {
        const outcome = await workQueuedBatch(root, store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) break;
      }
      await dialogStep(() => cls().collect({is_result: submitted.raw}));
      expect(log()).to.deep.equal(DEFAULT);
    });

    it("the setting: seeded as the default list, tuned as a list of values, audited, snapshotted, and the next run uses it", async () => {
      await dialogStep(() => cls().settings_seed());
      expect([trim(confRow().param_val), trim(confRow().dsl_value), trim(confRow().origin)]).to.deep.equal(["M,D", "M,D", "DSL"]);
      expect(await set("params.restricted", "A,D", "tighten")).to.equal(true);
      expect([trim(confRow().param_val), trim(confRow().origin), trim(confRow().note_text)]).to.deep.equal(["A,D", "USER", "tighten"]);
      const logged = read("SELECT * FROM zosd_l3_conf_log WHERE set_name = 'fleet3' AND param_name = 'params.restricted' ORDER BY changed_at, change_id");
      expect(logged.filter((r) => trim(r.new_value) === "A,D").map((r) => [trim(r.old_value), trim(r.new_value), trim(r.note_text)])).to.deep.equal([["M,D", "A,D", "tighten"]]);
      const result = await run("S");
      expect(log()).to.deep.equal(ships(["S002 A", "S003 D"]));
      const snapshot = read("SELECT * FROM zosd_l3_run_conf WHERE run_id = ?", result.run);
      expect(snapshot.map((r) => [trim(r.param_name), trim(r.param_val), trim(r.origin)])).to.deep.equal([["params.restricted", "A,D", "USER"]]);
      // a table given to run( ) wins over the operator's list
      await clear();
      await run("S", [["I", "EQ", "M"]]);
      expect(log()).to.deep.equal(ships(["S001 M"]));
      expect(await reset("params.restricted")).to.equal(true);
      expect([trim(confRow().param_val), trim(confRow().origin)]).to.deep.equal(["M,D", "DSL"]);
    });

    it("the setting refuses what is not a list of values, without a change, and takes an empty list (every status)", async () => {
      await dialogStep(() => cls().settings_seed());
      const before = read("SELECT * FROM zosd_l3_conf_log").length;
      for (const bad of ["M;D", "MM", "A, D", ",A", "A,", "A,,D", "M,D,"]) {
        expect(await set("params.restricted", bad), bad).to.equal(false);
        // the refusal says why, in words the cockpit shows
        expect(trim(conf().refusal.get()), `reason for ${bad}`).to.match(/not a list of values.*no empty item/);
      }
      expect(trim(confRow().param_val)).to.equal("M,D");
      expect(read("SELECT * FROM zosd_l3_conf_log")).to.have.length(before);
      expect(await set("params.restricted", "")).to.equal(true);
      expect(trim(conf().refusal.get())).to.equal("");
      expect(trim(confRow().param_val)).to.equal("");
      // an empty list is an initial table: the run gives it the default, as for any initial parameter... of the setting, which is empty:
      // the table stays empty and holds every status
      await run("S");
      expect(log()).to.deep.equal(ships(["S001 M", "S002 A", "S003 D"]));
    });

    it("mode P with a tuned list: the job gets it in its selection field, and the log is mode S's", async () => {
      expect(await set("params.restricted", "A")).to.equal(true);
      await run("S");
      const sequential = log();
      expect(sequential).to.deep.equal(ships(["S002 A"]));
      await exec(["DELETE FROM zosd_l3_alert", "DELETE FROM zosd_l3_pile", "DELETE FROM zosd_l3_run"]);
      const submitted = await run("P");
      await drainJobOutbox(store);
      for (let i = 0; i < 40; i++) {
        const outcome = await workQueuedBatch(root, store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) break;
      }
      await dialogStep(() => cls().collect({is_result: submitted.raw}));
      expect(log()).to.deep.equal(sequential);
      expect(model.settings.entries[0].name).to.equal("params.restricted");
    });

    it("the conversion of a list to rows is the class's own: I EQ rows, in the order given", async () => {
      const rows = await dialogStep(async () => conf().range_restricted({iv_text: str("A,D,M")}));
      expect(rows.array().map((r) => [r.get().sign.get(), r.get().option.get(), r.get().low.get()])).to.deep.equal([["I", "EQ", "A"], ["I", "EQ", "D"], ["I", "EQ", "M"]]);
      expect((await dialogStep(async () => conf().range_restricted({iv_text: str("")}))).array()).to.have.length(0);
    });
  });
});
