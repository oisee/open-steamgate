// DSL L3, slice 3b (docs/dsl-l3.md, "Stages, filters and a schedule"): a set
// in ordered stages. A filter stage's rules (L2 keys: true) fill a worklist,
// ZOSD_L3_WORK, and a later stage piles over that worklist only; stage n+1
// opens through a gate row of ZOSD_L3_STAGE once every pile of stage n is
// DONE (in mode S in the step, in mode P by the job that ends the stage); a
// schedule runs the set as a periodic background job on the facade's clock.
// The manifest's refusals at their lines, the trace, the runs on a file
// database, and each mutant of the slice against the test that names it.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, explainAlert, renderSet, SetError, unitFindings} from "../tools/dsl-l3.mjs";
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

// the fleet of test/dsl-l3.mjs: S001 in maintenance with a voyage ahead and a
// pilot aboard, S002 active with three voyages ahead and one crew member, S003
// active with no voyage, no crew and 1100.50 kg booked, S004 active with a
// past voyage. The filter selects S001 and S002; S003's cargo alert is a
// stage 2 alert of a ship the filter left out.
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
const TABLES = ["zosd_l3_budget", "zosd_l3_event", "zosd_l3_object", "zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_stage", "zosd_l3_work", "zosd_l3_doctor", "zosd_l3_kill",
  "zosd_l3_conf", "zosd_l3_conf_log", "zosd_l3_run_conf"];

