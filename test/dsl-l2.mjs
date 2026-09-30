// DSL L2, slices 1 and 2 (docs/dsl-l2.md): a rule compiled to L1, rendered to
// ABAP as one query, proven by its own examples and by cases derived from its
// conditions, each run against the nested reference form. The committed class
// is what a fresh build makes; its generated test class runs green; the same
// rule with one operator changed in the ABAP makes derived cases fail, so the
// cases test the rule; type errors name the rule file and line; the trace
// reaches the rule line.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DEFAULT_DDIC, registryFor} from "../tools/dsl-ddic.mjs";
import {buildRule, checkRule, compileRule, describeCases, evaluate, misfit, RuleError, stepValue} from "../tools/dsl-l2.mjs";
import {bump, compareValues} from "../tools/dsl-l2-eval.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {UnitRun} from "../tools/osd-unit.mjs";

const RULE = "src/l2demo/maintenance_ship.l2.yaml";
const OUT = "src/l2demo";
const CLASS = "zcl_l2_maintenance_ship";
const RULE_TEXT = readFileSync(RULE, "utf8");
const DERIVED = ["B_STATUS_EQ", "B_STATUS_NE", "B_STATUS_BLANK", "B_SHIP_ID_MATCH", "B_SHIP_ID_NOMATCH",
  "B_DEP_DATE_LT", "B_DEP_DATE_EQ", "B_DEP_DATE_GT", "B_EXISTS_ZERO", "B_EXISTS_TWO"];
const ruleLine = (re) => RULE_TEXT.split("\n").findIndex((l) => re.test(l)) + 1;

