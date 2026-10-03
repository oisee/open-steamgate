import {daemonHost} from "../tools/osd-daemon-host.mjs";
// DSL L3, slice 1 (docs/dsl-l3.md): a set of L2 rules run as one unit. The
// manifest compiles (and refuses what it should, at its line); the committed
// runner and job report are a fresh build; every rule's lines of the runner
// trace to the rule's line of the manifest. On a durable file database the
// runner writes exactly what each rule's own check answers, in one step
// (mode S) and as one background job per rule (mode P, through JOB_OPEN /
// SUBMIT VIA JOB / JOB_CLOSE and collected with BP_JOB_SELECT and
// SHOW_JOBSTATE); a rerun leaves the same log; a changed rule adds rows under
// its new model hash and keeps the old ones; explain walks an alert down to
// its rule line. Three mutants of the runner each turn the log check red.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {buildRule} from "../tools/dsl-l2.mjs";
import {buildSet, checkSet, compileSet, explainAlert, parseAlertKey, renderSet, SetError, unitFindings} from "../tools/dsl-l3.mjs";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const SET = "src/l2demo/fleet.l3.yaml";
const CORE = ".local/lars/open-abap-core/src";
const OUT = "src/l2demo";
const RUNNER = "zcl_l3_fleet";
const REPORT = "zl3_fleet";
const SET_TEXT = readFileSync(SET, "utf8");
const DATE = "20261001";
// every file the set generates beside the rules: the runner, the report, the ports
const GENERATED = /^(zcl_l3_fleet|zl3_fleet|zif_l3_fleet_|zcx_l3_fleet_port)[a-z_]*\.(clas|prog|intf)\.(abap|xml|trace\.json)$/;
const setLine = (re) => SET_TEXT.split("\n").findIndex((l) => re.test(l)) + 1;

// Rows that make six of the set's rules alert on DATE: a ship in maintenance
// with a voyage ahead and a pilot aboard, an active ship with one crew member
// and three voyages ahead, an active ship with no crew and 1100.50 kg booked,
// and an active ship that breaks nothing.
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

