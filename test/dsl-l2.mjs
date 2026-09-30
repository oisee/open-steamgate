// DSL L2, slice 1 (docs/dsl-l2.md): a rule compiled to L1, rendered to ABAP,
// proven by its own examples. The committed class is what a fresh build
// makes; its generated test class runs green; the same rule with one
// operator changed makes an example fail, so the examples test the rule;
// type errors name the rule file and line; the trace reaches the rule line.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DEFAULT_DDIC, registryFor} from "../tools/dsl-ddic.mjs";
import {buildRule, checkRule, compileRule, RuleError} from "../tools/dsl-l2.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {UnitRun} from "../tools/osd-unit.mjs";

const RULE = "src/l2demo/maintenance_ship.l2.yaml";
const OUT = "src/l2demo";
const CLASS = "zcl_l2_maintenance_ship";
const RULE_TEXT = readFileSync(RULE, "utf8");
const ruleLine = (re) => RULE_TEXT.split("\n").findIndex((l) => re.test(l)) + 1;

describe("DSL L2 slice 1: a rule, its generated check and its examples", function () {
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
      const source = readFileSync("tools/dsl-l2.mjs", "utf8");
      const hits = source.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /ship|voy/i.test(l));
      expect(hits, "tools/dsl-l2.mjs names the demo's domain").to.deep.equal([]);
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
      const e = entry(/AND dep_date > iv_date$/);
      expect(e).to.include({node: "rule/maintenance-ship-no-future-voyage/forbid/where/2", rule_line: ruleLine(/^\s+where:/)});
    });

    it("the alert text traces to the rule's alert line", () => {
      const e = entry(/`: in maintenance, voyage `/);
      expect(e.node).to.match(/\/alert\/text\/\d+$/);
      expect(e.rule_line).to.equal(ruleLine(/^alert:/));
    });
  });

  describe("the examples prove the rule", () => {
    it("ABAP Unit of the generated test class runs green in this runtime", async () => {
      const result = await new UnitRun(new ObjectStore()).runDetached("CLAS", CLASS.toUpperCase());
      const methods = result.testClasses.flatMap((c) => c.testMethods);
      expect(methods.map((m) => m.name)).to.deep.equal(["FLAGGED", "PAST_VOYAGE_IS_FINE", "DEPARTS_ON_THE_CHECK_DATE",
        "SHIP_IN_SERVICE_IS_FINE", "ONE_ALERT_PER_VOYAGE"]);
      expect(result.counts, JSON.stringify(result.testClasses)).to.include({methods: 5, passed: 5, failed: 0});
      expect(result.ok).to.equal(true);
    });

    // A rule copy is built under its own class name, transpiled alone and run
    // in this process: which examples fail says what the examples prove.
    async function runVariant(file, className) {
      const out = join(scratch, basename(file, ".l2.yaml"));
      const {model} = await buildRule(file, out, {registry});
      expect(model.class).to.equal(className);
      const {Transpiler, core} = modulesOf(process.cwd());
      const reg = new core.Registry();
      for (const f of readdirSync(out).filter((f) => /\.clas\.(abap|testclasses\.abap|xml)$/.test(f))) {
        reg.addFile(new core.MemoryFile(f, readFileSync(join(out, f), "utf8")));
      }
      for (const f of ["zosd_l2_ship.tabl.xml", "zosd_l2_voy.tabl.xml"]) reg.addFile(new core.MemoryFile(f, readFileSync(join(OUT, f), "utf8")));
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
      const module = await import(pathToFileURL(join(out, `${className}.clas.testclasses.mjs`)).href);
      const results = {};
      for (const method of model.examples.map((e) => e.method)) {
        const test = await new module.ltcl_examples().constructor_();
        try {
          await test.FRIENDS_ACCESS_INSTANCE[method]();
          results[method] = "passed";
        } catch (error) {
          results[method] = "failed";
        } finally {
          await test.FRIENDS_ACCESS_INSTANCE.teardown();
        }
      }
      return results;
    }

    before(async () => {
      await import("./start.mjs");
    });

    it("the rule as written: every example passes", async () => {
      const file = variant("as_written", "class: zcl_l2_maintenance_ship", "class: zcl_l2_as_written");
      expect(Object.values(await runVariant(file, "zcl_l2_as_written"))).to.deep.equal(Array(5).fill("passed"));
    });

    it("> changed to >= in the rule: the example on the check date fails", async () => {
      const file = variant("mutant", "class: zcl_l2_maintenance_ship", "class: zcl_l2_mutant");
      writeFileSync(file, readFileSync(file, "utf8").replace("voy.dep_date > $date", "voy.dep_date >= $date"));
      expect(await runVariant(file, "zcl_l2_mutant")).to.deep.equal({
        flagged: "passed", past_voyage_is_fine: "passed", departs_on_the_check_date: "failed",
        ship_in_service_is_fine: "passed", one_alert_per_voyage: "passed",
      });
    });
  });
});