describe("DSL L3 slice 3b: stages, a filter stage with a worklist, a schedule", function () {
  this.timeout(900000);
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), "dsl-l3-stages-")); });
  after(() => rmSync(scratch, {recursive: true, force: true}));

  describe("the manifest", () => {
    it("the committed runner, report, ports and worklist variant are a fresh build", async () => {
      expect(await checkSet(SET, OUT)).to.deep.equal([]);
    });

    it("two stages: a filter filling worklist busy, then the checks piled over it; job names carry the stage", () => {
      const model = compileSet(SET);
      expect(model.stages.map((s) => [s.no, s.name, Boolean(s.filter), s.worklist?.name, s.piles?.source.name, s.piles?.over_worklist?.name, s.piles?.size]))
        .to.deep.equal([["1", "candidates", true, "busy", "ships", undefined, "2"], ["2", "checks", false, undefined, "ships", "busy", "2"]]);
      expect(model.rules.map((r) => [r.name, r.stage_no, Boolean(r.filter), Boolean(r.piled), r.jobname])).to.deep.equal([
        ["ship-busy", "1", true, true, "L3_FLEET2_101"], ["maintenance-ship-no-future-voyage", "2", false, true, "L3_FLEET2_202"],
        ["grounded-ship-keeps-only-keepers", "2", false, true, "L3_FLEET2_203"], ["ship-in-service-has-a-captain", "2", false, true, "L3_FLEET2_204"],
        ["ship-too-many-future-voyages", "2", false, true, "L3_FLEET2_205"], ["ship-min-crew", "2", false, true, "L3_FLEET2_206"],
        ["ship-cargo-limit", "2", false, true, "L3_FLEET2_207"]]);
      expect(model.ports.find((p) => p.name === "ships").variants.map((v) => v.name)).to.deep.equal(["table", "capture", "worklist"]);
      expect(model.schedule).to.include({every: "1d", count: "1", field: "prddays", driver: "L3_FLEET2_D", at: "020000"});
    });

    it("a set without stages: renders what the templates render with every section of slice 3b taken out", async () => {
      // the sections of this slice, and `planned` as it was: `piles`; and slice 5a's (test/dsl-l3-resilience.mjs)
      const NEW = ["staged", "stages", "schedule", "with_worklist", "planner", "resilience", "fused", "killable"];
      const before = (template) => {
        let text = readFileSync(template, "utf8");
        for (const n of NEW) {
          text = text.replace(new RegExp(`^\\{\\{#${n}\\}\\}\\n[\\s\\S]*?^\\{\\{/${n}\\}\\}\\n`, "gm"), "")
            .replace(new RegExp(`\\{\\{#${n}\\}\\}[^\\n]*?\\{\\{/${n}\\}\\}`, "g"), "");
        }
        return text.replace(/^\{\{\^staged\}\}\n([\s\S]*?)^\{\{\/staged\}\}\n/gm, "$1").replace(/\{\{([#^/])planned\}\}/g, "{{$1piles}}");
      };
      const {renderRecipe} = await import("../tools/dsl-abap.mjs");
      const model = compileSet(ONE);
      expect([model.stages, model.staged, model.schedule]).to.deep.equal([undefined, undefined, undefined]);
      const {files} = await renderSet(model);
      for (const [template, out] of [["recipes/l3-set/template.tpl", `${model.class}.clas.abap`], ["recipes/l3-job/template.tpl", `${model.report}.prog.abap`],
        ["recipes/l3-ports/factory.tpl", `${model.ports_class}.clas.abap`]]) {
        const stripped = join(scratch, `before-${basename(dirname(template))}-${basename(template)}`);
        writeFileSync(stripped, before(template));
        expect(readFileSync(stripped, "utf8"), template).to.not.match(/\bstages?\b|worklist|\bschedule\b|advance|zosd_l3_(work|stage)/i);
        expect(files[out], out).to.equal((await renderRecipe(model, stripped)).text);
        expect(readFileSync(join(OUT, out), "utf8"), `${out} is committed as it was`).to.equal(files[out]);
      }
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
      const file = join(dir, "fleet2.l3.yaml");
      writeFileSync(file, text);
      return file;
    };
    const refusedAt = (file, message, at, nth = 0) => {
      const line = readFileSync(file, "utf8").split("\n").map((l, i) => (at.test(l) ? i + 1 : 0)).filter(Boolean)[nth] ?? 0;
      expect(line, `a line matches ${at}`).to.be.greaterThan(0);
      let error;
      try { compileSet(file); } catch (e) { error = e; }
      expect(error, "refused").to.be.instanceOf(SetError);
      expect(error.message.slice(where(file).length), error.message).to.match(new RegExp(`^:${line}: ${message.source}`));
    };
    const STAGE2 = '  - stage: checks\n    piles: {source: "worklist:busy", size: 2}\n';

    it("a filter stage whose rule has no keys: true, at the rule's line", () => refusedAt(manifest("nokeys",
      [["      - rule: ship_busy.l2.yaml\n", "      - rule: ship_busy.l2.yaml\n      - rule: ship_max_cargo.l2.yaml\n"]]),
    /rule ship-max-cargo is in filter stage candidates and has no keys: true/, /rule: .*ship_max_cargo/));
    it("a worklist used before it is filled", () => refusedAt(manifest("before", [['source: "worklist:busy"', 'source: "worklist:idle"']]),
      /worklist idle is used before it is filled: no filter stage before stage checks fills it/, /worklist:idle/));
    // a rule copied under another name and class, built beside a set in `dir`
    const ruleCopy = async (dir, from, file, edits = []) => {
      const {buildRule} = await import("../tools/dsl-l2.mjs");
      mkdirSync(dir, {recursive: true});
      let text = readFileSync(join(OUT, from), "utf8").replace(/^class: .*$/m, `class: zcl_l2_${basename(file, ".l2.yaml")}`)
        .replace(/^rule: (.*)$/m, (m, r) => `rule: ${r}-${basename(file, ".l2.yaml").replaceAll("_", "-")}`);
      for (const [a, b] of edits) text = text.replace(a, b);
      writeFileSync(join(dir, file), text);
      await buildRule(join(dir, file), dir);
    };
    it("a worklist filled twice", async () => {
      await ruleCopy(join(scratch, "twice"), "ship_busy.l2.yaml", "busy_too.l2.yaml");
      const file = manifest("twice", [[STAGE2, "  - stage: again\n    filter: true\n    worklist: busy\n    rules:\n      - rule: XTOO\n" + STAGE2]]);
      writeFileSync(file, readFileSync(file, "utf8").replace("XTOO", "busy_too.l2.yaml"));
      refusedAt(file, /worklist busy is filled twice: by stage candidates and by stage again/, /^    worklist: busy$/, 1);
    });
    it("a worklist whose key does not sort as text (an INT4), at the worklist line", async () => {
      // a fleet keyed by an INT4 number: the worklist compares KEY_VALUE as text, where 10 sorts before 5
      const dir = join(scratch, "intkey");
      mkdirSync(dir, {recursive: true});
      const tabl = (name, fields) => readFileSync("src/dsl/zosd_l3_stage.tabl.xml", "utf8").replaceAll("ZOSD_L3_STAGE", name)
        .replace(/<DD03P_TABLE>[\s\S]*<\/DD03P_TABLE>/, `<DD03P_TABLE>\n${fields.join("")}   </DD03P_TABLE>`);
      const f = (name, type, leng, key = false) => `    <DD03P><FIELDNAME>${name}</FIELDNAME>${key ? "<KEYFLAG>X</KEYFLAG>" : ""}`
        + (type === "MANDT" ? "<ROLLNAME>MANDT</ROLLNAME><COMPTYPE>E</COMPTYPE>" : `<INTTYPE>${type === "INT4" ? "X" : "C"}</INTTYPE><DATATYPE>${type}</DATATYPE><LENG>${String(leng).padStart(6, "0")}</LENG>`)
        + "<ADMINFIELD>0</ADMINFIELD></DD03P>\n";
      writeFileSync(join(dir, "zt_intship.tabl.xml"), tabl("ZT_INTSHIP", [f("MANDT", "MANDT", 3, true), f("SHIP_NO", "INT4", 10, true), f("STATUS", "CHAR", 1)]));
      writeFileSync(join(dir, "zt_intvoy.tabl.xml"), tabl("ZT_INTVOY", [f("MANDT", "MANDT", 3, true), f("VOY_ID", "CHAR", 6, true), f("SHIP_NO", "INT4", 10)]));
      writeFileSync(join(dir, "int_busy.l2.yaml"), ["rule: int-busy", "class: zcl_l2_int_busy", "title: A ship with a voyage", "for: ZT_INTSHIP as ship",
        "range: ship.ship_no", "keys: true", "when: ship.status = 'A'", "forbid:", "  exists: ZT_INTVOY as voy", "  where: voy.ship_no = ship.ship_no",
        'alert: "{ship.ship_no}"', "examples:", "  - name: one", "    date: 20261001", "    rows:", "      ZT_INTSHIP: [{ship_no: '5', status: A}]",
        "      ZT_INTVOY: [{voy_id: V1, ship_no: '5'}]", "    expect: ['5']", ""].join("\n"));
      const ddic = [...(await import("../tools/dsl-ddic.mjs")).DEFAULT_DDIC, dir];
      const {buildRule} = await import("../tools/dsl-l2.mjs");
      await buildRule(join(dir, "int_busy.l2.yaml"), dir, {ddic});
      const file = join(dir, "ints.l3.yaml");
      writeFileSync(file, ["set: ints", "title: An INT4 worklist", "date: $date", "stages:", "  - stage: pick", "    filter: true", "    worklist: picked",
        "    rules:", "      - rule: int_busy.l2.yaml", "ports:", "  ships:", "    kind: source", "    table: ZT_INTSHIP", "    key: ship_no",
        "    variants:", "      table: generated", "  alerts:", "    kind: sink", "    table: ZOSD_L3_ALERT", "    group: [set_name, rule_name, model_hash, check_date]",
        "    seq: alert_seq", "    variants:", "      log: generated", "bindings:", "  ships: table", "  alerts: log", ""].join("\n"));
      let error;
      try { compileSet(file, {ddic}); } catch (e) { error = e; }
      expect(error, "refused").to.be.instanceOf(SetError);
      expect(error.message).to.match(new RegExp(`:${setLine(/worklist: picked/, readFileSync(file, "utf8"))}: the worklist picked would hold keys of ZT_INTSHIP-SHIP_NO, a INT4; a worklist key is compared as text, so it is CHAR, NUMC or DATS`));
    });
    it("a stage over a worklist with a rule whose range: is another field", async () => {
      const dir = join(scratch, "otherkey");
      mkdirSync(dir, {recursive: true});
      // a copy of a rule ranged over another field of the ship (its name), built beside the set
      const {buildRule} = await import("../tools/dsl-l2.mjs");
      const text = readFileSync(join(OUT, "ship_min_crew.l2.yaml"), "utf8").replace(/^class: .*$/m, "class: zcl_l2_by_name")
        .replace(/^rule: .*$/m, "rule: ship-min-crew-by-name").replace("range: ship.ship_id", "range: ship.name")
        .replace(/\n  - name: the range keeps[\s\S]*$/, "\n");
      writeFileSync(join(dir, "by_name.l2.yaml"), text);
      await buildRule(join(dir, "by_name.l2.yaml"), dir);
      const file = manifest("otherkey", [["      - rule: ship_cargo_limit.l2.yaml\n", "      - rule: ship_cargo_limit.l2.yaml\n      - rule: XBYNAME\n"]]);
      writeFileSync(file, readFileSync(file, "utf8").replace("XBYNAME", "by_name.l2.yaml"));
      refusedAt(file, /rule ship-min-crew-by-name has range: ship\.name of ZOSD_L2_SHIP; stage checks piles over worklist busy, keys of ZOSD_L2_SHIP-SHIP_ID/, /rule: by_name/);
    });
    it("an empty stage", () => refusedAt(manifest("empty", [[STAGE2, "  - stage: nothing\n    rules: []\n" + STAGE2]]),
      /stage nothing is empty: a stage runs at least one rule/, /^    rules: \[\]$/));
    it("more than nine stages", () => {
      const extra = Array.from({length: 8}, (_, i) => `  - stage: s${i}\n    rules:\n      - rule: ship_max_cargo.l2.yaml\n        enabled: false\n`).join("");
      refusedAt(manifest("ten", [[STAGE2, extra + STAGE2]]), /a set has at most 9 stages/, /^stages:$/);
    });
    it("a stage name that does not fit", () => refusedAt(manifest("name", [["  - stage: checks\n", "  - stage: Checks-2\n"]]),
      /stage "Checks-2" is a lower-case name/, /stage: Checks-2/));
    it("rules: beside stages:", () => refusedAt(manifest("both", [["stages:\n", "rules:\n  - rule: ship_busy.l2.yaml\nstages:\n"]]),
      /rules: and stages: do not go together/, /^rules:$/));
    it("a schedule in months, or one with a unit it does not know", () => {
      refusedAt(manifest("months", [["every: 1d", "every: 1mo"]]), /schedule\.every is <n><unit>, the unit m \(minutes\), h \(hours\), d \(days\) or w \(weeks\); months are refused/, /^schedule:/);
      refusedAt(manifest("wide", [["every: 1d", "every: 100h"]]), /schedule\.every 100h: a period in hours has at most 2 digits/, /^schedule:/);
      refusedAt(manifest("at", [['at: "020000"', 'at: "250000"']]), /schedule\.at is the first start as HHMMSS in system time/, /^schedule:/);
    });
    it("a schedule on a set without stages", () => {
      const text = readFileSync(ONE, "utf8") + 'schedule: {every: 1d}\n';
      const dir = join(scratch, "onesched");
      mkdirSync(dir, {recursive: true});
      const file = join(dir, "fleet.l3.yaml");
      writeFileSync(file, text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (m, f) => `rule: ${relative(dir, join(process.cwd(), OUT, f)).split(sep).join("/")}`));
      refusedAt(file, /a schedule runs the set in jobs \(mode P\), and only a set with stages: completes in its jobs/, /^schedule:/);
    });

    it("the trace: every generated line has a manifest line; a stage's lines trace to the stage, the worklist variant to its port, the schedule to schedule:", () => {
      const text = (f) => readFileSync(join(OUT, f), "utf8").split("\n");
      const trace = (f) => JSON.parse(readFileSync(join(OUT, f.replace(/\.abap$/, ".trace.json")), "utf8"));
      for (const f of [`${RUNNER}.clas.abap`, `${REPORT}.prog.abap`, "zcl_l3_fleet2_ships_worklist.clas.abap", "zcl_l3_fleet2_ports.clas.abap"]) {
        const t = trace(f);
        expect(t.lines.length, f).to.equal(text(f).length - 1);
        for (const e of t.lines) expect(e.set_line, `${f}:${e.line}`).to.be.within(1, SET_TEXT.split("\n").length);
      }
      const runner = text(`${RUNNER}.clas.abap`);
      const of = (f, re) => trace(f).lines.filter((e) => re.test(text(f)[e.line - 1]));
      expect(of(`${RUNNER}.clas.abap`, /CONSTANTS c_stage_2 /)[0]).to.include({node: "set/fleet2/stage/checks", set_line: setLine(/stage: checks/)});
      expect(of(`${RUNNER}.clas.abap`, /CONSTANTS c_driver /)[0]).to.include({node: "set/fleet2/schedule", set_line: setLine(/^schedule:/)});
      expect(of(`${RUNNER}.clas.abap`, /METHOD advance\./)[0]).to.include({node: "set/fleet2/stages", set_line: setLine(/^stages:/)});
      expect(of(`${RUNNER}.clas.abap`, /AND worklist = 'busy'/)[0].set_line).to.equal(setLine(/worklist:busy/));
      expect(of(`${RUNNER}.clas.abap`, /^ +iv_worklist = 'busy'$/)[0].node).to.equal("set/fleet2/rule/ship-busy");
      expect(of("zcl_l3_fleet2_ships_worklist.clas.abap", /SELECT key_value FROM zosd_l3_work/)[0].node).to.equal("set/fleet2/port/ships/variant/worklist");
      expect(runner.join("\n")).to.include("zcl_l2_ship_busy=>keys( iv_date = iv_date it_range = lt_range_1 ).");
    });

    it("the runner ends no unit of work (SUBMIT, in mode P, is its one such statement); the job report commits a DONE pile before the gate", () => {
      expect(unitFindings(readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8"), `${RUNNER}.clas.abap`, {writes: true, jobs: true})).to.deep.equal([]);
      const report = readFileSync(join(OUT, `${REPORT}.prog.abap`), "utf8");
      expect(report).to.match(/IF ls_rule-status = 'DONE'\.\n.*\n    COMMIT WORK\.\n    zcl_l3_fleet2=>advance\(/);
      expect(report).to.include("PARAMETERS p_mode TYPE c LENGTH 1 DEFAULT 'R'.");
      expect(report).to.include("    GET TIME.\n    ls_result = zcl_l3_fleet2=>run( iv_date = sy-datum iv_mode = zcl_l3_fleet2=>c_parallel ).");
    });

    it("explain names the stage of the alert's rule", async () => {
      const model = compileSet(SET);
      const rule = model.rules.find((r) => r.name === "ship-min-crew");
      const {text} = await explainAlert(`fleet2/ship-min-crew/${rule.hash}/${DATE}/1/1`, {sets: [SET]});
      expect(text).to.match(/^stage   2 checks, piled over worklist busy \(src\/l2demo\/fleet2\.l3\.yaml:\d+\)$/m);
    });
  });

  // -------------------------------------------------------------------------
  describe("running the stages on a durable database", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, store, dialogStep, drainJobOutbox, workQueuedBatch;
    const root = process.cwd();
    const date = () => new abap.types.Date().set(DATE);
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    const clearAll = () => exec(TABLES.map((t) => `DELETE FROM ${t}`));
    const model = compileSet(SET);
    const checks = model.rules.filter((r) => !r.filter);
    const log = () => read("SELECT * FROM zosd_l3_alert WHERE set_name = 'fleet2' ORDER BY rule_name, pile_no, alert_seq")
      .map((r) => ({rule: r.rule_name.trim(), pile: Number(r.pile_no), text: String(r.alert_text), run: r.run_id.trim()}));
    const content = (rows) => rows.map(({rule, text}) => `${rule}: ${text}`).sort();
    const plain = (raw) => {
      const r = raw.get();
      const trim = (v) => (typeof v === "string" ? v.trim() : v);
      return {run: trim(r.run_id.get()), status: trim(r.status.get()), alerts: r.alerts.get(), raw,
        stages: r.stages.array().map((s) => ({no: s.get().stage_no.get(), stage: trim(s.get().stage.get()), status: trim(s.get().status.get()),
          piles: s.get().piles.get(), piles_done: s.get().piles_done.get()})),
        rules: r.rules.array().map((x) => Object.fromEntries(["rule", "status", "alerts", "keys", "piles", "piles_done", "stage_no", "jobname"]
          .map((k) => [k, trim(x.get()[k].get())])))};
    };
    const runSet = (className = RUNNER, mode = "S", bind) => dialogStep(() => abap.Classes[className.toUpperCase()].run({
      iv_date: date(), iv_mode: new abap.types.Character(1).set(mode),
      ...(bind === undefined ? {} : {iv_bind: new abap.types.String().set(bind)})})).then(plain);
    const collect = (result, className = RUNNER) => dialogStep(() => abap.Classes[className.toUpperCase()].collect({is_result: result.raw})).then(plain);
    const worklist = (run) => read("SELECT key_value FROM zosd_l3_work WHERE run_id = ? AND worklist = 'busy' ORDER BY key_value", run).map((r) => r.key_value.trim());
    const plan = (run, stage) => read("SELECT rule_name, pile_no, range_low, range_high, status FROM zosd_l3_pile WHERE run_id = ? AND stage_no = ? ORDER BY rule_name, pile_no", run, stage)
      .map((r) => [r.rule_name.trim(), Number(r.pile_no), r.range_low.trim(), r.range_high.trim(), r.status.trim()]);
    const gates = (run) => read("SELECT stage_no, stage_name, status FROM zosd_l3_stage WHERE run_id = ? ORDER BY stage_no", run)
      .map((r) => [Number(r.stage_no), r.stage_name.trim(), r.status.trim()]);
    const lockRow = () => read("SELECT run_id, status FROM zosd_l3_run WHERE set_name = 'fleet2' AND check_date = ?", DATE)
      .map((r) => ({run: r.run_id.trim(), status: r.status.trim()}))[0];
    // what the check rules of stage 2 answer over the ships the filter keeps, called directly
    const expected = async () => {
      const busy = await abap.Classes.ZCL_L2_SHIP_BUSY.keys({iv_date: date()});
      const rows = [];
      for (const r of checks) {
        const alerts = await abap.Classes[r.check_class.toUpperCase()].check({iv_date: date(), it_range: busy});
        for (const a of alerts.array()) rows.push(`${r.name}: ${a.get()}`);
      }
      return {keys: busy.array().map((k) => k.get().low.get().trim()), rows: rows.sort()};
    };
    // the jobs of the operations store whose name starts with `prefix`
    const jobRuns = (prefix, since = 0) => store.db.prepare("SELECT rowid, job_name, state FROM batch_runs WHERE job_name LIKE ? AND rowid > ? ORDER BY rowid")
      .all(`${prefix}%`, since).map((r) => ({jobName: r.job_name, state: r.state}));
    const lastJob = () => store.db.prepare("SELECT MAX(rowid) AS n FROM batch_runs").get().n ?? 0;
    const drainAndWork = async (limit = 60) => {
      await drainJobOutbox(store);
      const outcomes = [];
      for (let i = 0; i < limit; i++) {
        const outcome = await workQueuedBatch(root, store);
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) {
          // a job that submitted jobs: their intents reach the queue through the outbox
          if ((await drainJobOutbox(store)).imported) continue;
          break;
        }
        outcomes.push(outcome.kind);
      }
      return outcomes;
    };

    before(async () => {
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-l3-stages-db-"));
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
    let classesBefore;
    before(() => { classesBefore = {...globalThis.abap.Classes}; });
    after(() => {
      const classes = globalThis.abap.Classes;
      for (const key of Object.keys(classes)) if (!(key in classesBefore)) delete classes[key];
      Object.assign(classes, classesBefore);
    });
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

    // Everything a mode S run of `className` must satisfy, as a list of what is wrong.
    async function stageProblems(className = RUNNER) {
      const problems = [];
      await clearAll();
      const want = await expected();
      const result = await runSet(className);
      if (result.status !== "DONE") problems.push(`the run is ${result.status}`);
      if (JSON.stringify(result.stages.map((s) => [s.stage, s.status])) !== JSON.stringify([["candidates", "DONE"], ["checks", "DONE"]])) problems.push(`stages ${JSON.stringify(result.stages)}`);
      if (JSON.stringify(worklist(result.run)) !== JSON.stringify(want.keys)) problems.push(`worklist ${JSON.stringify(worklist(result.run))}, the filter's keys ${JSON.stringify(want.keys)}`);
      if (JSON.stringify(content(log())) !== JSON.stringify(want.rows)) problems.push(`the log is not the checks over the worklist: ${JSON.stringify(content(log()))}`);
      if (log().some((r) => r.rule === "ship-busy")) problems.push("the filter stage wrote alerts");
      const stage2 = plan(result.run, 2);
      const piles = new Set(stage2.map((p) => `${p[1]} ${p[2]} ${p[3]}`));
      if (JSON.stringify([...piles]) !== JSON.stringify(["1 S001 S002"])) problems.push(`stage 2 piles ${JSON.stringify([...piles])}`);
      if (JSON.stringify(gates(result.run)) !== JSON.stringify([[1, "candidates", "DONE"], [2, "checks", "DONE"]])) problems.push(`gates ${JSON.stringify(gates(result.run))}`);
      if (JSON.stringify(lockRow()) !== JSON.stringify({run: result.run, status: "RELEASED"})) problems.push(`lock ${JSON.stringify(lockRow())}`);
      return {problems, result, want};
    }

    it("mode S: the filter fills the worklist with each flagged ship once; the checks, piled over it only, log what they answer over those ships", async () => {
      const {problems, result, want} = await stageProblems();
      expect(problems).to.deep.equal([]);
      expect(want.keys).to.deep.equal(["S001", "S002"]);
      expect(want.rows).to.include("ship-too-many-future-voyages: S002 Bluebird: 3 future voyages");
      expect(want.rows.join("\n"), "S003 is not busy: its cargo alert is not a stage 2 alert").to.not.include("S003");
      expect(result.rules.find((r) => r.rule === "ship-busy")).to.include({status: "DONE", keys: 2, alerts: 0, piles: 2, piles_done: 2});
      expect(plan(result.run, 1).filter((p) => p[0] === "ship-busy").map((p) => p.slice(1, 4))).to.deep.equal([[1, "S001", "S002"], [2, "S003", "S004"]]);
      expect(result.alerts).to.equal(want.rows.length);
    });

    it("the filter cuts work: stage 2 plans its piles over the worklist's keys only, one pile per two of them", async () => {
      await clearAll();
      // S003 gets a voyage ahead: three busy ships, two piles of stage 2
      await exec(["INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123', 'V00099', 'S003', '20261020')"]);
      try {
        const result = await runSet();
        expect(worklist(result.run)).to.deep.equal(["S001", "S002", "S003"]);
        const piles = new Set(plan(result.run, 2).map((p) => `${p[1]} ${p[2]} ${p[3]}`));
        expect([...piles]).to.deep.equal(["1 S001 S002", "2 S003 S003"]);
        expect(result.stages.find((s) => s.stage === "checks").piles).to.equal(2 * checks.length);
      } finally {
        await exec(["DELETE FROM zosd_l2_voy WHERE voyage_id = 'V00099'"]);
      }
    });

    it("a pile over a worklist is its keys, not its bounds: a ship between them that the filter left out is not checked", async () => {
      await clearAll();
      // busy = S001 and S004 (S002's voyages gone, S004 one ahead): one pile, bounds S001..S004, S003 between them
      await exec(["UPDATE zosd_l2_voy SET dep_date = '20250101' WHERE ship_id = 'S002'",
        "INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123', 'V00098', 'S004', '20261020')"]);
      try {
        const result = await runSet();
        expect(worklist(result.run)).to.deep.equal(["S001", "S004"]);
        expect(new Set(plan(result.run, 2).map((p) => `${p[2]} ${p[3]}`))).to.deep.equal(new Set(["S001 S004"]));
        expect(content(log()).join("\n"), "S003's cargo alert lies between the bounds").to.not.include("S003");
        expect(content(log())).to.deep.equal((await expected()).rows);
      } finally {
        await exec(["UPDATE zosd_l2_voy SET dep_date = '20261010' WHERE voyage_id = 'V00002'", "UPDATE zosd_l2_voy SET dep_date = '20261011' WHERE voyage_id = 'V00003'",
          "UPDATE zosd_l2_voy SET dep_date = '20261012' WHERE voyage_id = 'V00004'", "DELETE FROM zosd_l2_voy WHERE voyage_id = 'V00098'"]);
      }
    });

    it("a filter that selects no key: stage 2 has no pile and is DONE with no alert, and its finalise clears the older run's rows", async () => {
      await clearAll();
      const full = await runSet();
      expect(log().length).to.be.greaterThan(0);
      await exec(["UPDATE zosd_l2_voy SET dep_date = '20250101'"]);
      try {
        const none = await runSet();
        expect(worklist(none.run)).to.deep.equal([]);
        expect(none.stages.map((s) => [s.stage, s.status, s.piles])).to.deep.equal([["candidates", "DONE", 2], ["checks", "DONE", 0]]);
        expect(none.rules.filter((r) => r.stage_no === 2).map((r) => [r.status, r.piles, r.alerts])).to.deep.equal(Array(checks.length).fill(["DONE", 0, 0]));
        expect(log(), "the older run's rows are finalised away").to.deep.equal([]);
        expect(full.run).to.not.equal(none.run);
      } finally {
        await exec(Object.entries({V00001: "20261005", V00002: "20261010", V00003: "20261011", V00004: "20261012", V00005: "20260901"})
          .map(([v, d]) => `UPDATE zosd_l2_voy SET dep_date = '${d}' WHERE voyage_id = '${v}'`));
      }
    });

    // a rerun after the data changed: its plan reads its own worklist; what is wrong, as a list
    async function otherRunProblems() {
      const problems = [];
      await clearAll();
      const first = await runSet();
      if (JSON.stringify(worklist(first.run)) !== JSON.stringify(["S001", "S002"])) problems.push(`first worklist ${JSON.stringify(worklist(first.run))}`);
      await exec(["UPDATE zosd_l2_voy SET dep_date = '20250101' WHERE ship_id = 'S002'"]);
      try {
        const second = await runSet();
        if (JSON.stringify(worklist(second.run)) !== JSON.stringify(["S001"])) problems.push(`second worklist ${JSON.stringify(worklist(second.run))}`);
        const piles = [...new Set(plan(second.run, 2).map((p) => `${p[1]} ${p[2]} ${p[3]}`))];
        if (JSON.stringify(piles) !== JSON.stringify(["1 S001 S001"])) problems.push(`the rerun's stage 2 piles ${JSON.stringify(piles)}`);
      } finally {
        await exec(["UPDATE zosd_l2_voy SET dep_date = '20261010' WHERE voyage_id = 'V00002'", "UPDATE zosd_l2_voy SET dep_date = '20261011' WHERE voyage_id = 'V00003'",
          "UPDATE zosd_l2_voy SET dep_date = '20261012' WHERE voyage_id = 'V00004'"]);
      }
      return {problems};
    }

    it("the worklist of another run is not read: a rerun plans over its own keys only", async () => {
      expect((await otherRunProblems()).problems).to.deep.equal([]);
    });

    it("a run does not bind the worklist variant: the planner reads it, the factory refuses it as a binding", async () => {
      let error;
      try { await runSet(RUNNER, "S", "ships=worklist"); } catch (e) { error = e; }
      expect(String(error?.reason?.get?.() ?? error?.message ?? error)).to.match(/the worklist variant is read by the planner of a stage/);
    });

    // ---- the schedule: a periodic driver job on the facade's injectable clock ----
    describe("the schedule: a periodic driver job, system time", () => {
      let JobScheduler, installAbapClock, manualClock;
      before(async () => ({JobScheduler, installAbapClock, manualClock} = await import("../tools/osd-job-scheduler.mjs")));
      // a world: the clock at `start` (UTC), ABAP's sy-datum/sy-uzeit on it, and the
      // user's own time `offset` hours ahead in sy-datlo/sy-timlo, as for a user in another zone
      const world = (start, offset = 5) => {
        const clock = manualClock(start);
        const restoreClock = installAbapClock(abap, clock);
        const system = abap.statements.getTime;
        abap.statements.getTime = (options = {}) => {
          system(options);
          const sy = options.sy ?? abap.builtin.sy;
          const local = new Date(clock.now() + offset * 3600 * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
          sy.get().datlo.set(local.slice(0, 8));
          sy.get().timlo.set(local.slice(8));
        };
        abap.statements.getTime({sy: abap.builtin.sy});
        const scheduler = new JobScheduler({root, store, env: process.env, clock});
        return {clock, scheduler, restore: () => { scheduler.stop(); abap.statements.getTime = system; restoreClock(); }};
      };
      const drivers = () => store.db.prepare("SELECT state, sdl_at, started_at FROM batch_runs WHERE job_name = 'L3_FLEET2_D' ORDER BY sdl_at, rowid").all()
        .map((r) => ({state: r.state, sdl: r.sdl_at, started: Boolean(r.started_at)}));
      const call = (method, className = RUNNER) => dialogStep(async () => (await abap.Classes[className.toUpperCase()][method]()).get());
      const settle = async (w) => { for (let i = 0; i < 12; i++) { await w.scheduler.tick(); if (!read("SELECT COUNT(*) AS n FROM zosd_job_outbox")[0].n) break; } };

      // the schedule's run: what must hold, as a list of what is wrong
      async function scheduleProblems({scheduler = RUNNER, unscheduler = RUNNER} = {}) {
        const problems = [];
        await clearAll();
        store.db.prepare("DELETE FROM batch_runs WHERE job_name = 'L3_FLEET2_D'").run();
        const w = world("2026-10-01T23:00:00Z");
        try {
          const count = String(await call("schedule", scheduler)).trim();
          if (!count) problems.push("schedule( ) gave no job count");
          // a second call while the instance waits: that instance's count, no second chain
          const again = String(await call("schedule", scheduler)).trim();
          if (again !== count) problems.push(`a second schedule( ) answered ${again}, the waiting instance is ${count}`);
          if (String(await call("scheduled")).trim() !== count) problems.push("scheduled( ) does not name the waiting instance");
          await w.scheduler.tick();
          // the first start: 02:00 system time on the next day, not the user's time
          const first = drivers();
          if (JSON.stringify(first) !== JSON.stringify([{state: "WAITING", sdl: "20261002020000", started: false}])) problems.push(`after schedule( ): ${JSON.stringify(first)}`);
          // not due: an hour on, nothing runs
          w.clock.set(w.clock.now() + 3600 * 1000);
          await w.scheduler.tick();
          if (drivers().some((d) => d.started)) problems.push("a tick before the start time ran the driver");
          // due: the driver runs once, a run of the set for 20261002 is made and its jobs complete it
          await w.clock.advance(2 * 3600 * 1000 + 1000);
          await settle(w);
          const ran = drivers().filter((d) => d.started);
          if (ran.length !== 1) problems.push(`${ran.length} driver run(s) at the start time`);
          const runs = read("SELECT run_id, status, check_date FROM zosd_l3_run WHERE set_name = 'fleet2'");
          if (runs.length !== 1 || runs[0].status.trim() !== "RELEASED" || runs[0].check_date !== "20261002") problems.push(`the run of 20261002: ${JSON.stringify(runs)}`);
          else if (JSON.stringify(gates(runs[0].run_id.trim())) !== JSON.stringify([[1, "candidates", "DONE"], [2, "checks", "DONE"]])) problems.push(`its stages ${JSON.stringify(gates(runs[0].run_id.trim()))}`);
          const next = drivers().filter((d) => d.state === "WAITING").map((d) => d.sdl);
          if (JSON.stringify(next) !== JSON.stringify(["20261003020000"])) problems.push(`the next instance waits for ${JSON.stringify(next)}`);
          // a second tick that is not due runs nothing
          await w.scheduler.tick();
          if (drivers().filter((d) => d.started).length !== 1) problems.push("a second tick ran the driver again");
          // unschedule: the waiting instance goes, and the next day nothing runs
          const deleted = (await call("unschedule", unscheduler)).deleted.get();
          // the driver's waiting instance, and with resilience: (slice 5a) the doctor's
          const scheduled = model.resilience ? 2 : 1;
          if (deleted !== scheduled) problems.push(`unschedule( ) deleted ${deleted}`);
          await w.clock.advance(24 * 3600 * 1000);
          await settle(w);
          const after = drivers().filter((d) => d.started).length;
          if (after !== 1) problems.push(`after unschedule( ) the driver ran ${after} time(s)`);
        } finally {
          w.restore();
          await clearAll();
        }
        return {problems};
      }

      it("schedule( ) waits for 02:00 system time; it runs once when due and makes a run whose jobs complete it; a tick not due runs nothing; unschedule( ) ends the chain", async () => {
        expect((await scheduleProblems()).problems).to.deep.equal([]);
      });

      it("mutant: unschedule( ) not deleting the waiting instance: the chain goes on the next day", async () => {
        await loadClass(RUNNER, "zcl_l3_fleet2_m_unsched", mutate("      CALL FUNCTION 'BP_JOB_DELETE'\n        EXPORTING\n          jobname = ls_job-jobname\n"
          + "          jobcount = ls_job-jobcount\n        EXCEPTIONS\n          OTHERS = 1.\n", ""));
        const {problems} = await scheduleProblems({unscheduler: "zcl_l3_fleet2_m_unsched"});
        expect(problems).to.include("after unschedule( ) the driver ran 2 time(s)");
      });

      it("mutant: a schedule computed in user time (sy-datlo, sy-timlo): the first start is not 02:00 system time", async () => {
        await loadClass(RUNNER, "zcl_l3_fleet2_m_usertime", (text) => mutate("    IF lv_time <= sy-uzeit.\n", "    IF lv_time <= sy-timlo.\n")(
          mutate("    lv_date = sy-datum.\n", "    lv_date = sy-datlo.\n")(text)));
        const {problems} = await scheduleProblems({scheduler: "zcl_l3_fleet2_m_usertime"});
        expect(problems[0]).to.match(/^after schedule\( \): \[\{"state":"WAITING","sdl":"20261003020000"/);
      });
    });

    // ---- mutants of slice 3b, each against the test that names it ----
    // A copy of a committed class under another name, one edit made, transpiled
    // alone; what it does not bring itself comes from the built system. The
    // runner and the jobs reach a class by name, so swapping the registry's
    // entry for the length of `work` is what binds the copy.
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
    const withClass = async (real, name, work) => {
      const was = abap.Classes[real.toUpperCase()];
      abap.Classes[real.toUpperCase()] = abap.Classes[name.toUpperCase()];
      try { return await work(); } finally { abap.Classes[real.toUpperCase()] = was; }
    };
    const mutate = (from, to) => (text) => {
      expect(text, `the class holds ${JSON.stringify(from)}`).to.include(from);
      return text.replace(from, to);
    };

    describe("mode P: stage 1's jobs, then the gate", () => {
      const runParallel = async () => { const since = lastJob(); return {...await runSet(RUNNER, "P"), since}; };

      it("submits the filter's piles only; the job that ends stage 1 opens stage 2 once; the last job of stage 2 completes the run", async () => {
        await clearAll();
        const sequential = (await expected()).rows;
        const submitted = await runParallel();
        expect(submitted.status).to.equal("SUBMITTED");
        expect(submitted.stages.map((s) => [s.stage, s.status])).to.deep.equal([["candidates", "SUBMITTED"], ["checks", "WAITING"]]);
        expect(submitted.rules.map((r) => r.status)).to.deep.equal(["SUBMITTED", ...Array(checks.length).fill("WAITING")]);
        expect(gates(submitted.run)).to.deep.equal([[1, "candidates", "OPEN"], [2, "checks", "WAITING"]]);
        expect(plan(submitted.run, 2), "stage 2 is not planned before stage 1 is DONE").to.deep.equal([]);
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "HELD"});
        // one job of stage 1: its pile DONE, the other's still to run, the gate stays shut
        await drainJobOutbox(store);
        expect((await workQueuedBatch(root, store)).kind).to.equal("completed");
        expect(plan(submitted.run, 1).map((p) => p[4]).sort()).to.deep.equal(["DONE", "PLANNED"]);
        expect(gates(submitted.run)[1]).to.deep.equal([2, "checks", "WAITING"]);
        // the rest: stage 1's last job opens stage 2, whose jobs run, and the last one completes the run
        const outcomes = await drainAndWork();
        expect(outcomes.length).to.equal(1 + checks.length);
        expect(gates(submitted.run)).to.deep.equal([[1, "candidates", "DONE"], [2, "checks", "DONE"]]);
        expect(content(log())).to.deep.equal(sequential);
        expect(lockRow(), "the last job released the lock: nobody needs to collect").to.deep.equal({run: submitted.run, status: "RELEASED"});
        const runs = jobRuns("L3_FLEET2_", submitted.since);
        expect(runs.map((r) => r.jobName).sort()).to.deep.equal(["L3_FLEET2_101_0001", "L3_FLEET2_101_0002", ...checks.map((r) => `${r.jobname}_0001`)].sort());
        const collected = await collect(submitted);
        expect(collected.status).to.equal("DONE");
        expect(collected.stages.map((s) => s.status)).to.deep.equal(["DONE", "DONE"]);
        expect(collected.rules.find((r) => r.rule === "ship-busy")).to.include({status: "DONE", keys: 2, alerts: 0});
        expect(collected.alerts).to.equal(sequential.length);
      });

      // stage 1's piles run in one step, as two jobs that end at once would, then the gate twice:
      // `first` and `second` are the classes whose advance( ) is called; what is wrong, as a list
      async function gateProblems({first = RUNNER, second = RUNNER, piles = [1, 2]} = {}) {
        const problems = [];
        await clearAll();
        const submitted = await runParallel();
        await dialogStep(async () => {
          for (const pile of piles) {
            await abap.Classes.ZCL_L3_FLEET2.run_rule({iv_rule: new abap.types.String().set("ship-busy"), iv_date: date(),
              iv_run: new abap.types.String().set(submitted.run), iv_pile: new abap.types.Integer().set(pile)});
          }
        });
        const advance = async (className) => {
          try {
            return String((await dialogStep(async () => (await abap.Classes[className.toUpperCase()].advance({
              iv_run: new abap.types.String().set(submitted.run), iv_date: date(), iv_stage: new abap.types.Integer().set(1)})).get()))).trim();
          } catch (e) { return `raised ${e?.constructor?.name ?? e}`; }
        };
        const jobs = () => read("SELECT COUNT(*) AS n FROM zosd_job_outbox")[0].n + jobRuns("L3_FLEET2_2").length;
        const before = jobs();
        const once = await advance(first);
        if (piles.length < 2) {
          // a pile of stage 1 still to run: the gate stays shut
          if (once !== "") problems.push(`advance( ) with a pile of stage 1 open answered ${once}`);
          if (JSON.stringify(gates(submitted.run)[1]) !== JSON.stringify([2, "checks", "WAITING"])) problems.push(`stage 2 is ${JSON.stringify(gates(submitted.run)[1])}`);
          if (plan(submitted.run, 2).length) problems.push("stage 2 was planned");
        } else {
          if (once !== "X") problems.push(`the first call answered ${once}`);
          if (jobs() - before !== checks.length) problems.push(`the first call submitted ${jobs() - before} job(s)`);
          const planned = plan(submitted.run, 2);
          if (planned.length !== checks.length) problems.push(`stage 2 planned ${planned.length} pile(s)`);
          const twice = await advance(second);
          if (twice !== "") problems.push(`the second call answered ${twice}`);
          if (JSON.stringify(plan(submitted.run, 2)) !== JSON.stringify(planned)) problems.push("the second call planned again");
          if (jobs() - before !== checks.length) problems.push(`stage 2's jobs: ${jobs() - before}`);
        }
        await drainAndWork();
        await clearAll();
        return {problems};
      }

      it("the gate called twice for the same stage opens it once: the second call plans and submits nothing", async () => {
        expect((await gateProblems()).problems).to.deep.equal([]);
      });

      it("the gate called while a pile of the stage is still open does not open the next stage", async () => {
        expect((await gateProblems({piles: [1]})).problems).to.deep.equal([]);
      });

      it("a failing pile in stage 1 keeps stage 2 shut: the gate does not open, collect makes the run final with stage 2 NOT-RUN and releases the lock", async () => {
        await clearAll();
        const submitted = await runParallel();
        // pile 2's job finds no plan row (moved to pile 99) and aborts: it ends without its pile DONE
        await exec([`UPDATE zosd_l3_pile SET pile_no = 99 WHERE run_id = '${submitted.run}' AND stage_no = 1 AND pile_no = 2`]);
        await drainAndWork();
        expect(plan(submitted.run, 1).map((p) => p[4])).to.include("DONE");
        expect(gates(submitted.run)[1]).to.deep.equal([2, "checks", "WAITING"]);
        const collected = await collect(submitted);
        expect(collected.stages.map((s) => [s.stage, s.status])).to.deep.equal([["candidates", "PARTIAL"], ["checks", "NOT-RUN"]]);
        expect(collected.status).to.equal("PARTIAL");
        expect(gates(submitted.run)).to.deep.equal([[1, "candidates", "PARTIAL"], [2, "checks", "NOT-RUN"]]);
        expect(lockRow()).to.deep.equal({run: submitted.run, status: "RELEASED"});
        expect(plan(submitted.run, 2), "stage 2 never planned").to.deep.equal([]);
        // a late gate call finds the stage's pile FAILED and the next gate closed
        const late = await dialogStep(async () => (await abap.Classes.ZCL_L3_FLEET2.advance({iv_run: new abap.types.String().set(submitted.run),
          iv_date: date(), iv_stage: new abap.types.Integer().set(1)})).get());
        expect(late.trim()).to.equal("");
        await clearAll();
      });

    describe("mutants of slice 3b", () => {
      it("the gate without status = 'WAITING' (a double submit): the second gate call opens stage 2 again", async () => {
        await loadClass(RUNNER, "zcl_l3_fleet2_m_gate", mutate("        WHERE set_name = c_set AND run_id = iv_run\n          AND stage_no = lv_stage\n          AND status = 'WAITING'.\n",
          "        WHERE set_name = c_set AND run_id = iv_run\n          AND stage_no = lv_stage.\n"));
        const {problems} = await gateProblems({second: "zcl_l3_fleet2_m_gate"});
        expect(problems.join("\n")).to.match(/the second call answered (X|raised)/);
      });

      it("stage n+1 opening before every pile of stage n is DONE: the gate opens with a pile of stage 1 open", async () => {
        await loadClass(RUNNER, "zcl_l3_fleet2_m_early", mutate("    IF sy-dbcnt > 0.\n      RETURN.\n    ENDIF.\n    GET TIME STAMP FIELD lv_stamp.\n",
          "    GET TIME STAMP FIELD lv_stamp.\n"));
        const {problems} = await gateProblems({first: "zcl_l3_fleet2_m_early", piles: [1]});
        expect(problems.join("\n")).to.match(/advance\( \) with a pile of stage 1 open answered (X|raised)/);
      });

      it("the worklist variant ignoring the run id: the rerun plans over the first run's keys too", async () => {
        await loadClass("zcl_l3_fleet2_ships_worklist", "zcl_l3_fleet2_ships_wl_m", mutate("      WHERE run_id = gv_run\n        AND worklist = gv_worklist.\n",
          "      WHERE worklist = gv_worklist.\n"));
        const {problems} = await withClass("zcl_l3_fleet2_ships_worklist", "zcl_l3_fleet2_ships_wl_m", () => otherRunProblems());
        expect(problems).to.include(`the rerun's stage 2 piles ["1 S001 S002"]`);
      });

      it("a filter stage writing alerts: the log holds the filter's rows", async () => {
        await loadClass(RUNNER, "zcl_l3_fleet2_m_filter", mutate("        fill( EXPORTING iv_run = iv_run\n",
          "        write( EXPORTING iv_date = iv_date iv_run = iv_run iv_pile = iv_pile iv_class = 'ZCL_L2_SHIP_BUSY' iv_file = 'x' iv_line = 1\n"
          + "                         it_alerts = lt_found iv_bind = iv_bind CHANGING cs_rule = rs_rule ).\n        fill( EXPORTING iv_run = iv_run\n"));
        const {problems} = await stageProblems("zcl_l3_fleet2_m_filter");
        expect(problems).to.include("the filter stage wrote alerts");
      });
    });
    });
  });
});