describe("DSL L3: a rule set, its runner, its alert log and its trace", function () {
  this.timeout(900000);
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), "dsl-l3-test-")); });
  after(() => rmSync(scratch, {recursive: true, force: true}));

  describe("the manifest", () => {
    it("the committed runner and job report are a fresh build (the check command exits 0)", () => {
      const run = spawnSync(process.execPath, ["tools/dsl-l3.mjs", "check", SET, "--out", OUT], {encoding: "utf8"});
      expect(run.status, run.stdout + run.stderr).to.equal(0);
      expect(run.stdout).to.contain("generated files match");
    });

    it("and the check notices one changed byte", async () => {
      const copy = join(scratch, "drift");
      mkdirSync(copy);
      for (const f of readdirSync(OUT).filter((n) => GENERATED.test(n))) writeFileSync(join(copy, f), readFileSync(join(OUT, f)));
      const file = join(copy, `${RUNNER}.clas.abap`);
      writeFileSync(file, readFileSync(file, "utf8").replace("DELETE FROM zosd_l2_ship.", "DELETE FROM zosd_l2_crew."));
      expect(await checkSet(SET, copy)).to.deep.equal([`${RUNNER}.clas.abap: differs from a fresh build`]);
      // and in a port's variant, which the runner no longer holds
      const log = join(copy, "zcl_l3_fleet_alerts_log.clas.abap");
      writeFileSync(file, readFileSync(join(OUT, `${RUNNER}.clas.abap`)));
      writeFileSync(log, readFileSync(log, "utf8").replace("MODIFY zosd_l3_alert", "INSERT zosd_l3_alert"));
      expect(await checkSet(SET, copy)).to.deep.equal(["zcl_l3_fleet_alerts_log.clas.abap: differs from a fresh build"]);
    });

    it("the compiler knows no domain words", () => {
      const source = readFileSync("tools/dsl-l3.mjs", "utf8");
      const hits = source.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /ship|voy|fleet|crew|cargo/i.test(l));
      expect(hits).to.deep.equal([]);
    });

    it("runs six rules, skips the disabled one, and writes each rule's model hash from its trace", () => {
      const model = compileSet(SET);
      expect(model.rules.map((r) => r.check_class)).to.deep.equal(["zcl_l2_maintenance_ship", "zcl_l2_grounded_ship_crew",
        "zcl_l2_ship_captain", "zcl_l2_ship_voyage_limit", "zcl_l2_ship_min_crew", "zcl_l2_ship_cargo_limit"]);
      expect(model.disabled.map((r) => r.check_class)).to.deep.equal(["zcl_l2_ship_max_cargo"]);
      const runner = readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8");
      model.rules.forEach((r, i) => {
        const hash = JSON.parse(readFileSync(join(OUT, `${r.check_class}.clas.trace.json`), "utf8")).model;
        expect(r.hash).to.equal(hash);
        expect(runner).to.include(`CONSTANTS c_hash_${i + 1} TYPE zosd_l3_alert-model_hash VALUE '${hash}'.`);
      });
      expect(runner).to.not.include("zcl_l2_ship_max_cargo=>check");
    });

    it("a set without piles: or params: renders what the templates rendered before they existed", async () => {
      // the templates with every section of slice 3a taken out (and the
      // unpiled branches kept): what they were before; the same model renders
      // the same bytes through both
      const NEW = ["piles", "with_params", "params", "range", "piled", "unpiled", "param_args", "has_args",
        // and slice 3b's (test/dsl-l3-stages.mjs), whose shared plan sections are `planned`
        "planned", "staged", "stages", "schedule", "with_worklist", "planner",
        // and slice 5a's (test/dsl-l3-resilience.mjs)
        "resilience", "fused", "killable"];
      const before = (template) => {
        let text = readFileSync(template, "utf8");
        for (const n of NEW) {
          text = text.replace(new RegExp(`^\\{\\{#${n}\\}\\}\\n[\\s\\S]*?^\\{\\{/${n}\\}\\}\\n`, "gm"), "")
            .replace(new RegExp(`\\{\\{#${n}\\}\\}[^\\n]*?\\{\\{/${n}\\}\\}`, "g"), "");
        }
        return text.replace(/^\{\{\^(piles|planned|staged)\}\}\n([\s\S]*?)^\{\{\/\1\}\}\n/gm, "$2");
      };
      const file = join(OUT, `zz_unpiled_${process.pid}.l3.yaml`);
      writeFileSync(file, SET_TEXT.replace(/^params:\n(  .*\n)+/m, "").replace(/^piles:\n(  .*\n)+/m, ""));
      try {
        const model = compileSet(file);
        expect([model.piles, model.params]).to.deep.equal([undefined, undefined]);
        const {renderRecipe} = await import("../tools/dsl-abap.mjs");
        const {files} = await renderSet(model);
        for (const [template, out] of [["recipes/l3-set/template.tpl", `${model.class}.clas.abap`], ["recipes/l3-job/template.tpl", `${model.report}.prog.abap`]]) {
          const stripped = join(scratch, `before-${basename(dirname(template))}.tpl`);
          writeFileSync(stripped, before(template));
          expect(readFileSync(stripped, "utf8"), template).to.not.match(/\bpiles?\b|pile_no|ty_params|is_params|it_range/);
          expect(files[out], out).to.equal((await renderRecipe(model, stripped)).text);
        }
      } finally { rmSync(file, {force: true}); }
    });

    it("piles: and params: in the model: the source port's key, its size, the piled rules and the bound parameters", () => {
      const model = compileSet(SET);
      expect(model.piles).to.deep.include({size: "2", source: {name: "ships", "name@type": model.piles.source["name@type"], key: "ship_id", table: "zosd_l2_ship", iface: "zif_l3_fleet_ships"}});
      expect(model.rules.map((r) => Boolean(r.piled))).to.deep.equal(Array(6).fill(true));
      expect(model.rules.find((r) => r.name === "ship-in-service-has-a-captain").range).to.include({rule_file: "src/l2demo/ship_captain.l2.yaml",
        rule_line: readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8").split("\n").findIndex((l) => /^range:/.test(l)) + 1});
      expect(model.params.map((p) => [p.name, p.screen, p.type_name, p.default])).to.deep.equal([["active_status", "p_active", "zosd_l2_ship-status", "A"]]);
      expect(model.rules.filter((r) => r.param_args).map((r) => [r.name, r.param_args.map((a) => a.ref)])).to.deep.equal([["ship-in-service-has-a-captain", ["iv_active_status"]]]);
      const report = readFileSync(join(OUT, `${REPORT}.prog.abap`), "utf8");
      expect(report).to.include("PARAMETERS p_pile TYPE i.\nPARAMETERS p_bind TYPE c LENGTH 255 LOWER CASE.\nPARAMETERS p_active TYPE zosd_l2_ship-status.\n");
      expect(report).to.include("    iv_pile = p_pile\n    is_params = ls_params\n");
    });

    // a copy of the manifest beside the committed rules, one line replaced
    const variant = (name, from, to) => {
      expect(SET_TEXT, `the set has ${from}`).to.include(from);
      const file = join(OUT, `zz_${name}_${process.pid}.l3.yaml`);
      writeFileSync(file, SET_TEXT.replace(from, to));
      return file;
    };
    const refused = (name, from, to, message, at) => {
      const file = variant(name, from, to);
      try {
        const where = relative(process.cwd(), file).split(sep).join("/");
        const line = readFileSync(file, "utf8").split("\n").findIndex((l) => at.test(l)) + 1;
        let error;
        try { compileSet(file); } catch (e) { error = e; }
        expect(error, "an error").to.be.instanceOf(SetError);
        expect(error.message.startsWith(`${where}:${line}: `), error.message).to.equal(true);
        expect(error.message.slice(`${where}:${line}: `.length)).to.match(message);
      } finally {
        rmSync(file, {force: true});
      }
    };
    it("a rule file that does not exist", () => refused("missing", "rule: ship_captain.l2.yaml", "rule: no_such.l2.yaml",
      /^rule file no_such\.l2\.yaml does not exist/, /no_such/));
    it("a rule listed twice (the same file by another path)", () => refused("twice", "  - rule: ship_min_crew.l2.yaml\n",
      "  - rule: ship_min_crew.l2.yaml\n  - rule: ./ship_captain.l2.yaml\n",
      new RegExp(`^rule file \\./ship_captain\\.l2\\.yaml is already in the set at line ${setLine(/- rule: ship_captain/)}$`), /\.\/ship_captain/));
    it("two files holding the same rule", () => {
      const copy = join(OUT, `zz_same_${process.pid}.l2.yaml`);
      writeFileSync(copy, readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8"));
      try {
        refused("same", "  - rule: ship_min_crew.l2.yaml\n", `  - rule: ship_min_crew.l2.yaml\n  - rule: ${basename(copy)}\n`,
          /^rule ship-in-service-has-a-captain is already in the set at line \d+/, /zz_same/);
      } finally { rmSync(copy, {force: true}); }
    });
    it("an enabled flag that is not true or false", () => refused("flag", "enabled: false", "enabled: maybe",
      /^enabled is true or false/, /enabled: maybe/));
    it("an unknown key", () => refused("key", "date: $date", "date: $date\ncadence: nightly", /^unknown key cadence/, /^cadence:/));
    it("a date that is not a parameter L2 knows", () => refused("date", "date: $date", "date: $tomorrow", /^date is \$date .* or today/, /^date:/));
    it("every rule disabled", () => {
      const all = SET_TEXT.replace(/^( {2}- rule: [a-z_]+\.l2\.yaml)$/gm, "$1\n    enabled: false").replace("enabled: false\n    enabled: false", "enabled: false");
      const file = join(OUT, `zz_off_${process.pid}.l3.yaml`);
      writeFileSync(file, all);
      try {
        expect(() => compileSet(file)).to.throw(SetError, /:\d+: every rule of the set is disabled/);
      } finally { rmSync(file, {force: true}); }
    });
    it("a rule that does not compile names the manifest line and the rule's own line", () => {
      const rule = join(OUT, `zz_broken_${process.pid}.l2.yaml`);
      writeFileSync(rule, readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8").replace("ship.status = $active_status", "ship.colour = $active_status"));
      try {
        refused("broken", "rule: ship_captain.l2.yaml", `rule: ${basename(rule)}`,
          new RegExp(`^rule ${basename(rule).replace(/\./g, "\\.")} does not compile: .*${basename(rule).replace(/\./g, "\\.")}:\\d+: ZOSD_L2_SHIP has no field COLOUR`), /zz_broken/);
      } finally { rmSync(rule, {force: true}); }
    });
    it("a rule whose generated class is stale", async () => {
      const dir = join(scratch, "stale");
      const rule = join(dir, "stale.l2.yaml");
      mkdirSync(dir);
      writeFileSync(rule, readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8").replace(/^class: .*$/m, "class: zcl_l2_stale_probe"));
      await buildRule(rule, dir);
      writeFileSync(rule, readFileSync(rule, "utf8").replace(/^title: .*$/m, "title: A changed title"));
      const set = join(dir, "stale.l3.yaml");
      writeFileSync(set, `set: stale\ntitle: t\ndate: $date\nrules:\n  - rule: stale.l2.yaml\n`);
      const where = relative(process.cwd(), set).split(sep).join("/");
      expect(() => compileSet(set)).to.throw(SetError, new RegExp(`^${where.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:5: the generated class of stale\\.l2\\.yaml is stale`));
    });
  });

  describe("set parameters and piles in the manifest", () => {
    // a copy of the manifest in its own folder, rules referenced from there,
    // with replacements and extra rule files (built beside it)
    let n = 0;
    const manifest = async (edits, rules = {}) => {
      const dir = join(scratch, `piles-${n++}`);
      mkdirSync(dir);
      for (const [name, text] of Object.entries(rules)) {
        writeFileSync(join(dir, name), text);
        await buildRule(join(dir, name), dir);
      }
      let text = SET_TEXT;
      for (const [from, to] of edits) {
        expect(text, `the set has ${JSON.stringify(from)}`).to.include(from);
        text = text.replace(from, to);
      }
      text = text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => rules[f] ? m : `rule: ${relative(dir, join(process.cwd(), OUT, f)).split(sep).join("/")}`);
      const file = join(dir, "fleet.l3.yaml");
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
    const CAPTAIN = readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8");
    const PARAM = "  active_status: {type: ZOSD_L2_SHIP-STATUS, default: A}\n";

    it("a set parameter no enabled rule declares", async () => refusedAt(await manifest([[PARAM, "  idle: {type: ZOSD_L2_SHIP-STATUS, default: A}\n"]]),
      /^set parameter idle is not used: no enabled rule declares \$idle/, /^  idle:/));
    it("a set parameter whose rule is disabled", async () => refusedAt(await manifest([["  - rule: ship_captain.l2.yaml\n", "  - rule: ship_captain.l2.yaml\n    enabled: false\n"]]),
      /^set parameter active_status is not used/, /^  active_status:/));
    it("a set parameter of another type than the rule's", async () => refusedAt(await manifest([[PARAM, "  active_status: {type: ZOSD_L2_SHIP-NAME, default: A}\n"]]),
      /^set parameter active_status is ZOSD_L2_SHIP-NAME; rule ship-in-service-has-a-captain declares \$active_status as ZOSD_L2_SHIP-STATUS/, /^  active_status:/));
    it("a set parameter typed with a bare C, which has no length", async () => refusedAt(await manifest([[PARAM, "  active_status: {type: C, default: A}\n"]]),
      /^set parameter active_status is C, which has no length and which a class or report refuses/, /^  active_status:/));
    it("a default that does not fit", async () => refusedAt(await manifest([[PARAM, "  active_status: {type: ZOSD_L2_SHIP-STATUS, default: AB}\n"]]),
      /^the default of set parameter active_status does not fit ZOSD_L2_SHIP-STATUS/, /^  active_status:/));
    it("a rule parameter without a default and no set parameter, at the rule's line", async () => refusedAt(
      await manifest([[PARAM, ""], ["params:\n", ""], ["rule: ship_captain.l2.yaml", "rule: captain.l2.yaml"]],
        {"captain.l2.yaml": CAPTAIN.replace("active_status: {type: ZOSD_L2_SHIP-STATUS, default: A}", "active_status: {type: ZOSD_L2_SHIP-STATUS}").replace(/^class: .*$/m, "class: zcl_l2_captain_nodefault")
          .replace(/^( {4}date: \d+\n)/gm, "$1    params: {active_status: A}\n")}),
      /^rule ship-in-service-has-a-captain needs \$active_status, which has no default in the rule: declare a set parameter active_status/, /rule: captain\.l2\.yaml/));
    it("a set parameter's selection field is P_ and six characters, made unique with digits, never a field of the report", async () => {
      const rules = {"crew.l2.yaml": readFileSync(join(OUT, "ship_min_crew.l2.yaml"), "utf8").replace(/^class: .*$/m, "class: zcl_l2_crew_param")
        .replace("when: ship.status = 'A'", "params:\n  active_state: {type: ZOSD_L2_SHIP-STATUS, default: A}\nwhen: ship.status = $active_state")};
      const file = await manifest([[PARAM, `${PARAM}  active_state: {type: ZOSD_L2_SHIP-STATUS, default: A}\n`], ["rule: ship_min_crew.l2.yaml", "rule: crew.l2.yaml"]], rules);
      expect(compileSet(file).params.map((p) => p.screen)).to.deep.equal(["p_active", "p_activ1"]);
    });
    it("a pile size that is not a positive INT4", async () => {
      for (const size of ["0", "-1", "two", "2147483648"]) {
        refusedAt(await manifest([["  size: 2\n", `  size: ${size}\n`]]), /^piles\.size is a whole number from 1 to 2147483647/, /^  size:/);
      }
    });
    it("a pile source that is not a source port", async () => refusedAt(await manifest([["  source: ships\n", "  source: alerts\n"]]),
      /^piles\.source "alerts" is not a source port of the set \(ships\)/, /^  source:/));
    it("an unknown key in piles", async () => refusedAt(await manifest([["  size: 2\n", "  size: 2\n  order: desc\n"]]),
      /^unknown key order in piles \(source, size\)/, /^  order:/));
    it("piles with no piled rule: no enabled rule has the source port's key as its range", async () => refusedAt(await manifest([["    key: ship_id\n", "    key: name\n"]]),
      /^no enabled rule is piled: a rule is piled when its range: is name of ZOSD_L2_SHIP, the key of port ships/, /^piles:/));
  });

  describe("ports in the manifest", () => {
    // a copy of the manifest in its own folder, its rule paths made relative to it, one text replaced
    let n = 0;
    const portManifest = (from, to, files = {}) => {
      expect(SET_TEXT, `the set has ${JSON.stringify(from)}`).to.include(from);
      const dir = join(scratch, `ports-${n++}`);
      mkdirSync(dir);
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      const rel = (f) => relative(dir, join(process.cwd(), OUT, f)).split(sep).join("/");
      const file = join(dir, "fleet.l3.yaml");
      writeFileSync(file, SET_TEXT.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => `rule: ${rel(f)}`).replace(from, to));
      return {file, dir, text: readFileSync(file, "utf8")};
    };
    const where = (file) => relative(process.cwd(), file).split(sep).join("/");
    const lineIn = (text, re) => text.split("\n").findIndex((l) => re.test(l)) + 1;
    const HAND = "      table: generated\n      capture: generated\n";
    const withHand = HAND + "      hand: zcl_hand_ships\n";
    const handClass = (methods = ["read"], interfaces = "    INTERFACES zif_l3_fleet_ships.\n") => `CLASS zcl_hand_ships DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
${interfaces}ENDCLASS.

CLASS zcl_hand_ships IMPLEMENTATION.
${methods.map((m) => `  METHOD zif_l3_fleet_ships~${m}.\n  ENDMETHOD.\n`).join("\n")}ENDCLASS.
`;
    const refusedAt = (m, re, line, fileOf = m.file) => {
      let error;
      try { compileSet(m.file); } catch (e) { error = e; }
      expect(error, "an error").to.be.instanceOf(SetError);
      expect(error.message.startsWith(`${where(fileOf)}:${line}: `), error.message).to.equal(true);
      expect(error.message.slice(`${where(fileOf)}:${line}: `.length)).to.match(re);
    };

    it("a hand-written variant is a class that implements the port's interface; the factory creates it", async () => {
      const m = portManifest(HAND, withHand, {"zcl_hand_ships.clas.abap": handClass()});
      const model = compileSet(m.file);
      expect(model.ports[0].variants.map((v) => [v.name, v.generated])).to.deep.equal([["table", true], ["capture", true], ["hand", false]]);
      const {files} = await buildSet(m.file, join(m.dir, "out"));
      expect(files["zcl_l3_fleet_ports.clas.abap"]).to.include("CREATE OBJECT ri_port TYPE zcl_hand_ships.");
      expect(Object.keys(files).filter((f) => f.includes("hand")), "no class is generated for it").to.deep.equal([]);
    });

    it("a class that lacks a method of the port's signature is refused at its CLASS line, in its own file", () => {
      const m = portManifest(HAND, withHand, {"zcl_hand_ships.clas.abap": handClass([])});
      const classFile = join(m.dir, "zcl_hand_ships.clas.abap");
      refusedAt(m, /^class zcl_hand_ships does not implement zif_l3_fleet_ships~read in its own implementation; the port's signature is read/,
        lineIn(readFileSync(classFile, "utf8"), /^CLASS zcl_hand_ships DEFINITION/), classFile);
    });

    it("a class built for another interface is refused at its CLASS line", () => {
      const m = portManifest(HAND, withHand, {"zcl_hand_ships.clas.abap": handClass(["read"], "    INTERFACES zif_l3_fleet_alerts.\n")});
      const classFile = join(m.dir, "zcl_hand_ships.clas.abap");
      refusedAt(m, /^class zcl_hand_ships does not implement zif_l3_fleet_ships/, 1, classFile);
    });

    it("a class that is not there is refused at the variant's manifest line", () => {
      const m = portManifest(HAND, withHand);
      refusedAt(m, /^class zcl_hand_ships of variant hand is not found/, lineIn(m.text, /^      hand:/));
    });

    it("a helper class in the same file that has the interface does not make the named class an adapter", () => {
      const helper = `
CLASS zcl_helper DEFINITION FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_l3_fleet_ships.
ENDCLASS.

CLASS zcl_helper IMPLEMENTATION.
  METHOD zif_l3_fleet_ships~read.
  ENDMETHOD.
ENDCLASS.
`;
      const named = `CLASS zcl_hand_ships DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS other.
ENDCLASS.

CLASS zcl_hand_ships IMPLEMENTATION.
  METHOD other.
  ENDMETHOD.
ENDCLASS.
`;
      const m = portManifest(HAND, withHand, {"zcl_hand_ships.clas.abap": named + helper});
      const classFile = join(m.dir, "zcl_hand_ships.clas.abap");
      refusedAt(m, /^class zcl_hand_ships does not implement zif_l3_fleet_ships, the interface of the source port/,
        lineIn(readFileSync(classFile, "utf8"), /^CLASS zcl_hand_ships DEFINITION/), classFile);
      // and the methods must be in the named class's own implementation, not a helper's
      const split = handClass([]).trimEnd().concat(`
CLASS zcl_helper2 DEFINITION FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_l3_fleet_ships.
ENDCLASS.

CLASS zcl_helper2 IMPLEMENTATION.
  METHOD zif_l3_fleet_ships~read.
  ENDMETHOD.
ENDCLASS.
`);
      const m2 = portManifest(HAND, withHand, {"zcl_hand_ships.clas.abap": split});
      refusedAt(m2, /does not implement zif_l3_fleet_ships~read in its own implementation/, 1,
        join(m2.dir, "zcl_hand_ships.clas.abap"));
    });

    it("a generated check class with a write or a commit injected is refused, naming the class line", async () => {
      const dir = join(scratch, `inject-${n++}`);
      mkdirSync(dir);
      const rule = join(dir, "captain.l2.yaml");
      writeFileSync(rule, readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8").replace(/^class: .*$/m, "class: zcl_l2_inject_probe"));
      await buildRule(rule, dir);
      const classFile = join(dir, "zcl_l2_inject_probe.clas.abap");
      const clean = readFileSync(classFile, "utf8");
      const manifest = join(dir, "inject.l3.yaml");
      writeFileSync(manifest, "set: inject\ntitle: t\ndate: $date\nrules:\n  - rule: captain.l2.yaml\n");
      expect(() => compileSet(manifest), "the clean class compiles").to.not.throw();
      const statements = {"COMMIT WORK.": "COMMIT statement", "ROLLBACK WORK.": "ROLLBACK statement",
        "MODIFY zosd_l2_ship FROM ls_x.": "MODIFY database statement", "INSERT zosd_l2_ship FROM ls_x.": "INSERT database statement",
        "UPDATE zosd_l2_ship SET name = 'x'.": "UPDATE database statement", "DELETE FROM zosd_l2_ship.": "DELETE database statement",
        "CALL FUNCTION 'Z_ANY' IN UPDATE TASK.": "CALL FUNCTION that registers an update or ends the unit",
        "CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.": "CALL FUNCTION that registers an update or ends the unit",
        "WAIT UP TO 1 SECONDS.": "WAIT statement", "SUBMIT zl3_fleet AND RETURN.": "SUBMIT statement",
        "CALL TRANSACTION 'SM37'.": "CALL TRANSACTION statement",
        "CALL FUNCTION 'Z_ANY' DESTINATION 'NONE'.": "CALL FUNCTION that registers an update or ends the unit",
        "CALL FUNCTION 'Z_ANY' STARTING NEW TASK 'T1'.": "CALL FUNCTION that registers an update or ends the unit",
        "RECEIVE RESULTS FROM FUNCTION 'Z_ANY'.": "RECEIVE RESULTS statement"};
      for (const [statement, what] of Object.entries(statements)) {
        const text = clean.replace("  METHOD check.\n", `  METHOD check.\n    ${statement}\n`);
        expect(text).to.not.equal(clean);
        writeFileSync(classFile, text);
        const line = lineIn(text, new RegExp(statement.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        let error;
        try { compileSet(manifest); } catch (e) { error = e; }
        expect(error, statement).to.be.instanceOf(SetError);
        expect(error.message, statement).to.match(new RegExp(`:5: the generated class of captain\\.l2\\.yaml \\(.*zcl_l2_inject_probe\\.clas\\.abap:${line}\\) holds a ${what.replace(/[()]/g, "\\$&")}`));
      }
    });

    it("nothing the runner or a generated variant holds ends or splits a unit of work (its SUBMIT, in mode P, is the one allowed statement); the check sees a COMMIT in one", () => {
      for (const f of readdirSync(OUT).filter((n) => /^(zcl_l3_fleet|zcl_l3_fleet_(ports|ships|alerts)\w*)\.clas\.abap$/.test(n))) {
        expect(unitFindings(readFileSync(join(OUT, f), "utf8"), f, {writes: true, jobs: f === `${RUNNER}.clas.abap`}), f).to.deep.equal([]);
      }
      const runner = readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8");
      const bad = runner.replace("    DELETE FROM zosd_l2_ship.\n", "    COMMIT WORK.\n    DELETE FROM zosd_l2_ship.\n");
      expect(bad).to.not.equal(runner);
      expect(unitFindings(bad, `${RUNNER}.clas.abap`, {writes: true, jobs: true}).map((f) => f.what)).to.deep.equal(["COMMIT statement"]);
      const waits = runner.replace("    DELETE FROM zosd_l2_ship.\n", "    WAIT UP TO 1 SECONDS.\n    DELETE FROM zosd_l2_ship.\n");
      expect(unitFindings(waits, `${RUNNER}.clas.abap`, {writes: true, jobs: true}).map((f) => f.what)).to.deep.equal(["WAIT statement"]);
    });

    it("a generated variant a kind does not have, and a binding to a variant that is not there, are refused at their lines", () => {
      let m = portManifest("    variants:\n      table: generated", "    variants:\n      log: generated\n      table: generated");
      refusedAt(m, /^a generated variant of a source is one of table, dummy, capture; log needs a class of its own/, lineIn(m.text, /log: generated/));
      m = portManifest("  ships: table\n", "  ships: nowhere\n");
      refusedAt(m, /^binding ships: "nowhere" is not a variant of the port \(table, capture\)/, lineIn(m.text, /ships: nowhere/));
      m = portManifest("  alerts: log\n", "  alerts: log\n  audit: log\n");
      refusedAt(m, /^binding audit names no port of the set/, lineIn(m.text, /audit: log/));
      m = portManifest("  ships: table\n", "");
      refusedAt(m, /^port ships has no binding/, lineIn(m.text, /^bindings:/));
    });

    it("a sink that is not the alert log, a second sink, and a field the table lacks are refused", () => {
      let m = portManifest("    key: ship_id", "    key: no_such");
      refusedAt(m, /^ZOSD_L2_SHIP has no field NO_SUCH/, lineIn(m.text, /key: no_such/));
      m = portManifest("    group: [set_name, rule_name, model_hash, check_date]", "    group: [set_name, rule_name]");
      refusedAt(m, /^group of sink alerts is set_name, rule_name, model_hash, check_date/, lineIn(m.text, /group:/));
      m = portManifest("bindings:\n", "  more:\n    kind: sink\n    table: ZOSD_L3_ALERT\n    group: [set_name, rule_name, model_hash, check_date]\n    seq: alert_seq\n    variants:\n      dummy: generated\nbindings:\n  more: dummy\n");
      refusedAt(m, /^a set has exactly one sink/, lineIn(m.text, /^ports:/));
    });

    it("a generated name over 30 characters is refused, naming the name", () => {
      const m = portManifest("  ships:\n    kind: source", "  shipsandmore:\n    kind: source");
      refusedAt(m, /^the generated name zcl_l3_fleet_shipsandmore_table has 31 characters, a class or interface name has at most 30/, lineIn(m.text, /table: generated/));
    });
  });

  describe("the trace", () => {
    const trace = JSON.parse(readFileSync(join(OUT, `${RUNNER}.clas.trace.json`), "utf8"));
    const source = readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8").split("\n");

    it("has one entry per generated line, each with a manifest line", () => {
      expect(trace.lines.map((l) => l.line)).to.deep.equal(source.slice(0, -1).map((_, i) => i + 1));
      for (const entry of trace.lines) expect(entry.set_line, `line ${entry.line}`).to.be.within(1, SET_TEXT.split("\n").length);
    });

    it("every line that names a rule traces to that rule's line of the manifest", () => {
      const model = compileSet(SET);
      model.rules.forEach((r, i) => {
        const at = setLine(new RegExp(`- rule: ${basename(r.file).replace(/\./g, "\\.")}$`));
        expect(r.set_line).to.equal(at);
        const lines = trace.lines.filter((e) => new RegExp(`\\bc_(rule|hash)_${i + 1}\\b|${r.check_class}|'L3_FLEET_0${i + 1}'`).test(source[e.line - 1]));
        expect(lines.length, r.name).to.be.at.least(8);
        for (const e of lines) expect([e.line, e.set_line], source[e.line - 1]).to.deep.equal([e.line, at]);
      });
      const disabled = trace.lines.find((e) => /not run: ship-max-cargo/.test(source[e.line - 1]));
      expect(disabled.set_line).to.equal(setLine(/- rule: ship_max_cargo/));
      const header = trace.lines.find((e) => /^CLASS zcl_l3_fleet DEFINITION/.test(source[e.line - 1]));
      expect(header.set_line).to.equal(setLine(/^set:/));
      const date = trace.lines.find((e) => /rs_result-check_date = iv_date\./.test(source[e.line - 1]));
      expect(date.set_line).to.equal(setLine(/^date:/));
    });

    it("every line of the ports' interfaces, variants, factory and exception traces to a manifest line", () => {
      const files = readdirSync(OUT).filter((f) => /^(zif_l3_fleet_|zcx_l3_fleet_port|zcl_l3_fleet_(ports|ships|alerts))[a-z_]*\.(clas|intf)\.abap$/.test(f));
      expect(files.sort()).to.deep.equal(["zcl_l3_fleet_alerts_capture.clas.abap", "zcl_l3_fleet_alerts_dummy.clas.abap", "zcl_l3_fleet_alerts_log.clas.abap",
        "zcl_l3_fleet_ports.clas.abap", "zcl_l3_fleet_ships_capture.clas.abap", "zcl_l3_fleet_ships_table.clas.abap",
        "zcx_l3_fleet_port.clas.abap", "zif_l3_fleet_alerts.intf.abap", "zif_l3_fleet_ships.intf.abap"]);
      const yamlLines = SET_TEXT.split("\n");
      const portsAt = setLine(/^ports:/);
      for (const f of files) {
        const text = readFileSync(join(OUT, f), "utf8").split("\n");
        const t = JSON.parse(readFileSync(join(OUT, f.replace(/\.abap$/, ".trace.json")), "utf8"));
        expect(t.lines.map((l) => l.line), f).to.deep.equal(text.slice(0, -1).map((_, i) => i + 1));
        for (const entry of t.lines) {
          expect(entry.set_line, `${f}:${entry.line}`).to.be.within(/^zcx_|_ports\./.test(f) ? setLine(/^set:/) : setLine(/^piles:/), yamlLines.length);
          expect(entry.node, `${f}:${entry.line}`).to.match(/^set\/fleet(\/|$)/);
        }
      }
    });

    it("a port's lines trace to the port's line, a variant's to the variant's, the default binding to its binding line", () => {
      const lineOf = (file, re) => {
        const text = readFileSync(join(OUT, file), "utf8").split("\n");
        const t = JSON.parse(readFileSync(join(OUT, file.replace(/\.abap$/, ".trace.json")), "utf8"));
        const i = text.findIndex((l) => re.test(l));
        expect(i, `${file} has ${re}`).to.be.at.least(0);
        return t.lines[i].set_line;
      };
      const ships = setLine(/^  ships:/), alerts = setLine(/^  alerts:/);
      expect(lineOf("zif_l3_fleet_ships.intf.abap", /^INTERFACE/)).to.equal(ships);
      expect(lineOf("zif_l3_fleet_ships.intf.abap", /METHODS read/)).to.equal(ships);
      expect(lineOf("zif_l3_fleet_alerts.intf.abap", /METHODS put/)).to.equal(alerts);
      // the variant's line within its port: the first such line after the port's own
      const variant = (port, name) => {
        const from = setLine(new RegExp(`^  ${port}:`));
        return from + SET_TEXT.split("\n").slice(from).findIndex((l) => new RegExp(`^      ${name}: generated`).test(l)) + 1;
      };
      expect(lineOf("zcl_l3_fleet_ships_table.clas.abap", /SELECT \* FROM/)).to.equal(variant("ships", "table"));
      expect(lineOf("zcl_l3_fleet_ships_capture.clas.abap", /gv_reads = gv_reads \+ 1/)).to.equal(variant("ships", "capture"));
      expect(lineOf("zcl_l3_fleet_alerts_log.clas.abap", /MODIFY zosd_l3_alert/)).to.equal(variant("alerts", "log"));
      expect(lineOf("zcl_l3_fleet_alerts_dummy.clas.abap", /rv_count = lines/)).to.equal(variant("alerts", "dummy"));
      expect(lineOf("zcl_l3_fleet_alerts_capture.clas.abap", /APPEND LINES OF/)).to.equal(variant("alerts", "capture"));
      expect(lineOf("zcl_l3_fleet_ports.clas.abap", /rv_variant = 'table'/)).to.equal(setLine(/^  ships: table/));
      expect(lineOf("zcl_l3_fleet_ports.clas.abap", /rv_variant = 'log'/)).to.equal(setLine(/^  alerts: log/));
      expect(lineOf("zcl_l3_fleet_ports.clas.abap", /METHOD get_alerts/)).to.equal(alerts);
      // each WHEN of a factory method is its variant's line
      const factory = readFileSync(join(OUT, "zcl_l3_fleet_ports.clas.abap"), "utf8").split("\n");
      const factoryTrace = JSON.parse(readFileSync(join(OUT, "zcl_l3_fleet_ports.clas.trace.json"), "utf8"));
      const at = factory.findIndex((l) => /METHOD get_alerts/.test(l));
      for (const name of ["log", "dummy", "capture"]) {
        const i = factory.findIndex((l, k) => k > at && l.includes(`WHEN '${name}'.`));
        expect(factoryTrace.lines[i].set_line, name).to.equal(variant("alerts", name));
        expect(factoryTrace.lines[i + 1].set_line, name).to.equal(variant("alerts", name));
      }
    });

    it("the runner's lines about a port trace to that port: the swap to the source, the write to the sink", () => {
      const src = readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8").split("\n");
      const t = JSON.parse(readFileSync(join(OUT, `${RUNNER}.clas.trace.json`), "utf8"));
      const ships = setLine(/^  ships:/), alerts = setLine(/^  alerts:/);
      const of = (re) => src.map((l, i) => [l, t.lines[i]]).filter(([l]) => re.test(l)).map(([, e]) => e.set_line);
      expect(of(/li_src_1|lt_keep_1|lt_scope_1|lv_swap_1/)).to.satisfy((ls) => ls.length >= 10 && ls.every((l) => l === ships));
      expect(of(/li_sink|ls_group/)).to.satisfy((ls) => ls.length >= 8 && ls.every((l) => l === alerts || l === setLine(/^piles:/)));
    });

    it("the job report has its own trace, and names each rule's version", () => {
      const job = JSON.parse(readFileSync(join(OUT, `${REPORT}.prog.trace.json`), "utf8"));
      expect(job.lines.length).to.equal(readFileSync(join(OUT, `${REPORT}.prog.abap`), "utf8").split("\n").length - 1);
      expect(Object.keys(job.rules)).to.have.length(6);
      expect(job.rules["ship-cargo-limit"].model).to.equal(compileSet(SET).rules.find((r) => r.name === "ship-cargo-limit").hash);
    });
  });

  describe("running the set on a durable database", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, store, dialogStep, drainJobOutbox, workQueuedBatch;
    const root = process.cwd();
    const date = () => new abap.types.Date().set(DATE);
    const paramsOf = (status) => {
      const value = abap.Classes.ZCL_L3_FLEET.ty_params.clone();
      value.get().active_status.set(status);
      return value;
    };
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    const log = () => read("SELECT * FROM zosd_l3_alert ORDER BY set_name, rule_name, model_hash, check_date, pile_no, alert_seq")
      .map((r) => ({set: r.set_name.trim(), rule: r.rule_name.trim(), hash: r.model_hash.trim(), date: r.check_date,
        pile: Number(r.pile_no), seq: Number(r.alert_seq), text: String(r.alert_text), run: r.run_id.trim(), ts: Number(r.run_ts),
        file: r.rule_file.trim(), line: Number(r.rule_line), class: r.rule_class.trim()})).sort(byKey);
    const content = (rows) => rows.map(({run, ts, pile, seq, ...rest}) => rest)
      .sort((a, b) => a.rule.localeCompare(b.rule) || a.hash.localeCompare(b.hash) || a.text.localeCompare(b.text));
    // one order for the log and for the checks' answers: by key
    const byKey = (a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : (a.pile ?? 0) - (b.pile ?? 0) || a.seq - b.seq);
    const plain = (result) => {
      const r = result.get();
      return {run: r.run_id.get().trim(), mode: r.mode.get(), alerts: r.alerts.get(), date: r.check_date.get(),
        ...(r.status ? {status: r.status.get().trim()} : {}),
        rules: r.rules.array().map((x) => Object.fromEntries(["rule", "model_hash", "jobname", "jobcount", "status", "alerts", "failed", "piles", "piles_done"]
          .map((k) => [k, typeof x.get()[k].get() === "string" ? x.get()[k].get().trim() : x.get()[k].get()])))};
    };
    const model = compileSet(SET);
    // what each rule's own check answers, as the rows the log must hold
    const expected = async () => {
      const rows = [];
      for (const r of model.rules) {
        const alerts = await abap.Classes[r.check_class.toUpperCase()].check({iv_date: date()});
        alerts.array().forEach((a, i) => rows.push({set: "fleet", rule: r.name, hash: r.hash, date: DATE, seq: i + 1, text: a.get(),
          file: r.file, line: Number(r.alert_line), class: r.check_class}));
      }
      return rows.sort(byKey);
    };
    // allow: the explicit opt-in a replay needs (a source that swaps table content)
    const runSet = (className, mode = "S", bind, allow = false, status) => dialogStep(() => abap.Classes[className.toUpperCase()].run({
      iv_date: date(), iv_mode: new abap.types.Character(1).set(mode),
      ...(status === undefined ? {} : {is_params: paramsOf(status)}),
      ...(bind === undefined ? {} : {iv_bind: new abap.types.String().set(bind)}),
      ...(allow ? {iv_allow_replay: new abap.types.Character(1).set("X")} : {})})).then(plain);
    const clearLog = () => exec(["DELETE FROM zosd_l3_alert", "DELETE FROM zosd_l3_pile", "DELETE FROM zosd_l3_run"]);
    // the run lock of the set and date: {run, status}, or undefined
    const lockRow = () => read("SELECT run_id, status FROM zosd_l3_run WHERE set_name = 'fleet' AND check_date = ?", DATE)
      .map((r) => ({run: r.run_id.trim(), status: r.status.trim()}))[0];

    before(async () => {
      // the renderer and the other suites boot the in-memory system first;
      // this suite then switches the shared runtime to a file database, as
      // test/jobs-e2e.mjs does, and puts it back afterwards
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-l3-db-"));
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
      const inserts = Object.entries(FLEET).flatMap(([table, rows]) => rows.map((row) =>
        `INSERT INTO ${table} (mandt, ${COLUMNS[table].join(", ")}) VALUES ('123', ${row.map((v) => `'${v}'`).join(", ")})`));
      await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), ...inserts]);
    });
    // loadRunner imports a separately transpiled module, which re-registers
    // classes it pulls in (CX_ROOT among them) as second copies; a suite after
    // this one in the same process then fails every cast against the first
    // copy (cx_sy_move_cast_error in test/gui-reports.mjs). Put the registry back.
    let classesBefore;
    before(() => { classesBefore = {...globalThis.abap.Classes}; });
    after(() => {
      const classes = globalThis.abap.Classes;
      for (const key of Object.keys(classes)) if (!(key in classesBefore)) delete classes[key];
      Object.assign(classes, classesBefore);
    });
    after(async () => {
      if (client) await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), "DELETE FROM zosd_l3_alert", "DELETE FROM zosd_l3_pile", "DELETE FROM zosd_l3_run"]).catch(() => {});
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

    // Everything the log must satisfy after a run and a rerun of `className`,
    // as a list of what is wrong: empty for the generated runner; each mutant
    // below must make it non-empty.
    async function logProblems(className) {
      const problems = [];
      await clearLog();
      const want = await expected();
      const first = await runSet(className);
      const once = log();
      if (JSON.stringify(content(once)) !== JSON.stringify(content(want))) problems.push(`the log after one run is not the union of the checks: ${JSON.stringify(content(once))}`);
      for (const r of first.rules) if (r.status !== "DONE") problems.push(`${r.rule}: status ${r.status} after the first run`);
      for (const row of once) {
        const rule = model.rules.find((r) => r.name === row.rule);
        if (!rule || row.hash !== rule.hash) problems.push(`${row.rule} ${row.seq}: model hash ${row.hash} is not the rule's ${rule?.hash}`);
      }
      if (first.alerts !== want.length) problems.push(`the result counts ${first.alerts} alerts, the checks ${want.length}`);
      const second = await runSet(className);
      const twice = log();
      if (JSON.stringify(content(twice)) !== JSON.stringify(content(once))) problems.push(`a rerun changed the log: ${JSON.stringify(content(twice))}`);
      const keys = twice.map((r) => `${r.set}/${r.rule}/${r.hash}/${r.date}/${r.pile}/${r.seq}`);
      if (new Set(keys).size !== keys.length) problems.push("a rerun duplicated an alert");
      for (const r of second.rules) if (r.status !== "DONE") problems.push(`${r.rule}: status ${r.status} after the rerun`);
      const stale = twice.filter((r) => r.run !== second.run);
      if (stale.length) problems.push(`${stale.length} row(s) still name the first run after the rerun`);
      return {problems, rows: twice, want, first, second};
    }

    it("several rules alert on the seeded rows", async () => {
      const want = await expected();
      const rules = new Set(want.map((r) => r.rule));
      expect(rules.size, JSON.stringify(want)).to.be.at.least(4);
      expect(want.length).to.equal(7);
    });

    it("mode S: the log is exactly the union of each rule's check, and a rerun leaves it identical", async () => {
      const {problems, rows, first, second} = await logProblems(RUNNER);
      expect(problems).to.deep.equal([]);
      expect(rows).to.have.length(7);
      expect(first.run).to.not.equal(second.run);
      expect(first.rules.map((r) => r.rule)).to.deep.equal(model.rules.map((r) => r.name));
      expect(rows.find((r) => r.rule === "ship-cargo-limit").text).to.equal("S003: 1100.50 kg booked");
    });

    it("a set parameter reaches only the L2 rules that declare it", async () => {
      await clearLog();
      const result = await runSet(RUNNER, "S", undefined, false, "D");
      const captain = result.rules.find((r) => r.rule === "ship-in-service-has-a-captain");
      expect(captain.alerts).to.equal(0);
      expect(result.alerts).to.equal(6);
      expect(log().every((r) => r.run === result.run)).to.equal(true);
    });

    it("a rerun that finds fewer alerts drops the rows past the last one (same rule, hash and date)", async () => {
      await clearLog();
      await runSet(RUNNER);
      expect(log().filter((r) => r.rule === "ship-min-crew")).to.have.length(2);
      await exec(["INSERT INTO zosd_l2_crew (mandt, crew_id, ship_id, role, since) VALUES ('123', 'C00009', 'S003', 'C', '20260101')"]);
      try {
        await runSet(RUNNER);
        const after = log();
        expect(after.filter((r) => r.rule === "ship-min-crew").map((r) => [r.seq, r.text])).to.deep.equal([[1, "S002 Bluebird: 1 crew aboard"], [1, "S003 Condor: 1 crew aboard"]]);
        expect(after.filter((r) => r.rule === "ship-in-service-has-a-captain")).to.have.length(0);
        expect(content(after)).to.deep.equal(content(await expected()));
      } finally {
        await exec(["DELETE FROM zosd_l2_crew WHERE crew_id = 'C00009'"]);
      }
    });

    // the plan of a run for one rule: [pile, low, high, status]
    const plan = (run, rule = model.rules[0].name) => read("SELECT pile_no, range_low, range_high, status FROM zosd_l3_pile WHERE run_id = ? AND rule_name = ? ORDER BY pile_no", run, rule)
      .map((r) => [Number(r.pile_no), r.range_low.trim(), r.range_high.trim(), r.status.trim()]);
    const runSized = (size, className = RUNNER) => dialogStep(() => abap.Classes[className.toUpperCase()].run({iv_date: date(),
      iv_mode: new abap.types.Character(1).set("S"), iv_pile_size: new abap.types.Integer().set(size)})).then(plain);
    // the exact plan of the seeded keys, and every alert row in the pile of its ship: a list of what is wrong
    const planProblems = async (className) => {
      const problems = [];
      await clearLog();
      const result = await runSet(className);
      for (const r of model.rules) {
        const got = plan(result.run, r.name);
        if (JSON.stringify(got) !== JSON.stringify([[1, "S001", "S002", "DONE"], [2, "S003", "S004", "DONE"]])) problems.push(`${r.name}: plan ${JSON.stringify(got)}`);
      }
      for (const row of log()) if (row.pile !== (/^S00[12]/.test(row.text) ? 1 : 2)) problems.push(`${row.text} in pile ${row.pile}`);
      return {problems, result};
    };

    it("mode S plans two piles of two keys for every rule, runs each, and each alert row names its pile", async () => {
      const {problems, result} = await planProblems(RUNNER);
      expect(problems).to.deep.equal([]);
      expect(result.rules.map((r) => [r.status, r.piles, r.piles_done])).to.deep.equal(Array(6).fill(["DONE", 2, 2]));
      expect(log()).to.have.length(7);
      expect(read("SELECT SUM(alerts) AS n FROM zosd_l3_pile WHERE run_id = ?", result.run)[0].n, "each plan row counts what its pile wrote").to.equal(7);
      const stamps = read("SELECT started, ended FROM zosd_l3_pile WHERE run_id = ?", result.run);
      expect(stamps.every((r) => Number(r.started) > 0 && Number(r.ended) >= Number(r.started))).to.equal(true);
    });

    it("three keys per pile cut elsewhere: I BT S001 S003, then I EQ S004, the one key left", async () => {
      await clearLog();
      const before = content((await runSet(RUNNER), log()));
      const sized = await runSized(3);
      expect(plan(sized.run)).to.deep.equal([[1, "S001", "S003", "DONE"], [2, "S004", "S004", "DONE"]]);
      expect(content(log())).to.deep.equal(before);
      for (const row of log()) expect(row.pile, row.text).to.equal(/^S00[123]/.test(row.text) ? 1 : 2);
    });

    it("a rerun with fewer piles than the run before: finalise leaves exactly the rerun's rows", async () => {
      await clearLog();
      const first = await runSet(RUNNER);
      const before = content(log());
      expect(log().filter((r) => r.pile === 2).length, "the first run wrote rows in pile 2").to.be.greaterThan(0);
      const one = await runSized(4);
      expect(plan(one.run)).to.deep.equal([[1, "S001", "S004", "DONE"]]);
      expect(one.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
      const rows = log();
      expect(new Set(rows.map((r) => r.run)), "no row of the first run is left, not even in its pile 2").to.deep.equal(new Set([one.run]));
      expect(rows.every((r) => r.pile === 1)).to.equal(true);
      expect(content(rows)).to.deep.equal(before);
      expect(first.run).to.not.equal(one.run);
    });

    it("no key, no pile: over a source with no rows the plan is empty and every piled rule is DONE without an alert", async () => {
      await clearLog();
      await abap.Classes.ZCL_L3_FLEET_SHIPS_CAPTURE.reset();
      const result = await runSet(RUNNER, "S", "ships=capture", true);
      expect(result.rules.map((r) => [r.status, r.piles, r.piles_done, r.alerts])).to.deep.equal(Array(6).fill(["DONE", 0, 0, 0]));
      expect(read("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE run_id = ?", result.run)[0].n).to.equal(0);
      expect(log()).to.deep.equal([]);
      expect(read("SELECT COUNT(*) AS n FROM zosd_l2_ship")[0].n, "the table is put back").to.equal(4);
    });

    it("a run bound to another sink variant does not finalise: the log keeps the last logged run", async () => {
      await clearLog();
      await runSet(RUNNER);
      const before = log();
      const dummy = await runSet(RUNNER, "S", "alerts=dummy");
      expect(dummy.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
      expect(log()).to.deep.equal(before);
    });

    // one run of the set per date at a time (docs/dsl-l3.md, "One run at a time"): what must hold, as a list of what is wrong
    const collectOf = (className, result) => dialogStep(() => abap.Classes[className.toUpperCase()].collect({is_result: result.raw})).then(plain);
    const runRaw = (className) => dialogStep(async () => {
      const raw = await abap.Classes[className.toUpperCase()].run({iv_date: date(), iv_mode: new abap.types.Character(1).set("S")});
      return {...plain(raw), raw};
    });
    async function lockProblems(className) {
      const problems = [];
      await clearLog();
      const first = await runRaw(className);
      if (JSON.stringify(lockRow()) !== JSON.stringify({run: first.run, status: "RELEASED"})) problems.push(`after mode S the lock is ${JSON.stringify(lockRow())}`);
      // another run holding the lock (a mode P run not yet collected, or one in another process)
      await exec([`UPDATE zosd_l3_run SET run_id = 'OTHER', status = 'HELD' WHERE set_name = 'fleet' AND check_date = '${DATE}'`]);
      const busy = await runRaw(className);
      if (busy.status !== "BUSY") problems.push(`a run while another holds the lock is ${busy.status}`);
      if (read("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE run_id = ?", busy.run)[0].n) problems.push("a BUSY run planned");
      if (log().some((r) => r.run === busy.run)) problems.push("a BUSY run wrote alerts");
      await exec([`UPDATE zosd_l3_run SET status = 'RELEASED' WHERE set_name = 'fleet' AND check_date = '${DATE}'`]);
      // input (a): a newer run B completes; then a late collect( ) of the older run A must not finalise B's rows away
      const second = await runRaw(className);
      const late = await collectOf(className, first);
      const rows = log();
      if (rows.length !== 7 || rows.some((r) => r.run !== second.run)) problems.push(`after a late collect of the older run the log holds ${rows.length} row(s) of ${[...new Set(rows.map((r) => r.run === second.run ? "the newer run" : r.run))]}`);
      if (lockRow()?.run !== second.run) problems.push(`the late collect took the lock: ${JSON.stringify(lockRow())}`);
      return {problems, first, busy, second, late};
    }

    it("one run per set and date: mode S takes the lock and releases it; a run while another holds it answers BUSY; a late collect of an older run does not finalise", async () => {
      const {problems, busy} = await lockProblems(RUNNER);
      expect(problems).to.deep.equal([]);
      expect(busy.rules).to.deep.equal([]);
    });

    // a log variant whose pile 2 writes do not land: the rules alerting there fail that pile
    const failingPile2 = async () => {
      if (!abap.Classes.ZCL_L3_FLEET_ALERTS_LOG_PILE2) {
        await loadPortClass("zcl_l3_fleet_alerts_log", "zcl_l3_fleet_alerts_log_pile2", (text) => mutate(text,
          "    LOOP AT it_rows INTO ls_row.\n", "    LOOP AT it_rows INTO ls_row.\n      IF ls_row-pile_no = 2.\n        CONTINUE.\n      ENDIF.\n"));
      }
    };
    // a run after a complete one, its pile 2 failing; what must hold, as a list of what is wrong
    async function partialProblems(className) {
      const problems = [];
      await clearLog();
      const older = await runSet(className);
      await failingPile2();
      const partial = await withClass("zcl_l3_fleet_alerts_log", "zcl_l3_fleet_alerts_log_pile2", () => runSet(className));
      const rule = partial.rules.find((r) => r.rule === "ship-min-crew");
      if (rule.status !== "PARTIAL" || rule.piles !== 2 || rule.piles_done !== 1) problems.push(`ship-min-crew: ${JSON.stringify(rule)}`);
      const states = plan(partial.run, "ship-min-crew").map((p) => p[3]);
      if (JSON.stringify(states) !== JSON.stringify(["DONE", "FAILED"])) problems.push(`ship-min-crew plan: ${states}`);
      const done = partial.rules.find((r) => r.rule === "maintenance-ship-no-future-voyage");
      if (done.status !== "DONE") problems.push(`a rule with nothing in pile 2 is ${done.status}`);
      const kept = log().filter((r) => r.rule === "ship-min-crew" && r.run === older.run).map((r) => r.text);
      if (JSON.stringify(kept) !== JSON.stringify(["S003 Condor: 0 crew aboard"])) problems.push(`the older run's pile 2 row of ship-min-crew: ${JSON.stringify(kept)}`);
      return {problems, older, partial};
    }

    it("a pile that fails leaves its rule PARTIAL, its plan row FAILED, the older run's rows in place; a complete rerun finalises", async () => {
      const {problems} = await partialProblems(RUNNER);
      expect(problems).to.deep.equal([]);
      const again = await runSet(RUNNER);
      expect(again.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
      expect(new Set(log().map((r) => r.run))).to.deep.equal(new Set([again.run]));
    });

    describe("mode P: one background job per rule and pile", () => {
      let sequential;
      const drainAndWork = async () => {
        const drained = await drainJobOutbox(store);
        const outcomes = [];
        for (let i = 0; i < 40; i++) {
          const outcome = await workQueuedBatch(root, store);
          if (!["completed", "failed", "step"].includes(outcome.kind) && outcome.kind !== "running") break;
          outcomes.push(outcome.kind);
        }
        return {drained, outcomes};
      };
      const collect = (result) => dialogStep(() => abap.Classes.ZCL_L3_FLEET.collect({is_result: result.raw})).then(plain);
      const runParallel = async (status) => {
        let raw;
        const submitted = await dialogStep(async () => {
          raw = await abap.Classes.ZCL_L3_FLEET.run({iv_date: date(), iv_mode: new abap.types.Character(1).set("P"),
            ...(status === undefined ? {} : {is_params: paramsOf(status)})});
          return raw;
        }).then(plain);
        return {...submitted, raw};
      };

      before(async () => {
        await clearLog();
        await runSet(RUNNER);
        sequential = content(log());
      });

      it("submits twelve jobs, each runs as its own step, and collect reports every pile done", async () => {
        await clearLog();
        const submitted = await runParallel();
        expect(submitted.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("SUBMITTED"));
        expect(submitted.rules.map((r) => r.jobname)).to.deep.equal(model.rules.map((_, i) => `L3_FLEET_0${i + 1}`));
        expect(submitted.rules.map((r) => r.piles)).to.deep.equal(Array(6).fill(2));
        expect(read("SELECT rule_name, pile_no, range_low, range_high FROM zosd_l3_pile WHERE run_id = ? ORDER BY rule_name, pile_no", submitted.run)
          .map((r) => [r.pile_no, r.range_low.trim(), r.range_high.trim()])).to.deep.equal(model.rules.flatMap(() => [[1, "S001", "S002"], [2, "S003", "S004"]]));
        expect(log(), "nothing is written before the jobs run").to.deep.equal([]);
        // before the jobs ran: no pile is DONE or FAILED, and a rule shows the state of an open job
        const before = await collect(submitted);
        expect(before.rules.map((r) => [r.status, r.piles, r.piles_done])).to.deep.equal(Array(6).fill(["READY", 2, 0]));
        expect(read("SELECT DISTINCT status FROM zosd_l3_pile WHERE run_id = ?", submitted.run).map((r) => r.status.trim())).to.deep.equal(["PLANNED"]);
        expect(read("SELECT job_name FROM zosd_l3_pile WHERE run_id = ? ORDER BY rule_name, pile_no", submitted.run).map((r) => r.job_name.trim()).sort())
          .to.deep.equal(model.rules.flatMap((_, i) => [1, 2].map((p) => `L3_FLEET_0${i + 1}_000${p}`)).sort());
        const {drained, outcomes} = await drainAndWork();
        expect(drained.imported).to.equal(12);
        expect(outcomes).to.have.length(12);
        const steps = read("SELECT program, input_json FROM zosd_job_step");
        expect(steps, "the steps are acknowledged and gone from the outbox").to.deep.equal([]);
        const runs = store.list().filter((r) => r.jobName.startsWith("L3_FLEET_"));
        expect(runs.map((r) => r.state)).to.deep.equal(Array(12).fill("COMPLETED"));
        const collected = await collect(submitted);
        expect(collected.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
        expect(collected.rules.map((r) => r.piles_done)).to.deep.equal(Array(6).fill(2));
        expect(collected.alerts).to.equal(7);
        expect(collected.rules.map((r) => r.alerts)).to.deep.equal(model.rules.map((r) => sequential.filter((x) => x.rule === r.name).length));
        const rows = log();
        expect(content(rows), "the same log as mode S").to.deep.equal(sequential);
        expect(new Set(rows.map((r) => r.run))).to.deep.equal(new Set([submitted.run]));
      });

      it("a submitted run holds the lock: collect before the jobs ran keeps it, a run meanwhile is BUSY, the final collect releases it", async () => {
        await clearLog();
        const submitted = await runParallel();
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "HELD"});
        const early = await collect(submitted);
        expect(early.status).to.equal("RUNNING");
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "HELD"});
        const busy = await runSet(RUNNER);
        expect(busy.status).to.equal("BUSY");
        await drainAndWork();
        const done = await collect(submitted);
        expect(done.status).to.equal("DONE");
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "RELEASED"});
        expect((await runSet(RUNNER)).status).to.equal("DONE");
      });

      it("a second parallel run (a retry) leaves the same log, under its own run id", async () => {
        const submitted = await runParallel();
        const {outcomes} = await drainAndWork();
        expect(outcomes).to.have.length(12);
        const collected = await collect(submitted);
        expect(collected.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
        const rows = log();
        expect(content(rows)).to.deep.equal(sequential);
        expect(new Set(rows.map((r) => r.run))).to.deep.equal(new Set([submitted.run]));
      });

      it("jobs carry the set parameter through report selection fields", async () => {
        const submitted = await runParallel("D");
        const {outcomes} = await drainAndWork();
        expect(outcomes).to.have.length(12);
        const collected = await collect(submitted);
        expect(collected.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
        expect(collected.rules.find((r) => r.rule === "ship-in-service-has-a-captain").alerts).to.equal(0);
        expect(collected.alerts).to.equal(6);
      });
    });

    // A copy of the committed runner (or another generated one) under another
    // class name, transpiled alone into `out`; what it does not bring itself
    // comes from the built system.
    async function loadRunner(name, abapSource, {out = join(scratch, name), extra = {}} = {}) {
      mkdirSync(out, {recursive: true});
      const {Transpiler, core} = modulesOf(process.cwd());
      const reg = new core.Registry();
      const files = {[`${name}.clas.abap`]: abapSource, [`${name}.clas.xml`]: readFileSync(join(OUT, `${RUNNER}.clas.xml`), "utf8")
        .replace(RUNNER.toUpperCase(), name.toUpperCase()), ...extra};
      for (const [f, text] of Object.entries(files)) reg.addFile(new core.MemoryFile(f, lowerNarrowSubmit(text, f, core)));
      const deps = ["src/dsl/zosd_l3_alert.tabl.xml", "src/dsl/zosd_l3_pile.tabl.xml", "src/dsl/zosd_l3_run.tabl.xml", "src/jobs/tbtcjob.tabl.xml", "src/jobs/btcselect.tabl.xml", "src/jobs/btch0000.tabl.xml",
        "gen/gui/zcl_osd_batch_report.clas.abap",
        ...readdirSync(OUT).filter((f) => /^zosd_l2_.*\.(tabl|dtel)\.xml$/.test(f)).map((f) => join(OUT, f)),
        // the ports the runner binds: their interfaces, variants, factory and exception
        ...readdirSync(OUT).filter((f) => /^(zif_l3_fleet_|zcx_l3_fleet_port|zcl_l3_fleet_(ports|ships|alerts))[a-z_]*\.(clas|intf)\.(abap|xml)$/.test(f)).map((f) => join(OUT, f)),
        ...model.rules.flatMap((r) => [`${OUT}/${r.check_class}.clas.abap`, `${OUT}/${r.check_class}.clas.xml`]),
        // a mutant of the ABAP Unit proof calls the committed runner
        ...(name === RUNNER ? [] : [`${OUT}/${RUNNER}.clas.abap`, `${OUT}/${RUNNER}.clas.xml`]),
        ...["ddic/ttyp/string_table.ttyp.xml", "ddic/structures/symsg.tabl.xml"].map((p) => join(CORE, p)),
        // CL_SYSTEM_UUID and the exception classes it raises, with their roots
        ...["uuid", "exceptions", ".", "ddic/dtel", "ddic/doma"].flatMap((folder) => readdirSync(join(CORE, folder))
          .filter((f) => /\.(clas|intf)\.abap$|\.(dtel|doma)\.xml$/.test(f)).map((f) => join(CORE, folder, f)))];
      for (const p of deps) {
        try { reg.addDependency(new core.MemoryFile(basename(p), readFileSync(p, "utf8"))); } catch { /* not in this checkout */ }
      }
      const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
      const output = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: []}).run(reg);
      const own = new Set(output.objects.map((o) => o.filename));
      const outputDir = pathToFileURL(join(process.cwd(), "output") + sep).href;
      for (const o of output.objects.filter((x) => x.object.type === "CLAS")) {
        const code = o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (m, file) => own.has(file) ? m : `import("${outputDir}${file}")`);
        writeFileSync(join(out, o.filename), code);
      }
      // a class the runner calls is looked up by name when called: load each
      // one given here (the dependencies come from the built system)
      // (the module re-registers CX_ROOT as a second copy: keep the first, which the built classes extend,
      // so a CATCH cx_root in the runner still sees their exceptions)
      const root = abap.Classes.CX_ROOT;
      for (const f of Object.keys(files).filter((f) => f.endsWith(".clas.abap"))) {
        await import(pathToFileURL(join(out, f.replace(/\.abap$/, ".mjs"))).href);
      }
      if (root) abap.Classes.CX_ROOT = root;
      // the runner reaches the ports by name, and a class is registered when its module is imported
      for (const f of readdirSync("output").filter((n) => /^(zcl_l3_fleet_(ports|ships|alerts)\w*|zcx_l3_fleet_port)\.clas\.mjs$/.test(n))) {
        if (!Object.keys(files).includes(f.replace(/\.mjs$/, ".abap"))) await import(pathToFileURL(join(process.cwd(), "output", f)).href);
      }
      expect(abap.Classes[name.toUpperCase()], `${name} loaded`).to.exist;
    }
    const renamed = (name, text = readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8")) => text.replace(new RegExp(`\\b${RUNNER}\\b`, "g"), name);
    // a copy of a generated class of the ports under another name, one edit made, loaded beside
    // the built system; the runner reaches the class by its name, so swapping the registry's
    // entry for the length of `work` is what binds the copy
    const portClass = (file) => readFileSync(join(OUT, file), "utf8");
    const loadPortClass = async (real, name, edit) => {
      const text = portClass(`${real}.clas.abap`).replaceAll(real, name);
      await loadRunner(name, edit(text));
    };
    const withClass = async (real, name, work) => {
      const was = abap.Classes[real.toUpperCase()];
      abap.Classes[real.toUpperCase()] = abap.Classes[name.toUpperCase()];
      try { return await work(); } finally { abap.Classes[real.toUpperCase()] = was; }
    };
    const mutate = (text, from, to) => {
      expect(text, `the runner holds ${JSON.stringify(from)}`).to.include(from);
      return text.replace(from, to);
    };

    describe("mutants of the runner", () => {
      it("control: the runner under another name, transpiled alone, passes the log check", async () => {
        await loadRunner("zcl_l3_fleet_ok", renamed("zcl_l3_fleet_ok"));
        expect((await logProblems("zcl_l3_fleet_ok")).problems).to.deep.equal([]);
      });

      // the mutants of slice 3a (docs/dsl-l3.md, "Piles and set parameters"), each against the test that names it
      const runnerMutant = async (name, from, to) => loadRunner(name, mutate(renamed(name), from, to));

      it("off-by-one in the cut (a chunk closes one key late): the exact plan turns red", async () => {
        await runnerMutant("zcl_l3_fleet_cut_mutant", "      IF lv_count = lv_size.\n", "      IF lv_count > lv_size.\n");
        const {problems} = await planProblems("zcl_l3_fleet_cut_mutant");
        expect(problems).to.include(`${model.rules[0].name}: plan [[1,"S001","S003","DONE"],[2,"S004","S004","DONE"]]`);
      });

      it("finalise deleting this run's rows: the union check turns red", async () => {
        await runnerMutant("zcl_l3_fleet_delete_new", "        AND run_id <> iv_run.\n", "        AND run_id = iv_run.\n");
        const {problems} = await logProblems("zcl_l3_fleet_delete_new");
        expect(problems.join("\n")).to.match(/the log after one run is not the union of the checks: \[\]/);
      });

      it("finalise running when a pile failed (mode S): the older run's row of the partial rule is gone", async () => {
        await runnerMutant("zcl_l3_fleet_finalise_partial", "          ELSEIF ls_rule-piles_done = ls_rule-piles.\n", "          ELSEIF ls_rule-piles_done >= 0.\n");
        const {problems} = await partialProblems("zcl_l3_fleet_finalise_partial");
        expect(problems.join("\n")).to.match(/ship-min-crew: .*"status":"DONE"/);
        expect(problems.join("\n")).to.match(/the older run's pile 2 row of ship-min-crew: \[\]/);
      });

      it("finalise never deleting: a rerun with fewer piles leaves the older run's pile 2", async () => {
        await runnerMutant("zcl_l3_fleet_no_finalise", "    IF zcl_l3_fleet_ports=>variant( iv_port = 'alerts' iv_bind = iv_bind ) <> 'log'.\n",
          "    IF abap_true = abap_true.\n");
        await clearLog();
        await runSet("zcl_l3_fleet_no_finalise");
        const one = await runSized(4, "zcl_l3_fleet_no_finalise");
        expect(log().filter((r) => r.run !== one.run && r.pile === 2).length).to.be.greaterThan(0);
      });

      it("finalise for any sink: a dummy run wipes the log", async () => {
        await runnerMutant("zcl_l3_fleet_finalise_any", "    IF zcl_l3_fleet_ports=>variant( iv_port = 'alerts' iv_bind = iv_bind ) <> 'log'.\n",
          "    IF abap_true = abap_false.\n");
        await clearLog();
        await runSet("zcl_l3_fleet_finalise_any");
        expect(log()).to.have.length(7);
        await runSet("zcl_l3_fleet_finalise_any", "S", "alerts=dummy");
        expect(log()).to.deep.equal([]);
      });

      it("a lock that is always taken: the run while another holds it is not BUSY", async () => {
        await runnerMutant("zcl_l3_fleet_lock_always", "    IF sy-dbcnt = 1.\n      rv_locked = abap_true.\n    ENDIF.\n", "    rv_locked = abap_true.\n");
        const {problems} = await lockProblems("zcl_l3_fleet_lock_always");
        // The corrupted lock still plans a run instead of answering BUSY;
        // the pile's own run guard now prevents that run from doing work.
        expect(problems).to.include("a run while another holds the lock is PARTIAL");
        expect(problems).to.include("a BUSY run planned");
        expect(problems).to.not.include("a BUSY run wrote alerts");
      });

      it("mode S that never releases: the lock stays HELD after the run", async () => {
        await runnerMutant("zcl_l3_fleet_no_release", "          release( iv_run = rs_result-run_id iv_date = rs_result-check_date ).\n", "");
        const {problems} = await lockProblems("zcl_l3_fleet_no_release");
        expect(problems[0]).to.match(/^after mode S the lock is \{"run":"\w+","status":"HELD"\}/);
      });

      it("finalise for a run that is not the latest (input a): a late collect of the older run deletes the newer run's rows", async () => {
        await runnerMutant("zcl_l3_fleet_not_latest", "    IF lv_latest <> iv_run.\n      RETURN.\n    ENDIF.\n", "");
        const {problems} = await lockProblems("zcl_l3_fleet_not_latest");
        expect(problems).to.include("after a late collect of the older run the log holds 0 row(s) of ");
      });

      it("collect releasing before every pile is final: the lock is gone while the jobs have not run", async () => {
        await runnerMutant("zcl_l3_fleet_release_early", "    IF lv_final = abap_true.\n", "    IF abap_true = abap_true.\n");
        await clearLog();
        // the generated runner submits (a runner transpiled alone cannot: SUBMIT needs the jobs layer); the mutant collects
        const submitted = await dialogStep(async () => {
          const raw = await abap.Classes.ZCL_L3_FLEET.run({iv_date: date(), iv_mode: new abap.types.Character(1).set("P")});
          return {...plain(raw), raw};
        });
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "HELD"});
        expect((await collectOf(RUNNER, submitted)).status, "control: the generated collect keeps the lock").to.equal("RUNNING");
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "HELD"});
        await collectOf("zcl_l3_fleet_release_early", submitted);
        expect(lockRow(), "red: released before the jobs ran").to.deep.equal({run: submitted.run, status: "RELEASED"});
        // the released jobs (they run ZCL_L3_FLEET by name) are worked off before the next test
        await drainJobOutbox(store);
        for (let i = 0; i < 40; i++) if (!["completed", "failed", "step", "running"].includes((await workQueuedBatch(root, store)).kind)) break;
        await clearLog();
      });

      it("a pile reading the range of another pile (pile 1 for every pile): the union check turns red", async () => {
        await runnerMutant("zcl_l3_fleet_wrong_pile", "        AND pile_no = iv_pile.\n", "        AND pile_no = 1.\n");
        const {problems} = await logProblems("zcl_l3_fleet_wrong_pile");
        expect(problems.join("\n")).to.match(/not the union of the checks/);
      });

      it("INSERT instead of MODIFY: the rerun cannot rewrite its rows", async () => {
        await loadPortClass("zcl_l3_fleet_alerts_log", "zcl_l3_fleet_alerts_log_m1",
          (text) => mutate(text, "      MODIFY zosd_l3_alert FROM ls_row.", "      INSERT zosd_l3_alert FROM ls_row."));
        const {problems} = await withClass("zcl_l3_fleet_alerts_log", "zcl_l3_fleet_alerts_log_m1", () => logProblems(RUNNER));
        expect(problems.join("\n")).to.match(/status PARTIAL after the rerun/);
        expect(problems.join("\n")).to.match(/still name the first run/);
      });

      it("one rule dropped from the runner: the log misses its alerts", async () => {
        const text = renamed("zcl_l3_fleet_m2");
        const lines = "    ls_rule-rule = c_rule_3.\n    ls_rule-model_hash = c_hash_3.\n    ls_rule-jobname = 'L3_FLEET_03'.\n    APPEND ls_rule TO rt_rules.\n";
        await loadRunner("zcl_l3_fleet_m2", mutate(text, lines, ""));
        const {problems} = await logProblems("zcl_l3_fleet_m2");
        expect(problems.join("\n")).to.match(/not the union of the checks/);
      });

      it("a wrong model hash written: the rows do not name the rule's version", async () => {
        const text = renamed("zcl_l3_fleet_m3");
        const right = model.rules[0].hash;
        await loadRunner("zcl_l3_fleet_m3", mutate(text, `VALUE '${right}'.`, `VALUE 'sha256:${"0".repeat(64)}'.`));
        const {problems} = await logProblems("zcl_l3_fleet_m3");
        expect(problems.join("\n")).to.match(new RegExp(`maintenance-ship-no-future-voyage 1: model hash sha256:0{64} is not the rule's ${right}`));
      });
    });

    // The ABAP Unit proof (src/l3proof, docs/dsl-l3.md "Proof") is the same
    // source the lead runs on a system. `npm run unit` runs mode_s and rerun
    // and skips mode_p by configuration (abap_transpile.json), because there
    // no ABAP Unit method runs in a dialog step, the database is in memory and
    // nothing executes a released job. Here the class gets what a system gives
    // it: each method (setup, the method, teardown) is one dialog step on a
    // file database, and beside it runs the loop `osd-batch-runs worker` runs,
    // drain the outbox and work the queue. That loop takes the work process
    // like any step, so a job runs only while the proof's WAIT has given it up,
    // which is when a background work process gets the CPU on a system.
    describe("the ABAP Unit proof ZCL_L3_FLEET_PROOF, each method a dialog step, a job worker beside it", () => {
      const PROOF = "zcl_l3_fleet_proof";
      const PROOF_DIR = "src/l3proof";
      const CHECK_DATE = "20991001";
      let worker;
      const startWorker = () => {
        const state = {stop: false, errors: [], ran: 0};
        state.done = (async () => {
          while (!state.stop) {
            try {
              await drainJobOutbox(store);
              const outcome = await workQueuedBatch(root, store);
              if (["completed", "failed", "step"].includes(outcome.kind)) state.ran++;
              else await new Promise((r) => setTimeout(r, 50));
            } catch (e) {
              state.errors.push(String(e?.message ?? e));
              state.stop = true;
            }
          }
        })();
        return state;
      };
      // no job of the set queued or running, so nothing writes after this
      const settled = async () => {
        for (let i = 0; i < 400; i++) {
          const open = read("SELECT COUNT(*) AS n FROM zosd_job_outbox")[0].n
            + store.list().filter((r) => r.jobName.startsWith("L3_FLEET") && !["COMPLETED", "FAILED", "INTERRUPTED"].includes(r.state)).length;
          if (open === 0) return;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("the worker did not settle");
      };
      const failureOf = (e) => {
        const text = (x) => (x?.get ? String(x.get()) : x === undefined ? undefined : String(x));
        return text(e?.msg) ?? text(e?.message) ?? String(e);
      };
      // one ABAP Unit method as ABAP Unit runs it: a fresh instance, setup,
      // the method, teardown; here inside one dialog step
      const runMethod = (local, method) => dialogStep(async () => {
        const test = await (new local()).constructor_();
        const own = test.FRIENDS_ACCESS_INSTANCE;
        await own.setup();
        try { await own[method](); } finally { await own.teardown(); }
      }).then(() => undefined, failureOf);
      const proofClass = async (module = pathToFileURL(join(root, "output", `${PROOF}.clas.testclasses.mjs`)).href) => (await import(module)).ltcl_proof;
      const ours = () => ({
        log: read("SELECT COUNT(*) AS n FROM zosd_l3_alert WHERE check_date = ?", CHECK_DATE)[0].n,
        piles: read("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE check_date = ?", CHECK_DATE)[0].n,
        seed: read("SELECT COUNT(*) AS n FROM zosd_l2_ship WHERE ship_id LIKE 'L30%'")[0].n,
        // the two-stage set's gates and worklists (slice 3b)
        stages: read("SELECT COUNT(*) AS n FROM zosd_l3_stage WHERE check_date = ?", CHECK_DATE)[0].n,
        work: read("SELECT COUNT(*) AS n FROM zosd_l3_work WHERE check_date = ?", CHECK_DATE)[0].n,
        // the doctor's audit rows (slice 5a)
        doctor: read("SELECT COUNT(*) AS n FROM zosd_l3_doctor WHERE check_date = ?", CHECK_DATE)[0].n,
      });
      // a runner mutant answers every call the proof (and a job) makes to ZCL_L3_FLEET
      const withRunner = async (name, work) => {
        const real = abap.Classes.ZCL_L3_FLEET;
        abap.Classes.ZCL_L3_FLEET = abap.Classes[name.toUpperCase()];
        try { return await work(); } finally { abap.Classes.ZCL_L3_FLEET = real; }
      };

      before(() => { worker = startWorker(); });
      after(async () => {
        worker.stop = true;
        await worker.done;
        await exec([`DELETE FROM zosd_l3_alert WHERE check_date = '${CHECK_DATE}'`, `DELETE FROM zosd_l3_pile WHERE check_date = '${CHECK_DATE}'`]);
      });
      afterEach(() => expect(worker.errors, "the worker").to.deep.equal([]));

      // A system runs the test methods of a class in alphabetical order, not in
      // the order the class declares them (A4H, 2026-10-02: a failing first
      // method was DOCTOR_HEALS, and the methods after it never ran). The
      // harness runs them in that order, read off the class, so a method that
      // leaves something behind for the next one fails here as it would there.
      const PROOF_METHODS = ["cockpit_action", "collect_waits_for_submit", "doctor_heals", "doctor_keeps_run_values", "fuse_stops", "governor_glass", "mode_p", "mode_s", "partial_keeps_old", "rerun",
        "rerun_fewer_piles", "settings_tune", "sim_twin", "stages_mode_p", "stages_mode_s", "stages_partial"];
      const systemOrder = () => [...readFileSync(join(PROOF_DIR, `${PROOF}.clas.testclasses.abap`), "utf8")
        .matchAll(/^\s*METHODS (\w+) FOR TESTING\./gm)].map((m) => m[1].toLowerCase()).sort();
      const conf = () => abap.Classes.ZCL_L3_FLEET2_CONF;
      const runner2 = () => abap.Classes.ZCL_L3_FLEET2;
      // a static method of a generated class replaced for the length of `work`
      const patched = async (cls, method, replacement, work) => {
        const was = cls[method];
        cls[method] = replacement(was);
        try { return await work(); } finally { cls[method] = was; }
      };
      const tune = (name, value) => dialogStep(() => runner2().set_setting({iv_param: new abap.types.String().set(name),
        iv_value: new abap.types.String().set(value), iv_note: new abap.types.String().set("left by an earlier method")}));
      const setting = (name) => read("SELECT param_val, origin FROM zosd_l3_conf WHERE set_name = 'fleet2' AND param_name = ?", name)
        .map((r) => [String(r.param_val).trim(), String(r.origin).trim()])[0];

      it("runs the methods in the order a system runs them: alphabetical", () => {
        expect(systemOrder()).to.deep.equal(PROOF_METHODS);
      });

      it("passes on this runtime, mode_p and stages_mode_p included: their jobs run while it waits, and it leaves nothing behind", async () => {
        const local = await proofClass();
        // the jobs since a mark, by the store's row order (more than list( )'s 200 run here)
        const mark = () => store.db.prepare("SELECT MAX(rowid) AS n FROM batch_runs").get().n ?? 0;
        const jobsAfter = (since) => store.db.prepare("SELECT id, job_name AS jobName, state FROM batch_runs WHERE rowid > ? ORDER BY rowid").all(since);
        const before = mark();
        const failures = {};
        const methods = systemOrder();
        let glassJobs = new Set(), simJobs = [];
        for (const method of methods) {
          const beforeMethod = mark();
          failures[method] = await runMethod(local, method);
          if (method === "governor_glass") glassJobs = new Set(jobsAfter(beforeMethod).map((r) => r.id));
          if (method === "sim_twin") simJobs = jobsAfter(beforeMethod);
        }
        await daemonHost(abap)?.idle();
        await settled();
        expect(glassJobs.size, "governor proof ran real jobs").to.be.greaterThan(6);
        // the simulated twin (slice 5d): its dumps are jobs that abort, and the
        // doctor's resubmits of them complete; ten piles of stage 1 and stage 2's
        const simStates = simJobs.reduce((n, r) => ({...n, [r.state]: (n[r.state] ?? 0) + 1}), {});
        expect(simStates.FAILED, "the twin's dumps abort their jobs").to.be.greaterThan(0);
        expect(simStates.COMPLETED, "and the jobs after them complete").to.be.greaterThan(10);
        expect(Object.keys(simStates).sort()).to.deep.equal(["COMPLETED", "FAILED"]);
        expect(failures).to.deep.equal(Object.fromEntries(methods.map((m) => [m, undefined])));
        const all = jobsAfter(before);
        // the two-stage set: the filter's four piles (eight ships, two per pile), then
        // stage 2's six rules over the two busy ships of the proof's date, one pile each;
        // doctor_heals (slice 5a): the last filter pile once more, submitted by the doctor,
        // and stage 2's six again; doctor_keeps_run_values (slice 5b): the same pile, and
        // stage 2 over three busy ships cut by the run's own size 2, two piles a rule
        const simIds = new Set(simJobs.map((r) => r.id));
        const staged = all.filter((r) => /^L3_FLEET2_[12][0-9]{2}_[0-9]{4}$/.test(r.jobName) && !glassJobs.has(r.id) && !simIds.has(r.id));
        expect(all.filter((r) => glassJobs.has(r.id)).every((r) => r.state === "COMPLETED"), "governor jobs complete").to.equal(true);
        const stage2 = [2, 3, 4, 5, 6, 7].map((n) => `L3_FLEET2_20${n}_0001`);
        const stage2Cut = [2, 3, 4, 5, 6, 7].flatMap((n) => [`L3_FLEET2_20${n}_0001`, `L3_FLEET2_20${n}_0002`]);
        expect(staged.map((r) => r.jobName).sort(), "the two stages' jobs").to.deep.equal([1, 2, 3, 4].map((p) => `L3_FLEET2_101_000${p}`)
          .concat(stage2, ["L3_FLEET2_101_0004"], stage2, ["L3_FLEET2_101_0004"], stage2Cut).sort());
        expect(staged.map((r) => r.state)).to.deep.equal(Array(30).fill("COMPLETED"));
        const watcherJobs = all.filter((r) => r.jobName === "L3_FLEET2_PASS");
        expect(watcherJobs.length, "the daemon dispatched doctor passes").to.be.greaterThan(0);
        expect(watcherJobs.every((r) => r.state === "COMPLETED"), "watcher passes complete").to.equal(true);
        const runs = all.filter((r) => r.jobName.startsWith("L3_FLEET_"));
        expect(runs.map((r) => r.jobName).sort(), "twenty-four jobs ran").to.deep.equal(model.rules.flatMap((_, i) => [1, 2, 3, 4].map((p) => `L3_FLEET_0${i + 1}_000${p}`)));
        expect(runs.map((r) => r.state)).to.deep.equal(Array(24).fill("COMPLETED"));
        expect(ours(), "teardown deleted the seed and the runs' rows").to.deep.equal({log: 0, piles: 0, seed: 0, stages: 0, work: 0, doctor: 0});
        // and every setting is back at its DSL default
        expect(read("SELECT COUNT(*) AS n FROM zosd_l3_conf WHERE set_name = 'fleet2' AND (origin <> 'DSL' OR param_val <> dsl_value)")[0].n).to.equal(0);
      });

      it("a setting an earlier method left tuned does not reach the next one: setup resets every setting", async () => {
        const local = await proofClass();
        // what settings_tune leaves when it fails before its reset (or an operator's tune)
        await tune("piles.checks.size", "1");
        expect(setting("piles.checks.size")).to.deep.equal(["1", "USER"]);
        expect(await runMethod(local, "stages_mode_s")).to.equal(undefined);
        expect(setting("piles.checks.size")).to.deep.equal(["2", "DSL"]);
      });

      it("npm run unit runs mode_s and rerun and skips mode_p by configuration, said in the run", () => {
        const index = readFileSync(join(root, "output", "index.mjs"), "utf8");
        const entry = index.split("ret.push(").find((e) => e.includes(`"${PROOF.toUpperCase()}"`));
        // declared in the order a system runs them, so `npm run unit` runs them in it too
        const skipped = new Set(["governor_glass", "mode_p", "stages_mode_p", "doctor_heals", "doctor_keeps_run_values", "sim_twin"]);
        expect(entry).to.include(`methods: ${JSON.stringify(PROOF_METHODS.map((name) => ({name, skip: skipped.has(name)})))}`);
        expect(entry).to.include('riskLevel: "DANGEROUS"');
      });

      it("the class is what a system needs: unit tests flagged, 7-bit ASCII, lines under 255", () => {
        expect(readFileSync(join(PROOF_DIR, `${PROOF}.clas.xml`), "utf8")).to.include("<WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>");
        for (const f of readdirSync(PROOF_DIR)) {
          const text = readFileSync(join(PROOF_DIR, f), "utf8");
          expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text), `${f} is 7-bit ASCII`).to.equal(true);
          expect(Math.max(...text.split("\n").map((l) => l.length)), f).to.be.below(255);
        }
      });

      describe("mutants it catches", () => {
        it("a setup that does not reset the settings: a size left tuned by an earlier method cuts stage 2 by one", async () => {
          const local = await proofClass();
          await tune("piles.checks.size", "1");
          const failure = await patched(runner2(), "reset_settings", () => async () => new abap.types.Character(1).set("X"),
            () => runMethod(local, "stages_mode_s"));
          expect(failure).to.equal("stage 2 has one pile per two worklist keys for each of its six rules");
          await settled();
          await dialogStep(() => runner2().reset_settings());
          expect(setting("piles.checks.size")).to.deep.equal(["2", "DSL"]);
          expect(ours().seed).to.equal(0);
        });

        it("the doctor that takes the table's values of the moment (review P2-1): the healed run is cut by 1 and fuses", async () => {
          const local = await proofClass();
          // scope( ) that keeps the values it is given: heal( ) and collect( ) keep the live ones
          const failure = await patched(conf(), "scope", (was) => async function (args) {
            const kept = await was.call(this, args);
            kept.set(args.is_vals);
            return kept;
          }, () => runMethod(local, "doctor_keeps_run_values"));
          expect(failure).to.match(/^the healed run keeps its own fuse and ends DONE; piles: .*2\/ship-min-crew\/[0-9]+ FUSED MAX-ALERTS 1(;|$)/);
          await settled();
          expect(setting("fuses.max_alerts")).to.deep.equal(["500", "DSL"]);
          expect(ours().seed).to.equal(0);
        });

        it("finalise running when a pile failed (collect, mode P): the partial proof turns red", async () => {
          const source = mutate(renamed("zcl_l3_fleet_partial_mutant"), "      ELSEIF lv_lost = abap_true.\n        ls_rule-status = 'PARTIAL'.\n",
            "      ELSEIF lv_lost = abap_true.\n        ls_rule-status = 'PARTIAL'.\n        finalise( iv_rule = ls_rule-rule iv_hash = ls_rule-model_hash iv_date = is_result-check_date\n"
            + "                  iv_run = is_result-run_id iv_bind = is_result-bind ).\n");
          await loadRunner("zcl_l3_fleet_partial_mutant", source);
          const local = await proofClass();
          const failure = await withRunner("zcl_l3_fleet_partial_mutant", () => runMethod(local, "partial_keeps_old"));
          expect(failure).to.equal("a failed pile keeps the previous run until a complete plan finalises");
        });
        it("a runner that drops a rule: mode S runs five, and the log misses the rule's alerts", async () => {
          const lines = "    ls_rule-rule = c_rule_6.\n    ls_rule-model_hash = c_hash_6.\n    ls_rule-jobname = 'L3_FLEET_06'.\n    APPEND ls_rule TO rt_rules.\n";
          await loadRunner("zcl_l3_fleet_pm1", mutate(renamed("zcl_l3_fleet_pm1"), lines, ""));
          const local = await proofClass();
          const failures = await withRunner("zcl_l3_fleet_pm1", async () => ({
            mode_s: await runMethod(local, "mode_s"), rerun: await runMethod(local, "rerun")}));
          expect(failures.mode_s).to.equal("mode S runs the six enabled rules");
          // open-abap-core's assert_equals answers a table of another length
          // with its own text and not with msg; a system shows msg
          expect(failures.rerun).to.be.oneOf(["after the rerun the log is still the union of the checks",
            "Expected table to contain 12 rows, got 10"]);
          expect(ours()).to.deep.equal({log: 0, piles: 0, seed: 0, stages: 0, work: 0, doctor: 0});
        });

        it("INSERT instead of MODIFY: the first run passes, the rerun cannot rewrite its rows", async () => {
          await loadPortClass("zcl_l3_fleet_alerts_log", "zcl_l3_fleet_alerts_log_pm2",
            (text) => mutate(text, "      MODIFY zosd_l3_alert FROM ls_row.", "      INSERT zosd_l3_alert FROM ls_row."));
          const local = await proofClass();
          const failures = await withClass("zcl_l3_fleet_alerts_log", "zcl_l3_fleet_alerts_log_pm2", async () => ({
            mode_s: await runMethod(local, "mode_s"), rerun: await runMethod(local, "rerun")}));
          expect(failures.mode_s).to.equal(undefined);
          expect(failures.rerun).to.match(/^the rerun: every rule DONE expected, got L3_FLEET_01 .* PARTIAL ;/);
          expect(ours()).to.deep.equal({log: 0, piles: 0, seed: 0, stages: 0, work: 0, doctor: 0});
        });

        it("mode P that does not wait: collect reads the jobs before they ran, and the proof names their states", async () => {
          const name = `${PROOF}_pm3`;
          const tests = readFileSync(join(PROOF_DIR, `${PROOF}.clas.testclasses.abap`), "utf8").replaceAll(PROOF, name);
          await loadRunner(name, readFileSync(join(PROOF_DIR, `${PROOF}.clas.abap`), "utf8").replaceAll(PROOF, name), {
            extra: {[`${name}.clas.testclasses.abap`]: mutate(tests, "      WAIT UP TO 1 SECONDS.\n      lv_waited = lv_waited + 1.\n    ENDDO.\n  ENDMETHOD.\n\n  METHOD expected.",
            "      lv_waited = lv_waited + 1.\n    ENDDO.\n  ENDMETHOD.\n\n  METHOD expected.")}});
          const local = await proofClass(pathToFileURL(join(scratch, name, `${name}.clas.testclasses.mjs`)).href);
          const failure = await runMethod(local, "mode_p");
          // a rule whose piles are all still to run shows the state of an open job, as before piles
          expect(failure).to.match(/^the jobs did not end within 180 seconds: L3_FLEET_01 +maintenance-ship-no-future-voyage READY ;/);
          expect(failure.match(/ READY ;/g)).to.have.length(6);
          // the jobs were released all the same: the teardown waits for them
          // (settle, bounded) before it deletes, so they ran inside its WAIT
          await settled();
          expect(ours().seed).to.equal(0);
          await exec([`DELETE FROM zosd_l3_alert WHERE check_date = '${CHECK_DATE}'`, `DELETE FROM zosd_l3_pile WHERE check_date = '${CHECK_DATE}'`]);
        });
      });
    });

    // ---- ports and adapters (docs/dsl-l3.md) ----------------------------------------------
    describe("ports and adapters: bindings are data, a variant is chosen per run", () => {
      const PORTS = "zcl_l3_fleet_ports";
      const portsText = readFileSync(join(OUT, `${PORTS}.clas.abap`), "utf8");
      const CAPTURE = "ZCL_L3_FLEET_ALERTS_CAPTURE";
      const SHIPS = "ZCL_L3_FLEET_SHIPS_CAPTURE";
      const nameOf = (r) => ({set: r.set_name, rule: r.rule_name, hash: r.model_hash, date: r.check_date,
        pile: Number(r.pile_no), seq: Number(r.alert_seq), text: r.alert_text, file: r.rule_file, line: Number(r.rule_line), class: r.rule_class});
      const trimmed = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])));
      const captured = async () => (await abap.Classes[CAPTURE].rows()).array().map((r) => nameOf(Object.fromEntries(
        Object.entries(r.get()).map(([k, v]) => [k, v.get()])))).sort(byKey);
      const shipRows = (rows) => {
        const table = new abap.types.Table(new abap.types.Structure({mandt: new abap.types.Character(3), ship_id: new abap.types.Character(4),
          name: new abap.types.Character(30), status: new abap.types.Character(1)}));
        for (const [id, name, status] of rows) {
          const row = new abap.types.Structure({mandt: new abap.types.Character(3), ship_id: new abap.types.Character(4),
            name: new abap.types.Character(30), status: new abap.types.Character(1)});
          row.get().ship_id.set(id); row.get().name.set(name); row.get().status.set(status);
          table.append(row);
        }
        return table;
      };
      const ships = () => read("SELECT ship_id, name, status FROM zosd_l2_ship ORDER BY ship_id");
      const refusal = async (work) => {
        try { await work(); } catch (e) { return e; }
        return undefined;
      };
      // what a run bound to `bind` leaves in the log, and what the result reports
      const bound = async (bind, mode = "S") => { await clearLog(); return {result: await runSet(RUNNER, mode, bind), log: log()}; };

      it("explicit default bindings are the default run: the same log, the same counts", async () => {
        const plain0 = await bound();
        const named = await bound("ships=table,alerts=log");
        expect(content(named.log)).to.deep.equal(content(plain0.log));
        expect(named.result.alerts).to.equal(7);
        expect(named.result.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
      });

      it("alerts=dummy: the same counts, no log rows", async () => {
        const {result, log: rows} = await bound("alerts=dummy");
        expect(result.alerts).to.equal(7);
        expect(result.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
        expect(result.rules.map((r) => r.alerts).reduce((a, b) => a + b)).to.equal(7);
        expect(rows).to.deep.equal([]);
      });

      it("alerts=capture: the captured rows equal what the log variant writes, and the log stays empty", async () => {
        const want = await bound();
        await abap.Classes[CAPTURE].reset();
        const {result, log: rows} = await bound("alerts=capture");
        expect(rows).to.deep.equal([]);
        expect(result.alerts).to.equal(7);
        const got = await captured();
        expect(got).to.have.length(7);
        // the rows are the log's rows but for the run and its time, which belong to the run
        expect(trimmed(got)).to.deep.equal(trimmed(want.log.map(({run, ts, ...rest}) => rest).sort(byKey)));
      });

      // what a replay must do, and what a refusal must do, as lists of what is wrong
      async function replayProblems(runner = RUNNER) {
        const problems = [];
        const before = ships();
        await clearLog();
        await abap.Classes[SHIPS].reset();
        await abap.Classes[SHIPS].set_rows({it_rows: shipRows([["S002", "Bluebird", "A"], ["S777", "Ghost", "A"]])});
        await runSet(runner, "S", "ships=capture", true);
        const texts = log().map((r) => r.text);
        if (!texts.includes("S777 Ghost: in service without a captain")) problems.push(`the rows given are not seen: ${JSON.stringify(texts)}`);
        const others = texts.filter((t) => /^S00[134]/.test(t));
        if (others.length) problems.push(`rows of the table are seen though the source gave none of them: ${JSON.stringify(others)}`);
        if (JSON.stringify(ships()) !== JSON.stringify(before)) problems.push(`the ships table is not back: ${JSON.stringify(ships())}`);
        return {problems, texts};
      }
      async function refusalProblems() {
        const problems = [];
        await clearLog();
        const before = ships();
        const error = await refusal(() => runSet(RUNNER, "S", "alerts=nope"));
        if (error?.constructor?.name?.toUpperCase() !== "ZCX_L3_FLEET_PORT") problems.push(`no typed refusal for an unknown variant: ${String(error?.message ?? error)}`);
        else if (error.port.get() !== "alerts" || error.variant.get() !== "nope" || !/no such variant/.test(error.reason.get())) problems.push("the refusal does not name the port and the variant");
        if (log().length) problems.push("a refused run wrote the log");
        if (JSON.stringify(ships()) !== JSON.stringify(before)) problems.push("a refused run touched the ships table");
        return problems;
      }

      // a rule that raises in the middle of a replay: the table is restored and the exception propagates
      const BOOM = "zcl_l2_ship_captain_boom";
      async function boomProblems(runner = RUNNER) {
        const problems = [];
        const before = ships();
        await clearLog();
        await abap.Classes[SHIPS].reset();
        await abap.Classes[SHIPS].set_rows({it_rows: shipRows([["S777", "Ghost", "A"]])});
        // one dialog step catches the exception and looks at the table before the step ends: the kernel's
        // rollback of a step that ends in an exception would hide an unrestored table afterwards
        let error, inside;
        await withClass("zcl_l2_ship_captain", BOOM, () => dialogStep(async () => {
          try {
            await abap.Classes[runner.toUpperCase()].run({iv_date: date(), iv_mode: new abap.types.Character(1).set("S"),
              iv_bind: new abap.types.String().set("ships=capture,alerts=dummy"), iv_allow_replay: new abap.types.Character(1).set("X")});
          } catch (e) { error = e; }
          inside = (await client.select({select: "SELECT ship_id FROM zosd_l2_ship"})).rows.length;
        }));
        if (error?.constructor?.name?.toUpperCase() !== "ZCX_L3_FLEET_PORT" || error.reason?.get() !== "boom") problems.push(`the exception did not propagate: ${String(error?.message ?? error)}`);
        if (inside !== before.length) problems.push(`the ships table was left replaced inside the step: ${inside} row(s), ${before.length} expected`);
        if (JSON.stringify(ships()) !== JSON.stringify(before)) problems.push(`the ships table was left replaced: ${JSON.stringify(ships())}`);
        return problems;
      }
      // a replay without the opt-in: refused before anything is touched
      async function optInProblems() {
        const problems = [];
        const before = ships();
        await clearLog();
        await abap.Classes[SHIPS].reset();
        await abap.Classes[SHIPS].set_rows({it_rows: shipRows([["S777", "Ghost", "A"]])});
        const error = await refusal(() => runSet(RUNNER, "S", "ships=capture"));
        if (error?.constructor?.name?.toUpperCase() !== "ZCX_L3_FLEET_PORT" || !/never production/.test(error.reason?.get() ?? "")) problems.push(`no refusal without the opt-in: ${String(error?.message ?? error)}`);
        else if (error.port.get() !== "ships") problems.push("the refusal does not name the source port");
        if (JSON.stringify(ships()) !== JSON.stringify(before)) problems.push("a refused replay touched the ships table");
        if (log().length) problems.push("a refused replay wrote the log");
        if (Number((await abap.Classes[SHIPS].reads()).get()) !== 0) problems.push("a refused replay read the source");
        return problems;
      }

      it("a rule that raises in the middle of a replay: the table is restored and the exception propagates", async () => {
        await loadPortClass("zcl_l2_ship_captain", BOOM, (text) => mutate(text, "  METHOD check.\n",
          "  METHOD check.\n    RAISE EXCEPTION TYPE zcx_l3_fleet_port EXPORTING iv_reason = 'boom'.\n"));
        expect(await boomProblems()).to.deep.equal([]);
      });

      it("a replay without the opt-in is refused, naming the source, and nothing is touched", async () => {
        expect(await optInProblems()).to.deep.equal([]);
        const message = (await refusal(() => runSet(RUNNER, "S", "ships=capture"))).reason.get();
        expect(message).to.equal("a replay swaps table content in the caller LUW; for a test or a dev run only, never production: pass iv_allow_replay");
      });

      it("ships=capture with rows given: the rules see exactly those rows, no table read, and the table comes back", async () => {
        const full = await expected();
        const {problems, texts} = await replayProblems();
        expect(problems).to.deep.equal([]);
        // S002 as the table has it, and S777, which no table holds
        expect(texts.filter((t) => t.startsWith("S002")).sort()).to.deep.equal(full.filter((r) => r.text.startsWith("S002")).map((r) => r.text).sort());
        // read twice: once for the replay, once by the planner
        expect(Number((await abap.Classes[SHIPS].reads()).get())).to.equal(2);
        // and the run after it, bound as before, sees the table again
        expect(content((await bound()).log)).to.deep.equal(content(full));
      });

      it("a variant the port does not have is a typed refusal, before anything is read or written", async () => {
        expect(await refusalProblems()).to.deep.equal([]);
        const port = await refusal(() => runSet(RUNNER, "S", "audit=log"));
        expect(port?.reason?.get()).to.match(/no such port/);
      });

      it("a run in jobs refuses a variant that cannot cross sessions", async () => {
        for (const bind of ["alerts=capture", "alerts=dummy", "ships=capture"]) {
          const error = await refusal(() => runSet(RUNNER, "P", bind));
          expect(error?.constructor?.name?.toUpperCase(), bind).to.equal("ZCX_L3_FLEET_PORT");
        }
      });

      it("the binding travels to the job: the report has p_bind, and submit passes it", () => {
        expect(readFileSync(join(OUT, `${REPORT}.prog.abap`), "utf8")).to.include("PARAMETERS p_bind TYPE c LENGTH 255 LOWER CASE.");
        expect(readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8")).to.include("      WITH p_bind = iv_bind");
      });

      describe("mutants of the ports", () => {
        // what a binding must do, as a list of what is wrong; empty for the generated classes
        async function bindingProblems() {
          const problems = [];
          await clearLog();
          await runSet(RUNNER, "S", "alerts=dummy");
          if (log().length) problems.push(`alerts=dummy wrote ${log().length} log row(s)`);
          await runSet(RUNNER);
          const want = trimmed(log().map(({run, ts, ...rest}) => rest));
          await clearLog();
          await abap.Classes[CAPTURE].reset();
          await runSet(RUNNER, "S", "alerts=capture");
          if (log().length) problems.push(`alerts=capture wrote ${log().length} log row(s)`);
          const got = trimmed(await captured());
          if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`alerts=capture holds ${got.length} row(s), the log variant writes ${want.length}`);
          return problems;
        }

        it("control: the generated classes under their own names pass the binding check", async () => {
          expect(await bindingProblems()).to.deep.equal([]);
        });

        it("a factory that ignores the binding (always the default) is caught", async () => {
          await loadPortClass(PORTS, `${PORTS}_m1`, (text) => mutate(text, "        rv_variant = lv_value.", "        rv_variant = rv_variant."));
          const problems = await withClass(PORTS, `${PORTS}_m1`, bindingProblems);
          expect(problems.join("\n")).to.match(/alerts=dummy wrote 7 log row\(s\)/);
          expect(problems.join("\n")).to.match(/alerts=capture wrote 7 log row\(s\)/);
        });

        it("a dummy sink that writes is caught", async () => {
          await loadPortClass("zcl_l3_fleet_alerts_dummy", "zcl_l3_fleet_alerts_dummy_m1",
            (text) => mutate(text, "    rv_count = lines( it_rows ).", "    MODIFY zosd_l3_alert FROM TABLE it_rows.\n    rv_count = lines( it_rows )."));
          const problems = await withClass("zcl_l3_fleet_alerts_dummy", "zcl_l3_fleet_alerts_dummy_m1", bindingProblems);
          expect(problems.join("\n")).to.match(/alerts=dummy wrote 7 log row\(s\)/);
        });

        it("a runner that never swaps the source in is caught: the rows given are not seen", async () => {
          const name = "zcl_l3_fleet_ns";
          await loadRunner(name, mutate(renamed(name), "        IF zcl_l3_fleet_ports=>swaps( iv_port = 'ships' iv_bind = iv_bind ) = abap_true.", "        IF abap_false = abap_true."));
          const {problems} = await replayProblems(name);
          expect(problems.join("\n")).to.match(/the rows given are not seen/);
          expect((await replayProblems()).problems, "control: the generated runner passes").to.deep.equal([]);
        });

        it("a runner that does not restore on an exception leaves the table replaced when a rule raises: caught", async () => {
          const name = "zcl_l3_fleet_nc";
          const text = renamed(name);
          await loadRunner(name, mutate(text, "      CATCH cx_root INTO lx_error.\n        release( iv_run = rs_result-run_id iv_date = rs_result-check_date ).\n"
            + "        IF lv_swap_1 = abap_true.\n          restore_1( lt_keep_1 ).\n        ENDIF.\n        RAISE EXCEPTION lx_error.\n", ""));
          const problems = await boomProblems(name);
          expect(problems.join("\n")).to.match(/the ships table was left replaced/);
          await exec([...Object.keys({zosd_l2_ship: 1}).map((t) => `DELETE FROM ${t}`),
            ...FLEET.zosd_l2_ship.map((row) => `INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123', '${row.join("', '")}')`)]);
          expect(await boomProblems(), "control: the generated runner passes").to.deep.equal([]);
        });

        it("a factory that ignores the opt-in is caught", async () => {
          await loadPortClass(PORTS, `${PORTS}_m3`, (text) => mutate(text, "IF lv_replay_port IS NOT INITIAL AND iv_allow_replay = abap_false.", "IF lv_replay_port IS NOT INITIAL AND abap_false = abap_true."));
          const problems = await withClass(PORTS, `${PORTS}_m3`, optInProblems);
          expect(problems.join("\n")).to.match(/no refusal without the opt-in/);
          await exec(["DELETE FROM zosd_l2_ship", ...FLEET.zosd_l2_ship.map((row) => `INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123', '${row.join("', '")}')`)]);
        });

        it("a factory that falls back to the default for an unknown variant is caught", async () => {
          await loadPortClass(PORTS, `${PORTS}_m2`, (text) => {
            const at = text.indexOf("METHOD get_alerts.");
            const refuse = "      WHEN OTHERS.\n        RAISE EXCEPTION TYPE zcx_l3_fleet_port\n          EXPORTING iv_port = 'alerts' iv_variant = iv_variant\n                    iv_reason = 'no such variant for the port'.";
            const check = "    IF lv_known = abap_false.\n      RAISE EXCEPTION TYPE zcx_l3_fleet_port\n        EXPORTING iv_port = 'alerts' iv_variant = lv_variant\n                  iv_reason = 'no such variant for the port'.\n    ENDIF.\n";
            expect(text, "the check's refusal").to.include(check);
            const edited = mutate(text.slice(at), refuse, "      WHEN OTHERS.\n        CREATE OBJECT ri_port TYPE zcl_l3_fleet_alerts_log.");
            return mutate(text.slice(0, at), check, "") + edited;
          });
          await withClass(PORTS, `${PORTS}_m2`, async () => {
            expect((await refusalProblems()).join("\n")).to.match(/no typed refusal for an unknown variant/);
          });
        });

        it("a capture sink that drops a row is caught", async () => {
          await loadPortClass("zcl_l3_fleet_alerts_capture", "zcl_l3_fleet_alerts_capture_m1",
            (text) => mutate(text, "    APPEND LINES OF it_rows TO gt_rows.", "    APPEND LINES OF it_rows FROM 2 TO gt_rows."));
          await withClass("zcl_l3_fleet_alerts_capture", "zcl_l3_fleet_alerts_capture_m1", async () => {
            expect((await bindingProblems()).join("\n")).to.match(/alerts=capture holds \d+ row\(s\), the log variant writes 7/);
          });
        });
      });
    });

    // ---- a replay binds generated variants only; validation is data, nothing is created first ----
    describe("hand-written adapters in a run: validated from the manifest's data before any is created", () => {
      const PORTS = "zcl_l3_fleet_ports";
      let handDir;
      const counted = (name) => `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_l3_fleet_${name === "zcl_hand_ships" ? "ships" : "alerts"}.
    CLASS-DATA gv_created TYPE i.
    METHODS constructor.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
  METHOD constructor.
    gv_created = gv_created + 1.
  ENDMETHOD.

  METHOD zif_l3_fleet_${name === "zcl_hand_ships" ? "ships" : "alerts"}~${name === "zcl_hand_ships" ? "read" : "put"}.
${name === "zcl_hand_ships" ? "" : "    rv_count = lines( it_rows ).\n"}  ENDMETHOD.
ENDCLASS.
`;
      const handSources = {"zcl_hand_ships.clas.abap": counted("zcl_hand_ships"), "zcl_hand_alerts.clas.abap": counted("zcl_hand_alerts")};
      // the fleet's factory regenerated from a manifest that also has a hand-written variant on each port,
      // loaded under another name with the two hand classes beside it
      const loadHand = async (name, edit = (t) => t) => {
        if (!handDir) {
          handDir = join(scratch, "hand");
          mkdirSync(handDir);
          for (const [f, t] of Object.entries(handSources)) writeFileSync(join(handDir, f), t);
          const rel = (f) => relative(handDir, join(process.cwd(), OUT, f)).split(sep).join("/");
          writeFileSync(join(handDir, "fleet.l3.yaml"), SET_TEXT.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => `rule: ${rel(f)}`)
            .replace("      table: generated\n      capture: generated\n", "      table: generated\n      capture: generated\n      rship: zcl_hand_ships\n")
            .replace("      dummy: generated\n      capture: generated\n", "      dummy: generated\n      capture: generated\n      remote: zcl_hand_alerts\n"));
          await buildSet(join(handDir, "fleet.l3.yaml"), join(handDir, "out"));
        }
        const text = readFileSync(join(handDir, "out", `${PORTS}.clas.abap`), "utf8").replaceAll(PORTS, name);
        const xml = readFileSync(join(OUT, `${RUNNER}.clas.xml`), "utf8");
        await loadRunner(name, edit(text), {extra: {
          "zcl_hand_ships.clas.abap": handSources["zcl_hand_ships.clas.abap"], "zcl_hand_ships.clas.xml": xml.replace(RUNNER.toUpperCase(), "ZCL_HAND_SHIPS"),
          "zcl_hand_alerts.clas.abap": handSources["zcl_hand_alerts.clas.abap"], "zcl_hand_alerts.clas.xml": xml.replace(RUNNER.toUpperCase(), "ZCL_HAND_ALERTS")}});
      };
      const created = (cls) => Number(abap.Classes[cls].gv_created.get());
      const resetCounts = () => { for (const cls of ["ZCL_HAND_SHIPS", "ZCL_HAND_ALERTS"]) abap.Classes[cls].gv_created.set(0); };
      const ships = () => read("SELECT ship_id FROM zosd_l2_ship ORDER BY ship_id");
      const refusal = async (work) => { try { await work(); } catch (e) { return e; } return undefined; };
      const emptyRows = () => new abap.types.Table(new abap.types.Structure({mandt: new abap.types.Character(3), ship_id: new abap.types.Character(4),
        name: new abap.types.Character(30), status: new abap.types.Character(1)}));

      // a hand-written sink bound in a replay: refused, and its constructor never runs
      async function handSinkProblems(factory) {
        const problems = [];
        resetCounts();
        await abap.Classes.ZCL_L3_FLEET_SHIPS_CAPTURE.reset();
        await abap.Classes.ZCL_L3_FLEET_SHIPS_CAPTURE.set_rows({it_rows: (() => {
          const rows = emptyRows();
          rows.append(new abap.types.Structure({mandt: new abap.types.Character(3).set("123"), ship_id: new abap.types.Character(4).set("S003"),
            name: new abap.types.Character(30).set("Condor"), status: new abap.types.Character(1).set("A")}));
          return rows;
        })()});
        const before = ships();
        const error = await withClass(PORTS, factory, () => refusal(() => runSet(RUNNER, "S", "ships=capture,alerts=remote", true)));
        if (error?.constructor?.name?.toUpperCase() !== "ZCX_L3_FLEET_PORT" || !/generated variants only/.test(error.reason?.get() ?? "")) problems.push(`no refusal of a hand-written sink in a replay: ${String(error?.reason?.get?.() ?? error?.message ?? error)}`);
        if (created("ZCL_HAND_ALERTS")) problems.push(`the hand-written sink was created ${created("ZCL_HAND_ALERTS")} time(s)`);
        if (JSON.stringify(ships()) !== JSON.stringify(before)) problems.push("the ships table was touched");
        return problems;
      }
      // an unknown variant on a later port is refused before an earlier port's adapter is created
      async function laterPortProblems(factory) {
        const problems = [];
        resetCounts();
        const error = await withClass(PORTS, factory, () => refusal(() => runSet(RUNNER, "S", "ships=rship,alerts=nope")));
        if (error?.constructor?.name?.toUpperCase() !== "ZCX_L3_FLEET_PORT" || error.port?.get() !== "alerts" || !/no such variant/.test(error.reason?.get() ?? "")) problems.push(`no refusal for the unknown variant on the later port: ${String(error?.reason?.get?.() ?? error?.message ?? error)}`);
        if (created("ZCL_HAND_SHIPS")) problems.push(`the earlier port's hand-written source was created ${created("ZCL_HAND_SHIPS")} time(s) before the refusal`);
        return problems;
      }

      it("control: the hand-written adapters are bound and created in a run that is not a replay", async () => {
        await loadHand(`${PORTS}_h0`);
        resetCounts();
        await clearLog();
        const result = await withClass(PORTS, `${PORTS}_h0`, () => runSet(RUNNER, "S", "alerts=remote"));
        expect(result.alerts).to.equal(7);
        expect(result.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("DONE"));
        expect(created("ZCL_HAND_ALERTS"), "the sink was created and used").to.be.at.least(1);
        expect(log(), "its put( ) wrote nothing").to.deep.equal([]);
      });

      it("a hand-written alerts sink bound in a replay is refused, and its constructor never runs", async () => {
        expect(await handSinkProblems(`${PORTS}_h0`)).to.deep.equal([]);
      });

      it("an unknown binding on a later port is refused before an earlier port's adapter is created", async () => {
        expect(await laterPortProblems(`${PORTS}_h0`)).to.deep.equal([]);
      });

      it("mutant: a factory that lets a hand-written variant into a replay is caught", async () => {
        await loadHand(`${PORTS}_h0`);
        expect(await handSinkProblems(`${PORTS}_h0`), "control").to.deep.equal([]);
        await loadHand(`${PORTS}_h1`, (t) => mutate(t, "    IF lv_replay_port IS NOT INITIAL AND lv_hand_port IS NOT INITIAL.", "    IF abap_false = abap_true."));
        const problems = await handSinkProblems(`${PORTS}_h1`);
        expect(problems.join("\n")).to.match(/the hand-written sink was created \d+ time/);
      });

      it("mutant: a check that creates the earlier port's adapter before it validates the later one is caught", async () => {
        await loadHand(`${PORTS}_h2`, (t) => mutate(t, "  METHOD check.\n", "  METHOD check.\n    get_ships( variant( iv_port = 'ships' iv_bind = iv_bind ) ).\n"));
        const problems = await laterPortProblems(`${PORTS}_h2`);
        expect(problems.join("\n")).to.match(/the earlier port's hand-written source was created 1 time/);
        expect(await laterPortProblems(`${PORTS}_h0`), "control").to.deep.equal([]);
      });
    });

    describe("a replay source that swaps the table: a mutant that never restores it is caught", () => {
      it("the check 'the table is back' fails for a runner that skips the restore", async () => {
        const name = "zcl_l3_fleet_pr";
        const text = renamed(name);
        await loadRunner(name, mutate(text, "  METHOD restore_1.\n    DELETE FROM zosd_l2_ship.\n    INSERT zosd_l2_ship FROM TABLE it_keep.\n", "  METHOD restore_1.\n"));
        const before = read("SELECT ship_id FROM zosd_l2_ship ORDER BY ship_id");
        await abap.Classes.ZCL_L3_FLEET_SHIPS_CAPTURE.reset();
        const rows = new abap.types.Table(new abap.types.Structure({mandt: new abap.types.Character(3), ship_id: new abap.types.Character(4),
          name: new abap.types.Character(30), status: new abap.types.Character(1)}));
        await abap.Classes.ZCL_L3_FLEET_SHIPS_CAPTURE.set_rows({it_rows: rows});
        try {
          await runSet(name, "S", "ships=capture,alerts=dummy", true);
          expect(read("SELECT ship_id FROM zosd_l2_ship ORDER BY ship_id"), "the mutant leaves the table as the source had it").to.deep.equal([]);
        } finally {
          await exec([...FLEET.zosd_l2_ship.map((row) => `INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123', '${row.join("', '")}')`)]);
        }
        expect(before.length).to.equal(4);
      });
    });

    describe("a changed rule", () => {
      it("adds rows under its new model hash and keeps the old version's rows", async () => {
        await clearLog();
        const first = await runSet(RUNNER);
        const old = log();
        const dir = join(scratch, "changed");
        mkdirSync(dir, {recursive: true});
        const rule = join(dir, "voyage_v2.l2.yaml");
        writeFileSync(rule, readFileSync(join(OUT, "ship_voyage_limit.l2.yaml"), "utf8")
          .replace(/^class: .*$/m, "class: zcl_l2_voyage_v2").replaceAll(" future voyages", " voyages ahead"));
        const built = await buildRule(rule, dir);
        const manifest = join(dir, "fleet_v2.l3.yaml");
        const rel = (f) => relative(dir, join(process.cwd(), OUT, f)).split(sep).join("/");
        writeFileSync(manifest, SET_TEXT.replace("set: fleet", "set: fleet\nclass: zcl_l3_fleet_v2\nreport: zl3_fleet_v2")
          .replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => `rule: ${rel(f)}`)
          .replace(`rule: ${rel("ship_voyage_limit.l2.yaml")}`, "rule: voyage_v2.l2.yaml"));
        const {model: v2} = await buildSet(manifest, dir);
        const newHash = v2.rules.find((r) => r.name === "ship-too-many-future-voyages").hash;
        const oldHash = model.rules.find((r) => r.name === "ship-too-many-future-voyages").hash;
        expect(newHash).to.not.equal(oldHash);
        await loadRunner("zcl_l3_fleet_v2", readFileSync(join(dir, "zcl_l3_fleet_v2.clas.abap"), "utf8"), {out: dir,
          extra: {"zcl_l2_voyage_v2.clas.abap": built.files["zcl_l2_voyage_v2.clas.abap"], "zcl_l2_voyage_v2.clas.xml": built.files["zcl_l2_voyage_v2.clas.xml"]}});
        const second = await runSet("zcl_l3_fleet_v2");
        const rows = log();
        const voyage = rows.filter((r) => r.rule === "ship-too-many-future-voyages");
        expect(voyage.map((r) => [r.hash, r.text, r.run])).to.deep.equal([
          [oldHash, "S002 Bluebird: 3 future voyages", first.run],
          [newHash, "S002 Bluebird: 3 voyages ahead", second.run],
        ].sort((a, b) => a[0].localeCompare(b[0])));
        // the other rules did not change: their rows are rewritten in place
        const others = (list) => content(list.filter((r) => r.rule !== "ship-too-many-future-voyages"));
        expect(others(rows)).to.deep.equal(others(old));
        expect(rows.filter((r) => r.rule !== "ship-too-many-future-voyages").every((r) => r.run === second.run)).to.equal(true);
      });
    });

    describe("explain", () => {
      it("walks an alert of the log to its rule line and the check lines that trace to it", async () => {
        await clearLog();
        await runSet(RUNNER);
        const row = log().find((r) => r.rule === "ship-too-many-future-voyages");
        const key = `${row.set}/${row.rule}/${row.hash}/${row.date}/${row.pile}/${row.seq}`;
        const {text, ruleLine, generated, runnerLines} = await explainAlert(key, {sets: [SET], row: {...row, alert_text: row.text, run_id: row.run, run_ts: row.ts, rule_line: row.line}});
        const ruleText = readFileSync(join(OUT, "ship_voyage_limit.l2.yaml"), "utf8").split("\n");
        expect(ruleLine).to.equal(ruleText.findIndex((l) => /^alert:/.test(l)) + 1);
        expect(row.line).to.equal(ruleLine);
        const trace = JSON.parse(readFileSync(join(OUT, "zcl_l2_ship_voyage_limit.clas.trace.json"), "utf8"));
        expect(generated).to.deep.equal(trace.lines.filter((l) => l.rule_line === ruleLine).map((l) => l.line));
        expect(generated.length).to.be.at.least(1);
        expect(runnerLines.length).to.be.at.least(8);
        expect(text).to.include(`line    src/l2demo/ship_voyage_limit.l2.yaml:${ruleLine}: alert:`);
        expect(text).to.include("text    S002 Bluebird: 3 future voyages");
        expect(text).to.include(`set     src/l2demo/fleet.l3.yaml:${setLine(/- rule: ship_voyage_limit/)}:`);
      });

      it("the command reads the alert row from the database file", async () => {
        await clearLog();
        await runSet(RUNNER);
        const row = log().find((r) => r.rule === "ship-cargo-limit");
        expect(row.pile).to.equal(2);
        const run = spawnSync(process.execPath, ["tools/dsl-l3.mjs", "explain", `fleet/ship-cargo-limit/${row.hash.slice(7, 19)}/${DATE}/2/${row.seq}`, "--db", dbPath], {encoding: "utf8"});
        expect(run.status, run.stderr).to.equal(0);
        expect(run.stdout).to.include("text    S003: 1100.50 kg booked");
        expect(run.stdout).to.match(/line {4}src\/l2demo\/ship_cargo_limit\.l2\.yaml:10: alert:/);
        expect(run.stdout).to.match(/pile {4}2 of the plan, 2 keys of ship_id per pile \(src\/l2demo\/fleet\.l3\.yaml:\d+\), range I BT S003 S004, DONE/);
        // the five-part key of before piles is pile 0: no row of this run is there
        const old = spawnSync(process.execPath, ["tools/dsl-l3.mjs", "explain", `fleet/ship-cargo-limit/${row.hash.slice(7, 19)}/${DATE}/${row.seq}`, "--db", dbPath], {encoding: "utf8"});
        expect(old.status, old.stderr).to.equal(0);
        expect(old.stdout).to.match(/^alert {3}fleet\/ship-cargo-limit\/sha256:[0-9a-f]{12}\.\.\.\/20261001\/0\/1$/m);
        expect(old.stdout).to.not.include("text    ");
      });

      it("an alert key names its pile; the five-part key of before piles is pile 0", () => {
        expect(parseAlertKey(`fleet/r/${"ab".repeat(4)}/20261001/3/2`)).to.include({pile: 3, seq: 2});
        expect(parseAlertKey(`fleet/r/${"ab".repeat(4)}/20261001/2`)).to.include({pile: 0, seq: 2});
        expect(() => parseAlertKey(`fleet/r/${"ab".repeat(4)}/20261001/x/2`)).to.throw(/pile x is a non-negative number/);
        expect(() => parseAlertKey(`fleet/r/${"ab".repeat(4)}/20261001/1/2/3`)).to.throw(/an alert key is <set>\/<rule>\/<model hash>\/<check date>\/<pile>\/<seq>/);
      });

      it("a hash no version of the rule carried is refused", async () => {
        let error;
        try { await explainAlert(`fleet/ship-cargo-limit/${"ab".repeat(32)}/${DATE}/1`, {sets: [SET]}); } catch (e) { error = e; }
        expect(error?.message).to.match(/no version with model hash/);
        expect(() => parseAlertKey("fleet/x")).to.throw(/an alert key is/);
      });

      it("an earlier version of a rule is found in git history", async function () {
        const sidecar = join(OUT, "zcl_l2_maintenance_ship.clas.trace.json");
        const current = JSON.parse(readFileSync(sidecar, "utf8")).model;
        const history = spawnSync("git", ["log", "-p", "--format=", "--", sidecar], {encoding: "utf8", maxBuffer: 256 * 1024 * 1024});
        const older = [...new Set([...history.stdout.matchAll(/^[-+] "model": "(sha256:[0-9a-f]{64})"/gm)].map((m) => m[1]))].find((h) => h !== current);
        if (!older) this.skip(); // a shallow clone has no earlier version to find
        const {text, version} = await explainAlert(`fleet/maintenance-ship-no-future-voyage/${older}/${DATE}/1`, {sets: [SET]});
        expect(version).to.match(/^commit [0-9a-f]{12}$/);
        expect(text).to.include("src/l2demo/maintenance_ship.l2.yaml:");
      });
    });
  });
});