describe("DSL L2: a rule, its generated check, its examples and its derived cases", function () {
  this.timeout(180000);
  let scratch, registry;
  before(() => {
    scratch = mkdtempSync(join(tmpdir(), "dsl-l2-test-"));
    registry = registryFor(DEFAULT_DDIC, []);
  });
  after(() => rmSync(scratch, {recursive: true, force: true}));

  // a copy of the committed rule with one line replaced
  const variant = (name, from, to) => {
    expect(RULE_TEXT, `the rule has ${from}`).to.include(from);
    const file = join(scratch, `${name}.l2.yaml`);
    writeFileSync(file, RULE_TEXT.replace(from, to));
    return file;
  };

  describe("generation", () => {
    it("the committed files are a fresh build (the check command exits 0)", () => {
      const run = spawnSync(process.execPath, ["tools/dsl-l2.mjs", "check", RULE, "--out", OUT], {encoding: "utf8"});
      expect(run.status, run.stdout + run.stderr).to.equal(0);
      expect(run.stdout).to.contain("generated files match");
    });

    it("and the check notices one changed byte", async () => {
      const copy = join(scratch, "drift");
      mkdirSync(copy);
      for (const f of readdirSync(OUT).filter((f) => f.startsWith(`${CLASS}.`))) copyFileSync(join(OUT, f), join(copy, f));
      const file = join(copy, `${CLASS}.clas.abap`);
      writeFileSync(file, readFileSync(file, "utf8").replace("> iv_date", ">= iv_date"));
      expect(await checkRule(RULE, copy)).to.deep.equal([`${CLASS}.clas.abap: differs from a fresh build`]);
    });

    it("the compiler knows no domain words", () => {
      for (const file of ["tools/dsl-l2.mjs", "tools/dsl-l2-eval.mjs"]) {
        const source = readFileSync(file, "utf8");
        const hits = source.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /ship|voy/i.test(l));
        expect(hits, `${file} names the demo's domain`).to.deep.equal([]);
      }
    });
  });

  describe("type errors name the rule file and line", () => {
    const cases = [
      ["a date compared with a CHAR literal", "voy.dep_date > $date", "voy.dep_date > 'M'",
        /^voy\.dep_date is DATS 8; 'M' is not a date/, /^\s+where:/],
      ["a CHAR literal longer than its field", "ship.status = 'M'", "ship.status = 'MM'",
        /^ship.status is CHAR 1; 'MM' is 2 characters, longer than CHAR 1/, /^when:/],
      ["an unknown field", "ship.status = 'M'", "ship.colour = 'M'",
        /^ZOSD_L2_SHIP has no field COLOUR/, /^when:/],
      ["an unknown table", "for: ZOSD_L2_SHIP as ship", "for: ZOSD_L2_NOPE as ship",
        /^table ZOSD_L2_NOPE is not in the DDIC given/, /^for:/],
      ["a hole naming an undeclared alias", "{ship.name}", "{crew.name}",
        /^unknown alias crew/, /^alert:/],
      ["an alias out of scope in when", "when: ship.status = 'M'", "when: voy.ship_id = 'S001'",
        /^alias voy is not in scope here/, /^when:/],
      ["a comparison without an operator", "ship.status = 'M'", "ship.status 'M'",
        /^expected a comparison operator/, /^when:/],
      ["an example row value that does not fit", "{ship_id: S001, name: Albatross, status: M}]\n      ZOSD_L2_VOY: [{voyage_id: V00001",
        "{ship_id: S001, name: Albatross, status: MX}]\n      ZOSD_L2_VOY: [{voyage_id: V00001",
        /^ZOSD_L2_SHIP-STATUS is CHAR 1; 'MX' is 2 characters/, /^\s+ZOSD_L2_SHIP: \[\{ship_id: S001/],
    ];
    cases.forEach(([what, from, to, message, at], i) => {
      it(what, () => {
        const file = variant(`error${i}`, from, to);
        const where = relative(process.cwd(), file).split(sep).join("/");
        const line = readFileSync(file, "utf8").split("\n").findIndex((l) => at.test(l)) + 1;
        let error;
        try {
          compileRule(file, {registry});
        } catch (e) {
          error = e;
        }
        expect(error, "an error").to.be.instanceOf(RuleError);
        expect(error.message.startsWith(`${where}:${line}: `), error.message).to.equal(true);
        expect(error.message.slice(`${where}:${line}: `.length)).to.match(message);
      });
    });
  });

  describe("a rule carries its proof", () => {
    const refused = (name, text, message, at) => {
      const file = join(scratch, `${name}.l2.yaml`);
      writeFileSync(file, text);
      const where = relative(process.cwd(), file).split(sep).join("/");
      const line = text.split("\n").findIndex((l) => at.test(l)) + 1;
      expect(() => compileRule(file, {registry})).to.throw(RuleError, new RegExp(`^${where.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:${line}: ${message}`));
    };
    const head = RULE_TEXT.slice(0, RULE_TEXT.indexOf("examples:"));

    it("no examples key", () => refused("no-examples", head, "a rule needs examples", /^rule:/));
    it("an empty list of examples", () => refused("empty-examples", `${head}examples: []\n`, "a rule needs at least one example", /^examples:/));
    it("an example without expect", () => {
      const from = "    expect: []\n  - name: departs on the check date";
      expect(RULE_TEXT).to.include(from);
      refused("no-expect", RULE_TEXT.replace(from, "  - name: departs on the check date"),
        "example \"past voyage is fine\" has no expect", /^\s+- name: past voyage is fine/);
    });
  });

  describe("the rule's header and its boundaries", () => {
    const refused = (name, from, to, message, at) => {
      const file = variant(name, from, to);
      const where = relative(process.cwd(), file).split(sep).join("/");
      const text = readFileSync(file, "utf8");
      const line = text.split("\n").findIndex((l) => at.test(l)) + 1;
      let error;
      try {
        compileRule(file, {registry});
      } catch (e) {
        error = e;
      }
      expect(error, "an error").to.be.instanceOf(RuleError);
      expect(error.message.startsWith(`${where}:${line}: `), error.message).to.equal(true);
      expect(error.message.slice(`${where}:${line}: `.length)).to.match(message);
    };

    it("a class that is not text is a RuleError at its line", () =>
      refused("class-list", "class: zcl_l2_maintenance_ship", "class: [zcl_a, zcl_b]", /^class must be a class name/, /^class:/));
    it("a class mapping too", () =>
      refused("class-map", "class: zcl_l2_maintenance_ship", "class: {name: zcl_a}", /^class must be a class name/, /^class:/));
    it("a title over several lines is a RuleError at its line", () =>
      refused("title-lines", "title: A ship in maintenance has no voyage departing after the check date",
        "title: |\n  A ship in maintenance\n  has no voyage", /^title must be one line/, /^title:/));
    it("boundaries names a condition that is not there", () =>
      refused("boundaries-unknown", "boundaries: auto", "boundaries: [when/1, when/9]",
        /^boundaries names "when\/9", which is not a condition of the rule \(when\/1, forbid\/where\/1, forbid\/where\/2\)/, /^boundaries:/));
    it("boundaries is auto or a list", () =>
      refused("boundaries-word", "boundaries: auto", "boundaries: sometimes", /^boundaries is auto or a list of conditions/, /^boundaries:/));

    it("a list selects: two conditions give their own cases and the structural two", () => {
      const file = variant("boundaries-list", "boundaries: auto", "boundaries: [when/1, forbid/where/2]");
      const model = compileRule(file, {registry});
      expect(model.cases.map((c) => c.method)).to.deep.equal(["b_status_eq", "b_status_ne", "b_status_blank",
        "b_dep_date_lt", "b_dep_date_eq", "b_dep_date_gt", "b_exists_zero", "b_exists_two"]);
    });

    it("without boundaries there are the examples only", () => {
      const file = variant("no-boundaries", "boundaries: auto\n", "");
      const model = compileRule(file, {registry});
      expect(model.cases).to.deep.equal([]);
    });
  });

  describe("trace", () => {
    const abap = readFileSync(join(OUT, `${CLASS}.clas.abap`), "utf8").split("\n");
    const trace = JSON.parse(readFileSync(join(OUT, `${CLASS}.clas.trace.json`), "utf8"));
    const entry = (re) => {
      const line = abap.findIndex((l) => re.test(l)) + 1;
      expect(line, `a line matching ${re}`).to.be.greaterThan(0);
      return trace.lines.find((e) => e.line === line);
    };

    it("every output line goes to a template line, an L1 node and a rule line", () => {
      expect(trace.lines.length).to.equal(abap.length - 1);
      for (const e of trace.lines) {
        expect(e.template_line, JSON.stringify(e)).to.be.greaterThan(0);
        expect(e.node, JSON.stringify(e)).to.match(/^rule\/maintenance-ship-no-future-voyage/);
        expect(e.rule_line, JSON.stringify(e)).to.be.greaterThan(0);
      }
    });

    it("the dep_date condition traces to the rule's where line", () => {
      const e = entry(/AND voy~dep_date > iv_date$/);
      expect(e).to.include({node: "rule/maintenance-ship-no-future-voyage/forbid/where/2", rule_line: ruleLine(/^\s+where:/)});
    });

    it("the JOIN's ON and WHERE lines trace to their conditions and rule lines", () => {
      expect(entry(/ON voy~ship_id = ship~ship_id$/)).to.include({
        node: "rule/maintenance-ship-no-future-voyage/forbid/where/1", rule_line: ruleLine(/^\s+where:/)});
      expect(entry(/WHERE ship~status = 'M'$/)).to.include({
        node: "rule/maintenance-ship-no-future-voyage/when/1", rule_line: ruleLine(/^when:/)});
      expect(entry(/INNER JOIN zosd_l2_voy AS voy$/)).to.include({rule_line: ruleLine(/^forbid:/)});
    });

    it("the alert text traces to the rule's alert line", () => {
      const e = entry(/`: in maintenance, voyage `/);
      expect(e.node).to.match(/\/alert\/text\/\d+$/);
      expect(e.rule_line).to.equal(ruleLine(/^alert:/));
    });
  });

  describe("trace of the test class", () => {
    const abap = readFileSync(join(OUT, `${CLASS}.clas.testclasses.abap`), "utf8").split("\n");
    const trace = JSON.parse(readFileSync(join(OUT, `${CLASS}.clas.testclasses.trace.json`), "utf8"));
    const ruleLineOf = (re) => {
      const line = abap.findIndex((l) => re.test(l)) + 1;
      expect(line, `a line matching ${re}`).to.be.greaterThan(0);
      return trace.lines.find((e) => e.line === line).rule_line;
    };

    it("each example's check call traces to that example's date line", () => {
      const calls = abap.map((l, i) => [i + 1, l]).filter(([, l]) => /=>check\( iv_date = '\d{8}' \)/.test(l));
      const dates = RULE_TEXT.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /^\s+date: /.test(l));
      const names = [...RULE_TEXT.matchAll(/- name: (.+)/g)].map((m) => m[1]);
      expect(calls.length).to.equal(15);
      expect(dates.length).to.equal(5);
      calls.slice(0, 5).forEach(([line], k) => {
        expect(trace.lines.find((e) => e.line === line)).to.include({
          node: `rule/maintenance-ship-no-future-voyage/example/${names[k]}/date`, rule_line: dates[k][0]});
      });
    });

    it("each derived case traces to the rule line of its condition", () => {
      const at = (re) => {
        const line = abap.findIndex((l) => re.test(l)) + 1;
        expect(line, `a line matching ${re}`).to.be.greaterThan(0);
        return trace.lines.find((e) => e.line === line);
      };
      const lines = {status: ruleLine(/^when:/), where: ruleLine(/^\s+where:/), exists: ruleLine(/^\s+exists:/)};
      for (const [method, rule_line] of [["b_status_eq", lines.status], ["b_status_blank", lines.status],
        ["b_ship_id_nomatch", lines.where], ["b_dep_date_eq", lines.where], ["b_exists_zero", lines.exists], ["b_exists_two", lines.exists]]) {
        expect(at(new RegExp(`^  METHOD ${method}\\.$`))).to.include({rule_line});
        expect(at(new RegExp(`^    METHODS ${method} FOR TESTING\\.$`))).to.include({rule_line});
      }
      expect(at(/^  METHOD b_dep_date_eq\.$/).node).to.equal("rule/maintenance-ship-no-future-voyage/case/b_dep_date_eq");
    });

    it("a table's declaration and teardown trace to where the table enters the rule", () => {
      const forLine = ruleLine(/^for:/), existsLine = ruleLine(/^\s+exists:/);
      expect(ruleLineOf(/DATA mt_zosd_l2_ship TYPE/)).to.equal(forLine);
      expect(ruleLineOf(/DELETE zosd_l2_ship FROM TABLE/)).to.equal(forLine);
      expect(ruleLineOf(/DATA mt_zosd_l2_voy TYPE/)).to.equal(existsLine);
      expect(ruleLineOf(/DELETE zosd_l2_voy FROM TABLE/)).to.equal(existsLine);
    });
  });

  // two fixture tables of integer and packed fields, built into a DDIC folder of
  // the test's own (nothing of it is in the system's tree)
  const dtel = (name, type, length, decimals) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DD04V><ROLLNAME>${name}</ROLLNAME><DATATYPE>${type}</DATATYPE><LENG>${String(length).padStart(6, "0")}</LENG><DECIMALS>${String(decimals).padStart(6, "0")}</DECIMALS></DD04V></asx:values></asx:abap>
</abapGit>
`;
  const field = (name, inner) => `<DD03P><FIELDNAME>${name}</FIELDNAME>${inner}</DD03P>`;
  const tableXml = (name, fields) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V><TABNAME>${name}</TABNAME><DDLANGUAGE>E</DDLANGUAGE><TABCLASS>TRANSP</TABCLASS><CLIDEP>X</CLIDEP></DD02V>
   <DD03P_TABLE>${[
    field("MANDT", "<KEYFLAG>X</KEYFLAG><ROLLNAME>MANDT</ROLLNAME><NOTNULL>X</NOTNULL><COMPTYPE>E</COMPTYPE>"),
    ...fields,
  ].join("")}</DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;
  const key = (name) => field(name, "<KEYFLAG>X</KEYFLAG><INTTYPE>C</INTTYPE><INTLEN>000008</INTLEN><NOTNULL>X</NOTNULL><DATATYPE>CHAR</DATATYPE><LENG>000004</LENG>");
  const keyInt = (name) => field(name, "<KEYFLAG>X</KEYFLAG><ROLLNAME>ZOSD_L2_T_I1</ROLLNAME><NOTNULL>X</NOTNULL><COMPTYPE>E</COMPTYPE>");
  const elem = (name, rollname) => field(name, `<ROLLNAME>${rollname}</ROLLNAME><COMPTYPE>E</COMPTYPE>`);
  const FIXTURE = {
    "zosd_l2_numa.tabl.xml": tableXml("ZOSD_L2_NUMA", [key("ID"), elem("LVL", "ZOSD_L2_T_I1")]),
    "zosd_l2_numb.tabl.xml": tableXml("ZOSD_L2_NUMB", [key("ID"), keyInt("SEQ"), elem("AMT", "ZOSD_L2_T_DEC"), elem("CNT", "ZOSD_L2_T_I1")]),
    "zosd_l2_t_i1.dtel.xml": dtel("ZOSD_L2_T_I1", "INT1", 3, 0),
    "zosd_l2_t_dec.dtel.xml": dtel("ZOSD_L2_T_DEC", "DEC", 5, 2),
  };
  const fixtureDdic = () => {
    const ddic = join(scratch, "num-ddic");
    mkdirSync(ddic, {recursive: true});
    for (const [name, text] of Object.entries(FIXTURE)) writeFileSync(join(ddic, name), text);
    return ddic;
  };

  describe("integer ranges and packed precision (fixture tables)", () => {
    const RULE_NUM = `rule: numeric-fixture
class: zcl_l2_numeric_fixture
title: numeric fixture
for: ZOSD_L2_NUMA as n
when: n.lvl = 3
forbid:
  exists: ZOSD_L2_NUMB as m
  where: m.id = n.id and m.amt > 12.5
alert: "{n.id} {m.amt}"
examples:
  - name: one
    date: 20261001
    rows:
      ZOSD_L2_NUMA: [{id: A001, lvl: 3}]
      ZOSD_L2_NUMB: [{id: A001, seq: 1, amt: 999.99, cnt: 0}]
    expect: ["A001 999.99"]
`;
    let numRegistry;
    before(() => {
      numRegistry = registryFor([fixtureDdic(), ".local/lars/open-abap-core/src"], []);
    });
    const numRule = (name, from, to) => {
      expect(RULE_NUM).to.include(from);
      const file = join(scratch, `${name}.l2.yaml`);
      writeFileSync(file, RULE_NUM.replace(from, to));
      return file;
    };

    it("the fixture rule compiles, with the DDIC types on its literals", () => {
      const model = compileRule(numRule("num-ok", "", ""), {registry: numRegistry});
      expect(model.when.conditions[0]["value@type"]).to.deep.equal({built_in: "INT1"});
      expect(model.forbid.conditions[1]["value@type"]).to.deep.equal({built_in: "DEC", length: 5, decimals: 2});
    });

    const cases = [
      ["INT1 above 255", "n.lvl = 3", "n.lvl = 256", /^n\.lvl is INT1; 256 is out of range for INT1/, /^when:/],
      ["INT1 below 0", "n.lvl = 3", "n.lvl = -1", /^n\.lvl is INT1; -1 is out of range for INT1/, /^when:/],
      ["DEC 5,2 with four integer digits", "m.amt > 12.5", "m.amt > 1000", /^m\.amt is DEC 5,2; 1000 exceeds the precision of DEC 5,2/, /^\s+where:/],
      ["DEC 5,2 with three decimals", "m.amt > 12.5", "m.amt > 1.234", /^m\.amt is DEC 5,2; 1\.234 exceeds the precision of DEC 5,2/, /^\s+where:/],
      ["an example row out of INT1 range", "lvl: 3}", "lvl: 300}", /^ZOSD_L2_NUMA-LVL is INT1; 300 is out of range/, /^\s+ZOSD_L2_NUMA: \[/],
      ["an example row beyond DEC precision", "amt: 999.99", "amt: 1000.00", /^ZOSD_L2_NUMB-AMT is DEC 5,2; 1000\.00 exceeds the precision/, /^\s+ZOSD_L2_NUMB: \[/],
      ["the same table for and exists", "exists: ZOSD_L2_NUMB as m", "exists: ZOSD_L2_NUMA as m", /^for and exists are both ZOSD_L2_NUMA/, /^\s+exists:/],
    ];
    cases.forEach(([what, from, to, message, at], i) => {
      it(what, () => {
        const file = numRule(`num${i}`, from, to);
        const where = relative(process.cwd(), file).split(sep).join("/");
        const line = readFileSync(file, "utf8").split("\n").findIndex((l) => at.test(l)) + 1;
        let error;
        try {
          compileRule(file, {registry: numRegistry});
        } catch (e) {
          error = e;
        }
        expect(error, "an error").to.be.instanceOf(RuleError);
        expect(error.message.startsWith(`${where}:${line}: `), error.message).to.equal(true);
        expect(error.message.slice(`${where}:${line}: `.length)).to.match(message);
      });
    });
  });

  describe("the compiler's literal check agrees with the engine's literal filter", () => {
    const long = (n, c = "a") => c.repeat(n);
    const BOUNDARIES = [
      [{built_in: "INT1"}, ["0", "255", "256", "-0", "-1", "007", "1.5", "", "x"]],
      [{built_in: "INT2"}, ["32767", "32768", "-32768", "-32769"]],
      [{built_in: "INT4"}, ["2147483647", "2147483648", "-2147483648", "-2147483649", "00002147483647"]],
      [{built_in: "INT8"}, ["9223372036854775807", "9223372036854775808", "-9223372036854775808", "-9223372036854775809"]],
      [{built_in: "DEC", length: 5, decimals: 2}, ["999.99", "1000", "-999.99", "0.12", "0.123", "00123.45", "12.30", "1e3", "", "12."]],
      [{built_in: "DEC", length: 2, decimals: 2}, ["0.12", "1.2", "0", "00.99"]],
      [{built_in: "QUAN", length: 3, decimals: 0}, ["999", "1000", "1.0"]],
      [{built_in: "CHAR", length: 3}, ["abc", "abcd", "", "a'b"]],
      [{built_in: "CHAR", length: 300}, [long(255), long(256), long(128, "'"), long(127, "'")]],
      [{built_in: "NUMC", length: 4}, ["0012", "12a", "", "12345"]],
      [{built_in: "DATS", length: 8}, ["20261001", "2026100", "2026100a"]],
      [{built_in: "TIMS", length: 6}, ["235959", "23595"]],
      [{built_in: "STRG"}, ["x", long(255), long(256), long(128, "`"), "a\nb", "a\rb"]],
      [{built_in: "SSTR", length: 3}, ["abc", "abcd"]],
      [{built_in: "RAW", length: 2}, ["0a1b", "0a1", "0a1b2c", "zz", ""]],
    ];

    it("accepts and refuses the same boundary values", async () => {
      await import("./start.mjs");
      await import("../output/zcl_osd_tpl.clas.mjs");
      await import("../output/zcl_ajson.clas.mjs");
      const abap = globalThis.abap;
      const box = (value) => new abap.types.String().set(value);
      const disagreements = [];
      let count = 0;
      for (const [type, values] of BOUNDARIES) {
        for (const value of values) {
          const json = await abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify({v: value, "v@type": type}))});
          let engine = true;
          try {
            await abap.Classes.ZCL_OSD_TPL.render({iv_template: box("{{v | literal}}"), ii_data: json});
          } catch (error) {
            if (!error.text?.get) throw error;
            engine = false;
          }
          const compiler = misfit(value, type) === undefined;
          count++;
          if (engine !== compiler) disagreements.push(`${JSON.stringify(type)} ${JSON.stringify(value)}: engine ${engine}, compiler ${compiler}`);
        }
      }
      expect(count).to.be.greaterThan(60);
      expect(disagreements).to.deep.equal([]);
    });
  });

  // A rule copy is built under its own class name, its generated files edited
  // as `mutate` says ({"clas.abap": [[from, to]]}; an edit that finds nothing
  // fails the test), transpiled alone and run in this process: which methods
  // fail, and with what message, says what the tests prove. `fixture` names
  // tables that are not in the system: their DDIC files and CREATE TABLE.
  async function runRule(file, className, {ruleRegistry = registry, tables = ["zosd_l2_ship.tabl.xml", "zosd_l2_voy.tabl.xml"],
    tableDir = OUT, fixture = false, mutate = {}} = {}) {
    const out = join(scratch, basename(file, ".l2.yaml"));
    const {model} = await buildRule(file, out, {registry: ruleRegistry});
    expect(model.class).to.equal(className);
    for (const [suffix, edits] of Object.entries(mutate)) {
      const target = join(out, `${className}.${suffix}`);
      let text = readFileSync(target, "utf8");
      for (const [from, to] of edits) {
        expect(text, `${suffix} holds ${from}`).to.include(from);
        text = text.replace(from, to);
      }
      writeFileSync(target, text);
    }
    const {Transpiler, core} = modulesOf(process.cwd());
    const reg = new core.Registry();
    for (const f of readdirSync(out).filter((f) => /\.clas\.(abap|testclasses\.abap|xml)$/.test(f))) {
      reg.addFile(new core.MemoryFile(f, readFileSync(join(out, f), "utf8")));
    }
    for (const f of tables) reg.addFile(new core.MemoryFile(f, readFileSync(join(tableDir, f), "utf8")));
    for (const p of ["ddic/dtel/mandt.dtel.xml", "ddic/ttyp/string_table.ttyp.xml"]) {
      reg.addDependency(new core.MemoryFile(basename(p), readFileSync(join(".local/lars/open-abap-core/src", p), "utf8")));
    }
    const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
    const output = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: []}).run(reg);
    const own = new Set(output.objects.map((o) => o.filename));
    const outputDir = pathToFileURL(join(process.cwd(), "output") + sep).href;
    for (const o of output.objects.filter((o) => o.object.type === "CLAS")) {
      // what the class does not bring itself comes from the built system
      const code = o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (m, name) => own.has(name) ? m : `import("${outputDir}${name}")`);
      writeFileSync(join(out, o.filename), code);
    }
    const db = globalThis.abap.context.databaseConnections.DEFAULT;
    const created = [];
    if (fixture) {
      for (const statement of output.databaseSetup.schemas.sqlite) {
        const name = /CREATE TABLE\s+'?(\w+)/i.exec(statement)?.[1];
        if (name) { await db.execute(statement); created.push(name); }
      }
    }
    try {
      const module = await import(pathToFileURL(join(out, `${className}.clas.testclasses.mjs`)).href);
      const results = {}, messages = {};
      for (const method of [...model.examples, ...model.cases].map((e) => e.method)) {
        const test = await new module.ltcl_examples().constructor_();
        try {
          await test.FRIENDS_ACCESS_INSTANCE[method]();
          results[method] = "passed";
        } catch (error) {
          results[method] = "failed";
          messages[method] = `${error?.msg?.get?.() ?? error?.message ?? error}\n${error?.stack ?? ""}`;
        } finally {
          await test.FRIENDS_ACCESS_INSTANCE.teardown();
        }
      }
      return {model, results, messages};
    } finally {
      for (const name of created) await db.execute(`DROP TABLE '${name}'`);
    }
  }
  const failed = (results) => Object.entries(results).filter(([, r]) => r === "failed").map(([m]) => m).sort();


  // The mutants change the rule in the ABAP -- the query and the reference
  // alike -- and leave the expectations as the unmutated rule derived them:
  // a rule file edited instead would change the interpreter's answers too.
  const mutateBoth = (from, to) => ({"clas.abap": [[from, to]], "clas.testclasses.abap": [[from.replace(/^\w+~/, ""), to.replace(/^\w+~/, "")]]});


  describe("the examples and the derived cases prove the rule", () => {
    it("ABAP Unit of the generated test class runs green in this runtime", async () => {
      const result = await new UnitRun(new ObjectStore()).runDetached("CLAS", CLASS.toUpperCase());
      const methods = result.testClasses.flatMap((c) => c.testMethods);
      expect(methods.map((m) => m.name)).to.deep.equal(["FLAGGED", "PAST_VOYAGE_IS_FINE", "DEPARTS_ON_THE_CHECK_DATE",
        "SHIP_IN_SERVICE_IS_FINE", "ONE_ALERT_PER_VOYAGE", ...DERIVED]);
      expect(result.counts, JSON.stringify(result.testClasses)).to.include({methods: 15, passed: 15, failed: 0});
      expect(result.ok).to.equal(true);
    });

    before(async () => {
      await import("./start.mjs");
    });

    it("the rule as written: every example and every derived case passes", async () => {
      const file = variant("as_written", "class: zcl_l2_maintenance_ship", "class: zcl_l2_as_written");
      const {results} = await runRule(file, "zcl_l2_as_written");
      expect(Object.keys(results)).to.have.length(15);
      expect(failed(results)).to.deep.equal([]);
    });

    it("> changed to >= : the derived case on the check date fails, and so does the written example", async () => {
      const file = variant("mutant_ge", "class: zcl_l2_maintenance_ship", "class: zcl_l2_mutant_ge");
      const {results} = await runRule(file, "zcl_l2_mutant_ge", {mutate: mutateBoth("voy~dep_date > iv_date", "voy~dep_date >= iv_date")});
      expect(failed(results)).to.deep.equal(["b_dep_date_eq", "departs_on_the_check_date"]);
    });

    it("> changed to >= : with the hand-written boundary example removed, the derived case alone catches it", async () => {
      const text = RULE_TEXT.replace("class: zcl_l2_maintenance_ship", "class: zcl_l2_mutant_alone");
      const from = text.indexOf("  - name: departs on the check date");
      const to = text.indexOf("  - name: ship in service is fine");
      expect(from).to.be.greaterThan(0);
      expect(to).to.be.greaterThan(from);
      const file = join(scratch, "mutant_alone.l2.yaml");
      writeFileSync(file, text.slice(0, from) + text.slice(to));
      const {model, results} = await runRule(file, "zcl_l2_mutant_alone", {mutate: mutateBoth("voy~dep_date > iv_date", "voy~dep_date >= iv_date")});
      expect(model.examples.map((e) => e.method)).to.not.include("departs_on_the_check_date");
      expect(failed(results)).to.deep.equal(["b_dep_date_eq"]);
    });

    it("status = 'M' changed to <> : derived cases fail", async () => {
      const file = variant("mutant_ne", "class: zcl_l2_maintenance_ship", "class: zcl_l2_mutant_ne");
      const {results} = await runRule(file, "zcl_l2_mutant_ne", {mutate: mutateBoth("ship~status = 'M'", "ship~status <> 'M'")});
      const red = failed(results);
      for (const method of ["b_status_eq", "b_status_ne", "b_status_blank"]) expect(red, `${method} in ${red}`).to.include(method);
      expect(red.filter((m) => m.startsWith("b_")).length).to.be.greaterThan(3);
    });

    it("a JOIN that lost its ON equality is caught by the comparison with check_reference", async () => {
      const file = variant("mutant_join", "class: zcl_l2_maintenance_ship", "class: zcl_l2_mutant_join");
      const {results, messages} = await runRule(file, "zcl_l2_mutant_join", {
        mutate: {"clas.abap": [["ON voy~ship_id = ship~ship_id", "ON ship~ship_id = ship~ship_id"]]}});
      const red = failed(results);
      expect(red).to.include("one_alert_per_voyage");
      expect(red).to.include("b_ship_id_nomatch");
      for (const method of red) expect(messages[method], method).to.include("assert_same_as_reference");
    });
  });

  describe("one query instead of a SELECT per row", () => {
    const db = () => globalThis.abap.context.databaseConnections.DEFAULT;
    const insert = async (table, columns, values) => {
      const mandt = globalThis.abap.builtin.sy.get().mandt.get();
      await db().execute(`INSERT INTO ${table} (mandt, ${columns.join(", ")}) VALUES ('${mandt}', ${values.map((v) => `'${v}'`).join(", ")})`);
    };
    before(async () => {
      await import("./start.mjs");
      await import(`../output/${CLASS}.clas.mjs`);
      await import(`../output/${CLASS}.clas.testclasses.mjs`);
    });

    it("check makes one database call whatever the number of for rows; check_reference makes 1 + n", async () => {
      const abap = globalThis.abap;
      const n = 6;
      try {
        for (let i = 1; i <= n; i++) {
          await insert("zosd_l2_ship", ["ship_id", "name", "status"], [`Q${i}`, `Ship ${i}`, "M"]);
          await insert("zosd_l2_voy", ["voyage_id", "ship_id", "dep_date"], [`QV${i}`, `Q${i}`, "20261005"]);
        }
        const counted = async (run) => {
          const original = db().select.bind(db());
          let calls = 0;
          db().select = async (options) => { calls++; return original(options); };
          try {
            return {alerts: (await run()).array().map((a) => a.get()), calls};
          } finally {
            db().select = original;
          }
        };
        const date = new abap.types.Date().set("20261001");
        const joined = await counted(() => abap.Classes.ZCL_L2_MAINTENANCE_SHIP.check({iv_date: date}));
        const test = await new (await import(`../output/${CLASS}.clas.testclasses.mjs`)).ltcl_examples().constructor_();
        const nested = await counted(() => test.FRIENDS_ACCESS_INSTANCE.check_reference({iv_date: date}));
        expect(joined.alerts).to.have.length(n);
        expect(joined.calls, "one SELECT").to.equal(1);
        expect(nested.calls, "1 + n SELECTs").to.equal(1 + n);
        expect(nested.alerts).to.deep.equal(joined.alerts);
      } finally {
        await db().execute("DELETE FROM zosd_l2_voy");
        await db().execute("DELETE FROM zosd_l2_ship");
      }
    });
  });

  describe("the interpreter", () => {
    const rowsOfNode = (test) => Object.fromEntries(test.tables.map((t) => [t.table,
      t.rows.map((r) => Object.fromEntries(r.fields.map((f) => [f.column, f.value])))]));

    it("agrees with the committed examples and with its own derived cases", () => {
      const model = compileRule(RULE, {registry});
      expect(model.examples).to.have.length(5);
      expect(model.cases).to.have.length(10);
      for (const t of [...model.examples, ...model.cases]) {
        const got = evaluate(model, rowsOfNode(t), {date: t.date.value});
        expect(got.sort(), t.method).to.deep.equal(t.expect.map((e) => e.value).sort());
      }
    });

    it("a wrong hand-written expect fails the build with the example's line", () => {
      const from = '    expect: []\n  - name: departs on the check date';
      expect(RULE_TEXT).to.include(from);
      const file = join(scratch, "wrong-expect.l2.yaml");
      const text = RULE_TEXT.replace(from, '    expect: ["nothing like this"]\n  - name: departs on the check date');
      writeFileSync(file, text);
      const where = relative(process.cwd(), file).split(sep).join("/");
      const line = text.split("\n").findIndex((l) => /expect: \["nothing like this"\]/.test(l)) + 1;
      expect(() => compileRule(file, {registry})).to.throw(RuleError, new RegExp(`^${where.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:${line}: example "past voyage is fine" expects \\["nothing like this"\\] but the rule gives \\[\\]`));
    });

    it("a wrong rule is found against the examples as well: > written as >= with the examples kept", () => {
      const file = variant("wrong-rule", "voy.dep_date > $date", "voy.dep_date >= $date");
      expect(() => compileRule(file, {registry})).to.throw(RuleError, /example "departs on the check date" expects \[\] but the rule gives \["S001 Albatross/);
    });

    describe("DDIC stepping", () => {
      const DATS = {built_in: "DATS", length: 8};
      it("DATS over a month end, a year end and 29 February, and back", () => {
        const steps = [["20260930", 1, "20261001"], ["20261001", -1, "20260930"], ["20261231", 1, "20270101"], ["20270101", -1, "20261231"],
          ["20260228", 1, "20260301"], ["20240228", 1, "20240229"], ["20240229", 1, "20240301"], ["20240301", -1, "20240229"],
          ["20000228", 1, "20000229"], ["20000301", -1, "20000229"], ["19000228", 1, "19000301"], ["19000301", -1, "19000228"],
          ["20260131", 1, "20260201"], ["20260301", -1, "20260228"]];
        for (const [from, dir, to] of steps) expect(stepValue(DATS, from, dir), `${from} ${dir}`).to.equal(to);
      });
      it("DATS refuses what is not a date and what leaves the range", () => {
        for (const [from, dir] of [["20260231", 1], ["20261301", 1], ["00000000", 1], ["99991231", 1], ["00010101", -1], ["2026", 1]]) {
          expect(stepValue(DATS, from, dir), `${from} ${dir}`).to.equal(undefined);
        }
      });
      it("TIMS by the second, NUMC and INT by one, each refusing its edge", () => {
        const TIMS = {built_in: "TIMS", length: 6}, NUMC = {built_in: "NUMC", length: 3};
        expect(stepValue(TIMS, "235958", 1)).to.equal("235959");
        expect(stepValue(TIMS, "235959", 1)).to.equal(undefined);
        expect(stepValue(TIMS, "000000", -1)).to.equal(undefined);
        expect(stepValue(TIMS, "115959", 1)).to.equal("120000");
        expect(stepValue(NUMC, "009", 1)).to.equal("010");
        expect(stepValue(NUMC, "999", 1)).to.equal(undefined);
        expect(stepValue(NUMC, "000", -1)).to.equal(undefined);
        expect(stepValue({built_in: "INT1"}, "255", 1)).to.equal(undefined);
        expect(stepValue({built_in: "INT1"}, "0", -1)).to.equal(undefined);
        expect(stepValue({built_in: "INT4"}, "-1", -1)).to.equal("-2");
      });
      it("DEC steps by 10^-decimals, carrying over, and stays inside its precision", () => {
        const DEC2 = {built_in: "DEC", length: 5, decimals: 2}, DEC0 = {built_in: "DEC", length: 3, decimals: 0};
        expect(stepValue(DEC2, "12.50", 1)).to.equal("12.51");
        expect(stepValue(DEC2, "12.50", -1)).to.equal("12.49");
        expect(stepValue(DEC2, "12.99", 1)).to.equal("13.00");
        expect(stepValue(DEC2, "0.00", -1)).to.equal("-0.01");
        expect(stepValue(DEC2, "999.99", 1)).to.equal(undefined);
        expect(stepValue(DEC0, "41", 1)).to.equal("42");
      });
      it("CHAR compares without its trailing blanks; a blank is initial; a different value has the same length", () => {
        const CHAR = {built_in: "CHAR", length: 4};
        expect(compareValues(CHAR, "AB  ", CHAR, "AB")).to.equal(0);
        expect(compareValues(CHAR, "", CHAR, "  ")).to.equal(0);
        expect(compareValues(CHAR, "AB", CHAR, "AC")).to.equal(-1);
        expect(bump("M", 1)).to.equal("N");
        expect(bump("M", -1)).to.equal("L");
        expect(bump("AZ", -1)).to.equal("AY");
        expect(bump("", 1)).to.equal("A");
      });
    });

    it("the derived cases of the demo name, in the reviewer's view, every case and its expected alerts", () => {
      const text = describeCases(compileRule(RULE, {registry}));
      expect(text).to.contain("10 derived case(s)");
      expect(text).to.match(/b_dep_date_eq .*\n  date 20261001\n(.*\n)*.*dep_date="20261001"\n  expect: no alert/);
      expect(text).to.match(/b_status_blank .*\n(.*\n)*.*status=""/);
      const run = spawnSync(process.execPath, ["tools/dsl-l2.mjs", "cases", RULE], {encoding: "utf8"});
      expect(run.status, run.stderr).to.equal(0);
      expect(run.stdout.trim()).to.equal(text.trim());
    });
  });

  describe("the interpreter and the ABAP agree on INT and DEC fields (a synthetic rule)", () => {
    const RULE_AGREE = `rule: numeric-agreement
class: zcl_l2_numeric_agreement
title: a synthetic rule over integer and packed fields
for: ZOSD_L2_NUMA as n
when: n.lvl >= 3 and n.lvl <> 7
forbid:
  exists: ZOSD_L2_NUMB as m
  where: m.id = n.id and m.amt <= 12.5 and m.cnt < n.lvl
alert: "{n.id} {n.lvl} {m.seq} {m.cnt}"
boundaries: auto
examples:
  - name: fires
    date: 20261001
    rows:
      ZOSD_L2_NUMA: [{id: A001, lvl: 5}]
      ZOSD_L2_NUMB: [{id: A001, seq: 1, amt: 10.50, cnt: 2}]
    expect: ["A001 5 1 2"]
`;
    let ruleRegistry, file;
    before(async () => {
      await import("./start.mjs");
      ruleRegistry = registryFor([fixtureDdic(), ".local/lars/open-abap-core/src"], []);
      file = join(scratch, "agree.l2.yaml");
      writeFileSync(file, RULE_AGREE);
    });

    it("derives lt, eq and gt for <=, >=, <> and a field comparison, match and nomatch for the join, two structural cases", () => {
      const model = compileRule(file, {registry: ruleRegistry});
      const by = Object.fromEntries(model.cases.map((c) => [c.method, c]));
      expect(Object.keys(by)).to.deep.equal([
        "b_lvl_lt", "b_lvl_eq", "b_lvl_gt", "b_n_lvl_lt", "b_n_lvl_eq", "b_n_lvl_gt", "b_id_match", "b_id_nomatch",
        "b_amt_lt", "b_amt_eq", "b_amt_gt", "b_cnt_lt", "b_cnt_eq", "b_cnt_gt", "b_exists_zero", "b_exists_two"]);
      const value = (method, table, column) => by[method].tables.find((t) => t.table === table).rows[0].fields.find((f) => f.column === column).value;
      expect(["b_lvl_lt", "b_lvl_eq", "b_lvl_gt"].map((m) => value(m, "zosd_l2_numa", "lvl"))).to.deep.equal(["2", "3", "4"]);
      expect(["b_n_lvl_lt", "b_n_lvl_eq", "b_n_lvl_gt"].map((m) => value(m, "zosd_l2_numa", "lvl"))).to.deep.equal(["6", "7", "8"]);
      expect(["b_amt_lt", "b_amt_eq", "b_amt_gt"].map((m) => value(m, "zosd_l2_numb", "amt"))).to.deep.equal(["12.49", "12.50", "12.51"]);
      expect(by.b_lvl_lt.expect).to.deep.equal([]);
      expect(by.b_amt_gt.expect).to.deep.equal([]);
      expect(by.b_amt_eq.expect.map((e) => e.value)).to.deep.equal(["A001 5 1 2"]);
      expect(by.b_exists_two.expect).to.have.length(2);
    });

    it("every generated case passes in ABAP with the interpreter's alerts (<=, >=, <> included)", async () => {
      const {model, results, messages} = await runRule(file, "zcl_l2_numeric_agreement",
        {ruleRegistry, tables: ["zosd_l2_numa.tabl.xml", "zosd_l2_numb.tabl.xml", "zosd_l2_t_i1.dtel.xml", "zosd_l2_t_dec.dtel.xml"],
          tableDir: join(scratch, "num-ddic"), fixture: true});
      expect(model.cases).to.have.length(16);
      expect(Object.keys(results)).to.have.length(17);
      expect(failed(results), JSON.stringify(messages)).to.deep.equal([]);
    });

    it("and it notices a mutated comparison: <= changed to < fails the eq case", async () => {
      // its own class name: a module of the same path would come out of the import cache
      const mutant = join(scratch, "agree_mut.l2.yaml");
      writeFileSync(mutant, RULE_AGREE.replace("zcl_l2_numeric_agreement", "zcl_l2_numeric_mutant"));
      const {results} = await runRule(mutant, "zcl_l2_numeric_mutant",
        {ruleRegistry, tables: ["zosd_l2_numa.tabl.xml", "zosd_l2_numb.tabl.xml", "zosd_l2_t_i1.dtel.xml", "zosd_l2_t_dec.dtel.xml"],
          tableDir: join(scratch, "num-ddic"), fixture: true,
          mutate: mutateBoth("m~amt <= '12.5'", "m~amt < '12.5'")});
      expect(failed(results)).to.deep.equal(["b_amt_eq"]);
    });

    it("and <> changed to = fails the eq case of the integer comparison", async () => {
      const mutant = join(scratch, "agree_mut2.l2.yaml");
      writeFileSync(mutant, RULE_AGREE.replace("zcl_l2_numeric_agreement", "zcl_l2_numeric_mutant2"));
      const {results} = await runRule(mutant, "zcl_l2_numeric_mutant2",
        {ruleRegistry, tables: ["zosd_l2_numa.tabl.xml", "zosd_l2_numb.tabl.xml", "zosd_l2_t_i1.dtel.xml", "zosd_l2_t_dec.dtel.xml"],
          tableDir: join(scratch, "num-ddic"), fixture: true,
          mutate: mutateBoth("n~lvl <> 7", "n~lvl = 7")});
      const red = failed(results);
      expect(red).to.include("b_n_lvl_eq");
      expect(red).to.include("fires");
    });
  });
});
