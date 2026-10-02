// DSL L3, slice 5d (docs/dsl-l3.md, "Simulated twin: the work as a port"):
// the work of a pile is the port work, and iv_bind = 'work=sim' runs the same
// generated runner with a simulated twin in place of the L2 checks. The twin
// draws each pile's outcome, duration and hits from a stream that is a pure
// function of (seed, run, rule, pile, attempt), and acts it out for real in
// the job: WAIT UP TO, an abnormal end, synthetic hits. The gates, the
// doctor, the retries, the governor and the events are the real generated
// code. Here: the manifest's refusals at their lines, byte stability of a set
// without simulate:, the trace, the ABAP generator against its JavaScript
// twin, a long twin of a night (hundreds of piles, hours of simulated time)
// on a file database with the jobs facade and a manual clock, determinism,
// a chaos matrix against the orchestration, and the slice's mutants.
import {expect} from "chai";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, renderSet, SetError, unitFindings} from "../tools/dsl-l3.mjs";
import {alertText, closes, configOf, draw, predictPile, precedence, sinkSafety, start} from "../tools/dsl-l3-sim.mjs";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const SET = "src/l2demo/fleet2.l3.yaml";
const ONE = "src/l2demo/fleet.l3.yaml";
const OUT = "src/l2demo";
const CORE = ".local/lars/open-abap-core/src";
const RUNNER = "zcl_l3_fleet2";
const SIM = "zcl_l3_fleet2_work_sim";
const PORTS = "zcl_l3_fleet2_ports";
const SET_TEXT = readFileSync(SET, "utf8");
const DATE = "20991001";
const setLine = (re, text = SET_TEXT) => text.split("\n").findIndex((l) => re.test(l)) + 1;
const where = (file) => relative(process.cwd(), file).split(sep).join("/");
const git = (args) => spawnSync("git", args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
const TABLES = ["zosd_l3_budget", "zosd_l3_event", "zosd_l3_object", "zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_stage",
  "zosd_l3_work", "zosd_l3_doctor", "zosd_l3_kill", "zosd_l3_conf", "zosd_l3_conf_log", "zosd_l3_run_conf"];
const SOURCES = ["zosd_l2_ship", "zosd_l2_voy", "zosd_l2_crew", "zosd_l2_cargo"];
const model = compileSet(SET);
const ruleOf = (name) => model.simulate.rules.find((r) => r.rule === name);
// the 1-based numbers of the lines of `after` that a longest common
// subsequence with `before` leaves out: what `after` adds
function addedLines(before, after) {
  const n = before.length, m = after.length;
  const table = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i * (m + 1) + j] = before[i] === after[j] ? table[(i + 1) * (m + 1) + j + 1] + 1
      : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
  }
  const added = [];
  let i = 0, j = 0;
  while (j < m) {
    if (i < n && before[i] === after[j]) { i++; j++; } else if (i < n && table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) i++;
    else { added.push(j + 1); j++; }
  }
  return added;
}

describe("DSL L3 slice 5d: a simulated twin of the work of a pile", function () {
  this.timeout(900000);
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), "dsl-l3-sim-")); });
  after(() => rmSync(scratch, {recursive: true, force: true}));

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
  const refusedAt = (file, message, at) => {
    const line = readFileSync(file, "utf8").split("\n").findIndex((l) => at.test(l)) + 1;
    expect(line, `a line matches ${at}`).to.be.greaterThan(0);
    let error;
    try { compileSet(file); } catch (e) { error = e; }
    expect(error, `refused: ${message}`).to.be.instanceOf(SetError);
    expect(error.message.slice(where(file).length), error.message).to.match(new RegExp(`^:${line}: ${message.source}`));
  };
  // the set as it was before this slice: no simulate:, no work port, no sim variant
  const STRIPPED = SET_TEXT.replace(/^simulate:\n(  .*\n)+/m, "")
    .replace("  work:\n    kind: work\n    variants:\n      real: generated\n      sim: generated\n", "")
    .replace("      sim: generated\n", "").replace("  work: real\n", "")
    .replace(/^# Slice 5d[^\n]*\n(#[^\n]*\n)*?(?=# `node)/m, "").replace(", simulate.seed, simulate.time_scale, piles", ", piles");

  describe("the manifest", () => {
    it("the committed fleet2 is a fresh build, and the one-stage fleet without simulate: is too", async () => {
      expect(await checkSet(SET, OUT)).to.deep.equal([]);
      expect(await checkSet(ONE, OUT)).to.deep.equal([]);
    });

    it("a set without simulate: renders the bytes it rendered before the slice, sidecars included", async function () {
      // the newest commit whose fleet2 has no simulate:, with the templates of today
      const log = git(["log", "--format=%H", "-n", "200"]);
      const base = log.status === 0 ? log.stdout.split("\n").filter(Boolean)
        .find((c) => { const t = git(["show", `${c}:${SET}`]); return t.status === 0 && !/^simulate:/m.test(t.stdout); }) : undefined;
      const templates = ["recipes/l3-set", "recipes/l3-job", "recipes/l3-governor", "recipes/l3-settings", "recipes/l3-ports/factory.tpl",
        "recipes/l3-ports/iface-source.tpl", "recipes/l3-ports/iface-sink.tpl", "recipes/l3-ports/iface-autoclose.tpl"];
      if (!base || git(["diff", "--quiet", base, "--", ...templates]).status !== 0) this.skip();
      expect(git(["show", `${base}:${SET}`]).stdout, "the stripped set is the set before the slice").to.equal(STRIPPED);
      const file = join(OUT, `zz_base_${process.pid}.l3.yaml`);
      writeFileSync(file, STRIPPED);
      try {
        const stripped = compileSet(file);
        expect([stripped.simulate, stripped.ports.some((p) => p.is_work)]).to.deep.equal([undefined, false]);
        const {files} = await renderSet(stripped);
        let compared = 0;
        for (const [name, text] of Object.entries(files)) {
          const before = git(["show", `${base}:${OUT}/${name}`]);
          expect(before.status, `${name} existed before the slice`).to.equal(0);
          const now = text.replaceAll(basename(file), "fleet2.l3.yaml");
          if (name.endsWith(".trace.json")) {
            // all but the model's hash, which hashes the manifest's own path
            const {model: m1, ...rest} = JSON.parse(now), {model: m0, ...was} = JSON.parse(before.stdout);
            expect([typeof m1, rest], name).to.deep.equal([typeof m0, was]);
          } else {
            expect(now, name).to.equal(before.stdout);
          }
          compared++;
        }
        expect(compared).to.be.greaterThan(20);
      } finally { rmSync(file, {force: true}); }
    });

    it("the model: each field is the rule's own, else its stage's, else the default's, from that line", () => {
      const at = (re) => setLine(re);
      // ship-min-crew's hits are its own; its duration and outcome the default's
      expect(ruleOf("ship-min-crew").hits).to.include({dist: "F", a: "1", set_line: at(/^      hits: \{dist: fixed, value: 1\}/)});
      expect(ruleOf("ship-min-crew").duration).to.include({dist: "L", set_line: at(/^    duration: \{dist: lognormal/)});
      // the filter's duration, outcome and keep are its stage's; its hits the default's
      expect(ruleOf("ship-busy").duration).to.include({dist: "U", a: "5", b: "20", set_line: at(/^      duration: \{dist: uniform/)});
      expect(ruleOf("ship-busy").outcome).to.include({ok: "500000", dump: "500000", set_line: at(/^      outcome: \{ok: 0\.5/)});
      expect(ruleOf("ship-busy").keep).to.include({value: "500000", set_line: at(/^      keep: 0\.5/)});
      expect(ruleOf("ship-busy").hits).to.include({dist: "P", set_line: at(/^    hits: \{dist: poisson/)});
      // a field nobody names is the built-in, traced to simulate:
      expect(ruleOf("ship-cargo-limit").keep).to.include({value: "1000000", set_line: at(/^simulate:/)});
      expect(ruleOf("ship-cargo-limit").outcome).to.include({ok: "930000", slow: "30000", dump: "30000", hang: "10000"});
      // the lognormal's knots hit its median and p95
      const knots = ruleOf("ship-cargo-limit").duration.knots.split(" ").map(Number);
      expect([knots[7], knots[12]]).to.deep.equal([40, 300]);
      expect(model.simulate.seed.value).to.equal("42");
      expect(model.simulate.scale.value).to.equal("10000");
    });

    // precedence( ) itself, and a copy of the compiler with it broken
    const precedenceProblems = (fn) => {
      const v = (value) => ({value, at: 1});
      const sets = {rules: {r: {hits: v("rule")}}, stages: {s: {hits: v("stage"), keep: v("stage")}},
        default: {hits: v("default"), keep: v("default"), outcome: v("default")}, builtin: {hits: v("builtin"), keep: v("builtin"), outcome: v("builtin"), duration: v("builtin")}};
      const got = ["hits", "keep", "outcome", "duration"].map((n) => fn(sets, "r", "s", n).value);
      return JSON.stringify(got) === JSON.stringify(["rule", "stage", "default", "builtin"]) ? [] : [`precedence gives ${JSON.stringify(got)}`];
    };
    it("precedence: rule > stage > default > built-in", () => {
      expect(precedenceProblems(precedence)).to.deep.equal([]);
    });
    it("mutant: precedence with the stage before the rule", async () => {
      const copy = join(scratch, "precedence.mjs");
      const text = readFileSync("tools/dsl-l3-sim.mjs", "utf8");
      const from = "sets.rules[rule]?.[name] ?? sets.stages[stage]?.[name]";
      expect(text).to.include(from);
      writeFileSync(copy, text.replace(from, "sets.stages[stage]?.[name] ?? sets.rules[rule]?.[name]"));
      const mutated = await import(pathToFileURL(copy).href);
      expect(precedenceProblems(mutated.precedence).join("\n")).to.match(/precedence gives \["stage"/);
    });

    it("refusals, each at its line", () => {
      refusedAt(manifest("sum", [["outcome: {ok: 0.93, dump: 0.03, hang: 0.01, slow: 0.03}", "outcome: {ok: 0.93, dump: 0.03, hang: 0.01, slow: 0.02}"]]),
        /the outcome probabilities sum to 1, these to 0\.99/, /outcome: \{ok: 0\.93/);
      refusedAt(manifest("rulesum", [["      hits: {dist: fixed, value: 1}\n", "      outcome: {ok: 0.5, dump: 0.6}\n"]]),
        /the outcome probabilities sum to 1, these to 1\.1/, /outcome: \{ok: 0\.5, dump: 0\.6\}/);
      refusedAt(manifest("unknown", [["  seed: 42\n", "  seed: 42\n  speed: 3\n"]]), /unknown key speed in simulate/, /speed: 3/);
      refusedAt(manifest("unknownfield", [["    slow_factor: 5\n", "    slow_factor: 5\n    jitter: 2\n"]]), /unknown key jitter in simulate\.default/, /jitter: 2/);
      refusedAt(manifest("unknowninner", [["hits: {dist: poisson, mean: 2}", "hits: {dist: poisson, mean: 2, lambda: 3}"]]), /unknown key lambda in hits/, /lambda: 3/);
      refusedAt(manifest("unknownoutcome", [["outcome: {ok: 0.5, dump: 0.5}", "outcome: {ok: 0.5, crash: 0.5}"]]), /unknown key crash in outcome/, /crash: 0\.5/);
      refusedAt(manifest("negative", [["{dist: lognormal, median: 40, p95: 300}", "{dist: lognormal, median: -40, p95: 300}"]]), /duration\.median is a whole number from 1 to 604800, not "-40"/, /median: -40/);
      refusedAt(manifest("negprob", [["    autoclose: 0.4\n", "    autoclose: -0.4\n"]]), /autoclose is a number from 0 to 1 with at most six decimals, not "-0\.4"/, /autoclose: -0\.4/);
      refusedAt(manifest("p95", [["p95: 300", "p95: 30"]]), /duration\.p95 is at least the median \(40\), not 30/, /p95: 30/);
      refusedAt(manifest("scale", [["  time_scale: 0.01\n", "  time_scale: 2\n"]]), /simulate\.time_scale \(wall seconds per simulated second\) is a number from 0 to 1/, /time_scale: 2/);
      refusedAt(manifest("seed", [["  seed: 42\n", "  seed: 0\n"]]), /simulate\.seed is a whole number from 1 to 2147483646/, /seed: 0/);
      refusedAt(manifest("rulename", [["    ship-min-crew:\n", "    ship-max-crew:\n"]]), /simulate\.rules names ship-max-crew, which is not a rule of the set/, /ship-max-crew:/);
      refusedAt(manifest("stagename", [["    candidates:\n      duration", "    candidate:\n      duration"]]), /simulate\.stages names candidate, which is not a stage/, /^    candidate:/);
      refusedAt(manifest("dist", [["{dist: uniform, min: 5, max: 20}", "{dist: normal, min: 5, max: 20}"]]), /duration\.dist is fixed, uniform, lognormal, not "normal"/, /dist: normal/);
      refusedAt(manifest("allow", [["  allow_sink: [log]\n", "  allow_sink: [journal]\n"]]), /simulate\.allow_sink names journal, which is not a variant of sink alerts/, /allow_sink: \[journal\]/);
      refusedAt(manifest("hand", [["      real: generated\n      sim: generated\n", "      real: generated\n      sim: zcl_my_sim\n"]]), /the variants of the work port are generated \(real, sim\); sim cannot be a class of its own/, /sim: zcl_my_sim/);
      refusedAt(manifest("closesim", [["  close: none\n", "  close: sim\n"]]), /close is bound to sim, which closes alerts by chance; a sim variant is bound only beside work: sim/, /^  close: sim/);
      // a work port, or a sim variant, without simulate:
      const plain = SET_TEXT.replace(/^simulate:\n(  .*\n)+/m, "");
      refusedAt(manifest("noworkport", [], plain), /a work port comes with simulate:/, /^    kind: work/);
      refusedAt(manifest("nosimvariant", [["  work:\n    kind: work\n    variants:\n      real: generated\n      sim: generated\n", ""], ["  work: real\n", ""]], plain),
        /a sim variant comes with simulate:/, /^      sim: generated/);
      // simulate: needs stages and resilience
      refusedAt(manifest("noresilience", [], SET_TEXT.replace(/^resilience:\n(  .*\n|    .*\n)+/m, "").replace(/^governor:\n(  .*\n)+/m, "")
        .replace(/^settings:\n(  .*\n|    .*\n)+/m, "")), /simulate needs stages and resilience/, /^simulate:/);
    });

    it("a simulated run on a production sink: refused at the work binding unless simulate.allow_sink names the variant", () => {
      const file = manifest("unsafe", [["  allow_sink: [log]\n", ""], ["  work: real\n", "  work: sim\n"]]);
      refusedAt(file, /work is bound to sim and sink alerts to log, a production variant; a simulated run writes there only when simulate\.allow_sink names it/, /^  work: sim/);
      // allowed by name, or bound to a sink variant that is not production
      expect(() => compileSet(manifest("allowed", [["  work: real\n", "  work: sim\n"]]))).not.to.throw();
      expect(() => compileSet(manifest("dummy", [["  allow_sink: [log]\n", ""], ["  work: real\n", "  work: sim\n"], ["  alerts: log\n", "  alerts: dummy\n"]]))).not.to.throw();
    });

    const safetyProblems = (fn) => {
      const sink = model.sink;
      const got = fn({bindings: {work: "sim", alerts: "log"}, sink, allow: []});
      return got === "log" ? [] : [`a simulated run on the log is ${got === undefined ? "allowed" : got}`];
    };
    it("mutant: the compiler allowing a simulated run on a production sink", async () => {
      expect(safetyProblems(sinkSafety)).to.deep.equal([]);
      const copy = join(scratch, "safety.mjs");
      const text = readFileSync("tools/dsl-l3-sim.mjs", "utf8");
      const from = "if (work === \"sim\" && bound && (bound.is_log || bound.hand) && !allow.includes(bound.name)) return bound.name;";
      expect(text).to.include(from);
      writeFileSync(copy, text.replace(from, ""));
      expect(safetyProblems((await import(pathToFileURL(copy).href)).sinkSafety).join("\n")).to.match(/a simulated run on the log is allowed/);
    });

    it("the trace: every line the twin adds traces to simulate: or the work port, the real calls it moves to their rule", async () => {
      const file = join(OUT, `zz_plain_${process.pid}.l3.yaml`);
      writeFileSync(file, STRIPPED);
      let plainRunner;
      try { plainRunner = (await renderSet(compileSet(file))).files[`${RUNNER}.clas.abap`].replaceAll(basename(file), "fleet2.l3.yaml").split("\n"); } finally { rmSync(file, {force: true}); }
      const simLine = setLine(/^simulate:/), workLine = setLine(/^  work:$/);
      const text = (f) => readFileSync(join(OUT, f), "utf8").split("\n");
      const trace = (f) => JSON.parse(readFileSync(join(OUT, f.replace(/\.abap$/, ".trace.json")), "utf8"));
      // the lines of the runner that the set without simulate: does not have: a
      // longest common subsequence of the two, line by line
      const runner = text(`${RUNNER}.clas.abap`);
      const added = addedLines(plainRunner, runner);
      expect(added.length).to.be.greaterThan(80);
      const ruleLines = new Map(model.rules.map((r) => [r.name, r.set_line]));
      const t = trace(`${RUNNER}.clas.abap`);
      expect(t.sim_overlay).to.deep.equal(["recipes/l3-sim/runner.patch.json", "recipes/l3-sim/runner-governed.patch.json"]);
      for (const n of added) {
        const entry = t.lines.find((e) => e.line === n);
        const moved = /=>(check|keys)\( |LOOP AT lt_keys_|APPEND ls_key_|ENDLOOP\.|iv_key_offset = lv_key_offset/.test(runner[n - 1]);
        // simulate: and its fields; the settings: entries of the two tunables
        // (simulate.seed, simulate.time_scale) and the selection fields they renumber
        const inBlock = entry.set_line >= simLine;
        // a real call the twin wraps keeps its rule's line, the governed write its governor: line
        if (moved) expect([...ruleLines.values(), simLine, setLine(/^governor:/)], runner[n - 1]).to.include(entry.set_line);
        else expect(inBlock, `${n}: ${runner[n - 1]} traces to ${entry.set_line}`).to.equal(true);
      }
      // the work port's interface and the sim class: every line to the port, simulate: or a field of it
      const block = [simLine, setLine(/^settings:/)];
      for (const f of ["zif_l3_fleet2_work.intf.abap", `${SIM}.clas.abap`, "zcl_l3_fleet2_close_sim.clas.abap"]) {
        const lines = trace(f).lines;
        expect(lines.length, f).to.equal(text(f).length - 1);
        for (const e of lines) {
          const ok = (e.set_line >= workLine && e.set_line <= workLine + 4) || SET_TEXT.split("\n")[e.set_line - 1] === "      sim: generated"
            || (e.set_line >= block[0] && e.set_line < block[1]);
          expect(ok, `${f}:${e.line} traces to ${e.set_line}`).to.equal(true);
        }
      }
      // each field of the configuration to its own line: ship-min-crew's hits to its rule entry
      const sim = text(`${SIM}.clas.abap`);
      const of = (re) => trace(`${SIM}.clas.abap`).lines.filter((e) => re.test(sim[e.line - 1]));
      expect(of(/rs_config-hits_a = 1\./).map((e) => e.set_line)).to.deep.equal([setLine(/^      hits: \{dist: fixed, value: 1\}/)]);
      expect(of(/rs_config-keep = 500000\./).map((e) => e.set_line)).to.deep.equal([setLine(/^      keep: 0\.5/)]);
      // the factory's twin checks, and the constants of the seed and scale
      const factory = text(`${PORTS}.clas.abap`);
      const ft = trace(`${PORTS}.clas.abap`).lines.filter((e) => /simulated run|lv_work = |only beside work=sim/.test(factory[e.line - 1]));
      expect(ft.length).to.be.greaterThan(2);
      for (const e of ft) expect(e.set_line, factory[e.line - 1]).to.equal(simLine);
      const constants = trace(`${RUNNER}.clas.abap`).lines.filter((e) => /CONSTANTS c_sim_(seed|scale)/.test(runner[e.line - 1])).map((e) => e.set_line);
      expect(constants).to.deep.equal([setLine(/^  seed: 42/), setLine(/^  time_scale:/)]);
    });

    it("nothing generated ends the unit of work, but the sim class's WAIT, its work", () => {
      const read = (f) => readFileSync(join(OUT, f), "utf8");
      expect(unitFindings(read(`${RUNNER}.clas.abap`), `${RUNNER}.clas.abap`, {writes: true, jobs: true})).to.deep.equal([]);
      expect(unitFindings(read(`${SIM}.clas.abap`), `${SIM}.clas.abap`, {writes: true}).map((f) => f.what)).to.deep.equal(["WAIT statement"]);
      expect(unitFindings(read(`${SIM}.clas.abap`), `${SIM}.clas.abap`, {writes: true, waits: true})).to.deep.equal([]);
      expect(unitFindings(read("zcl_l3_fleet2_close_sim.clas.abap"), "close_sim.clas.abap", {writes: true})).to.deep.equal([]);
    });

    it("seed and time scale are run-scoped settings; their defaults are the manifest's", () => {
      const entries = model.settings.entries.filter((e) => e.name.startsWith("simulate."));
      expect(entries.map((e) => [e.name, e.default, e.min, e.max, e.scoped])).to.deep.equal([
        ["simulate.seed", "42", "1", "2147483646", true], ["simulate.time_scale", "10000", "0", "1000000", true]]);
    });
  });

  // -------------------------------------------------------------------------
  describe("on a durable database, with the jobs facade and a manual clock", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, store, dialogStep, drainJobOutbox, workQueuedBatch;
    let clock, restoreClock, installAbapClock, manualClock;
    const START = Date.parse("2026-10-01T22:00:00Z");
    const root = process.cwd();
    const str = (s) => new abap.types.String().set(s);
    const int = (n) => new abap.types.Integer().set(n);
    const trim = (v) => (typeof v === "string" ? v.trim() : v);
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trim(v)]))); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    const cls = (name = RUNNER) => abap.Classes[name.toUpperCase()];
    const tune = async (name, value) => {
      const ok = await dialogStep(() => cls().set_setting({iv_param: str(name), iv_value: str(value), iv_note: str("sim test")}));
      expect(trim(ok.get()), `${name} = ${value}`).to.equal("X");
    };
    const ships = (n) => Array.from({length: n}, (_, i) => `S${String(i + 1).padStart(3, "0")}`);
    const seedShips = (n) => exec([...SOURCES.map((t) => `DELETE FROM ${t}`),
      ...ships(n).map((s) => `INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123', '${s}', 'Ship ${s}', 'A')`)]);
    const stamp = (n) => { const s = String(n); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)) / 1000; };
    const report = (raw) => raw.array().map((x) => `${trim(x.get().doc_action.get())} ${trim(x.get().reason.get())}${trim(x.get().rule_name.get()) ? ` ${trim(x.get().rule_name.get())} ${x.get().pile_no.get()}` : ""}`);
    const doctor = () => dialogStep(async () => report(await cls().doctor({})));
    const lockRow = (day = DATE) => read("SELECT run_id, status FROM zosd_l3_run WHERE set_name = 'fleet2' AND check_date = ?", day)[0];
    // the binding a run started with, on its own gate rows
    const recorded = (run) => read("SELECT run_bind FROM zosd_l3_stage WHERE run_id = ? AND stage_no = 1", run)[0]?.run_bind;
    const pilesOf = (run) => read("SELECT * FROM zosd_l3_pile WHERE run_id = ? ORDER BY stage_no, rule_name, pile_no", run);
    const gates = (run) => read("SELECT status FROM zosd_l3_stage WHERE run_id = ? ORDER BY stage_no", run).map((r) => r.status);
    const lastJob = () => store.db.prepare("SELECT MAX(rowid) AS n FROM batch_runs").get().n ?? 0;
    const jobsSince = (since) => store.db.prepare("SELECT job_name, state FROM batch_runs WHERE rowid > ? ORDER BY rowid").all(since);

    // Virtual time: while `work` runs, a timer of the manual clock that stays
    // pending (a WAIT of a pile job, given up the work process) is fired by
    // moving the clock to it. `hold(at)`, when given, is asked first and may
    // move the clock itself, call the doctor, look at the tables.
    async function virtual(work, {hold} = {}) {
      let done = false, failure;
      const result = work().then((r) => { done = true; return r; }, (e) => { done = true; failure = e; });
      let seen;
      while (!done) {
        await new Promise((r) => setTimeout(r, 1));
        const next = clock.pending()[0];
        if (done || next === undefined) { seen = undefined; continue; }
        if (seen !== next) { seen = next; continue; }
        seen = undefined;
        if (hold) await hold(next);
        await clock.advance(Math.max(0, clock.pending()[0] - clock.now()));
      }
      const value = await result;
      if (failure) throw failure;
      return value;
    }
    // every queued job, each on virtual time; after(job) after each
    const drainAndWork = async ({hold, after: afterJob} = {}) => {
      await drainJobOutbox(store);
      let worked = 0;
      for (;;) {
        const outcome = await virtual(() => workQueuedBatch(root, store), {hold});
        if (!["completed", "failed", "step", "running"].includes(outcome.kind)) {
          if ((await drainJobOutbox(store)).imported) continue;
          break;
        }
        worked++;
        if (afterJob) await afterJob(outcome);
      }
      return worked;
    };
    // run ids from a counter while `work` runs, so two twins draw from the same streams
    const fixedRuns = async (prefix, work) => {
      const uuid = abap.Classes.CL_SYSTEM_UUID;
      const was = uuid.CRYPTO;
      let n = 0;
      uuid.CRYPTO = {randomUUID: () => `${prefix}-0000-4000-8000-${String(++n).padStart(12, "0")}`};
      try { return await work(); } finally { uuid.CRYPTO = was; }
    };
    // A simulated run in jobs, driven to its end: every queued job on virtual
    // time, and between, the doctor every 15 simulated minutes, as its own
    // scheduled job would (stale: 900 s). Returns the run, its wall time and
    // how far the clock moved.
    // The run id is fixed (the draws depend on it), so a test is the same run every time.
    const begin = (bind, prefix = "0A1647A0") => fixedRuns(prefix, () => dialogStep(() => cls().run({iv_date: new abap.types.Date().set(DATE),
      iv_mode: new abap.types.Character(1).set("P"), iv_bind: str(bind)})));
    async function twin({bind = "work=sim,close=sim", hold, after: afterJob, passes = 400, prefix, afterStart} = {}) {
      const wall0 = Date.now(), clock0 = clock.now();
      const result = await begin(bind, prefix);
      await afterStart?.();
      const run = trim(result.get().run_id.get());
      expect(trim(result.get().status.get())).to.equal("SUBMITTED");
      const doctorReports = [];
      for (let pass = 0; pass < passes; pass++) {
        await drainAndWork({hold, after: afterJob});
        if (lockRow()?.status === "RELEASED" && lockRow().run_id === run) break;
        clock.set(clock0 + (Math.floor((clock.now() - clock0) / 900000) + 1) * 900000);
        doctorReports.push(...await doctor());
      }
      return {run, result, wall: Date.now() - wall0, simulated: (clock.now() - clock0) / 1000, doctorReports};
    }

    // What the twin says a finished run is: per pile its status, attempt, the
    // keys it answered and its duration, from the plan rows the run made;
    // stage 2's keys are the worklist's between a pile's bounds.
    function prediction(run, {configs = (name) => configOf(ruleOf(name)), seed = 42, scale = 1000000, stale = 900, retryMax = 2} = {}) {
      const shipIds = read("SELECT ship_id FROM zosd_l2_ship ORDER BY ship_id").map((r) => r.ship_id);
      const work = read("SELECT key_value FROM zosd_l3_work WHERE run_id = ? ORDER BY key_value", run).map((r) => r.key_value);
      return pilesOf(run).map((p) => {
        const keys = (p.stage_no === 1 ? shipIds : work).filter((k) => k >= p.range_low && k <= p.range_high);
        const config = configs(p.rule_name);
        const pred = predictPile(config, {run, rule: p.rule_name, pile: p.pile_no, seed, scale, stale}, keys, {filter: p.stage_no === 1, retryMax});
        return {p, keys, config, pred};
      });
    }
    const problemsAgainst = (run, predicted, {durations = true} = {}) => {
      const problems = [];
      const busy = new Set();
      for (const {p, keys, pred} of predicted) {
        const at = `${p.rule_name} ${p.pile_no}`;
        if (p.status !== pred.status || p.attempt !== pred.attempt) problems.push(`${at}: ${p.status} at attempt ${p.attempt}, the twin says ${pred.status} at ${pred.attempt} (${pred.attempts.map((a) => a.outcome).join(", ")})`);
        if (pred.status !== "DONE" || p.status !== "DONE") continue;
        const answered = p.stage_no === 1 ? pred.final.keys.length : Math.min(pred.final.hits, keys.length);
        if (p.alerts !== answered) problems.push(`${at}: ${p.alerts} alerts, the twin says ${answered}`);
        if (durations && stamp(p.ended) - stamp(p.started) !== pred.final.duration) problems.push(`${at}: took ${stamp(p.ended) - stamp(p.started)} s, the twin says ${pred.final.duration}`);
        if (p.stage_no === 1) for (const k of pred.final.keys) busy.add(k);
      }
      const work = read("SELECT key_value FROM zosd_l3_work WHERE run_id = ? ORDER BY key_value", run).map((r) => r.key_value);
      if (predicted.every((x) => x.p.stage_no !== 1 || x.pred.status === "DONE") && JSON.stringify(work) !== JSON.stringify([...busy].sort())) problems.push(`the worklist holds ${work.length} keys, the twin ${busy.size}`);
      return problems;
    };
    // the log of a run against the twin's alert texts and its chance closures
    const logProblems = (run, predicted, {seed = 42} = {}) => {
      const want = [];
      for (const {p, config, pred} of predicted) {
        if (p.stage_no === 1 || p.status !== "DONE") continue;
        pred.final.keys.forEach((k, i) => want.push(`${p.rule_name} ${p.pile_no} ${i + 1} ${alertText(config, {pile: p.pile_no, attempt: p.attempt}, k)} ${closes(config, {seed, run, rule: p.rule_name, key: k}) ? "X" : "-"}`));
      }
      const got = read("SELECT rule_name, pile_no, alert_seq, alert_text, closed, model_hash FROM zosd_l3_alert WHERE run_id = ? ORDER BY rule_name, pile_no, alert_seq", run);
      const problems = [];
      if (got.some((r) => !r.model_hash.startsWith("sim256:"))) problems.push("a simulated row under a real model hash");
      const lines = got.map((r) => `${r.rule_name} ${r.pile_no} ${r.alert_seq} ${r.alert_text} ${r.closed === "X" ? "X" : "-"}`);
      lines.sort();
      want.sort();
      if (JSON.stringify(lines) !== JSON.stringify(want)) problems.push(`the log has ${lines.length} rows, the twin ${want.length}; first difference: ${lines.find((l, i) => l !== want[i]) ?? want[lines.length]}`);
      return problems;
    };

    before(async () => {
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-l3-sim-db-"));
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
      ({installAbapClock, manualClock} = await import("../tools/osd-job-scheduler.mjs"));
      clock = manualClock(START);
      restoreClock = installAbapClock(abap, clock);
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
      if (client) await exec([...SOURCES, ...TABLES].map((t) => `DELETE FROM ${t}`)).catch(() => {});
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
    // every test starts at the same clock, with no job queued and every row of the set gone
    const fresh = async () => {
      clock.set(START);
      await drainAndWork();
      await exec(TABLES.map((t) => `DELETE FROM ${t}`));
    };
    beforeEach(fresh);

    // ---- one class transpiled alone from its text, answering for `real` ------
    async function loadAs(real, name, text) {
      const out = join(scratch, name);
      mkdirSync(out, {recursive: true});
      const {Transpiler, core} = modulesOf(process.cwd());
      const reg = new core.Registry();
      const own = text.replace(new RegExp(`\\b${real}\\b`, "gi"), name);
      expect(own, `${name} is a class of its own`).to.not.equal(text);
      const files = {[`${name}.clas.abap`]: own, [`${name}.clas.xml`]: readFileSync(join(OUT, `${real}.clas.xml`), "utf8").replace(real.toUpperCase(), name.toUpperCase())};
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
      const mine = new Set(output.objects.map((o) => o.filename));
      const outputDir = pathToFileURL(join(process.cwd(), "output") + sep).href;
      for (const o of output.objects.filter((x) => x.object.type === "CLAS")) {
        writeFileSync(join(out, o.filename), o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g, (m, file) => mine.has(file) ? m : `import("${outputDir}${file}")`));
      }
      const cxRoot = abap.Classes.CX_ROOT;
      await import(pathToFileURL(join(out, `${name}.clas.mjs`)).href);
      if (cxRoot) abap.Classes.CX_ROOT = cxRoot;
      expect(abap.Classes[name.toUpperCase()], `${name} loaded`).to.exist;
    }
    // the generated code reaches a class by name: the copy answers for it while `work` runs
    const answering = async (real, name, work) => {
      const was = abap.Classes[real.toUpperCase()];
      abap.Classes[real.toUpperCase()] = abap.Classes[name.toUpperCase()];
      try { return await work(); } finally { abap.Classes[real.toUpperCase()] = was; }
    };
    const edit = (text, from, to) => {
      expect(text, `the class holds ${JSON.stringify(from)}`).to.include(from);
      return text.replace(from, to);
    };
    const committed = (cls) => readFileSync(join(OUT, `${cls}.clas.abap`), "utf8");
    // A configuration of the twin other than the committed one: the set with
    // its simulate: block replaced, compiled and rendered, and its sim class
    // transpiled alone and answering for the committed one while `work` runs
    let variantCount = 0;
    async function withConfig(block, work, {editSim, editClose} = {}) {
      const file = manifest(`config${++variantCount}`, [[SET_TEXT.slice(SET_TEXT.indexOf("simulate:\n"), SET_TEXT.indexOf("settings:\n")), block]]);
      const variant = compileSet(file);
      const {files} = await renderSet(variant);
      let text = files[`${SIM}.clas.abap`];
      if (editSim) text = editSim(text);
      const name = `zcl_l3_fleet2_sim_v${variantCount}`;
      await loadAs(SIM, name, text);
      const configs = (rule) => configOf(variant.simulate.rules.find((r) => r.rule === rule));
      if (!editClose) return answering(SIM, name, () => work({configs, variant}));
      // the chance autoclose of the variant, edited, answering too
      const close = `zcl_l3_fleet2_close_v${variantCount}`;
      await loadAs("zcl_l3_fleet2_close_sim", close, editClose(files["zcl_l3_fleet2_close_sim.clas.abap"]));
      return answering(SIM, name, () => answering("zcl_l3_fleet2_close_sim", close, () => work({configs, variant})));
    }

    // ---- the generator: what the ABAP draws, the JavaScript twin draws -------
    const pileOf = (p) => {
      const s = new abap.types.Structure({run_id: new abap.types.Character(32), rule: new abap.types.Character(60), pile_no: new abap.types.Integer(),
        attempt: new abap.types.Integer(), seed: new abap.types.Integer(), scale: new abap.types.Integer(), stale: new abap.types.Integer()});
      s.get().run_id.set(p.run); s.get().rule.set(p.rule); s.get().pile_no.set(p.pile); s.get().attempt.set(p.attempt);
      s.get().seed.set(p.seed); s.get().scale.set(p.scale); s.get().stale.set(p.stale);
      return s;
    };
    const keysOf = (keys) => {
      const t = new abap.types.Table(new abap.types.String());
      for (const k of keys) t.append(str(k));
      return t;
    };
    // a table of inputs: every rule, runs, piles, attempts, seeds, scales and key sets
    const INPUTS = (() => {
      const out = [];
      const runs = ["0123456789ABCDEF0123456789ABCDEF", "FEDCBA9876543210FEDCBA9876543210"];
      const keySets = [[], ["S001"], ships(10), ships(7).slice(3)];
      let i = 0;
      for (const r of model.simulate.rules) for (const run of runs) for (const pile of [0, 1, 7, 123]) for (const attempt of [0, 1, 2, 5]) {
        const seed = [1, 42, 2147483646][i % 3], scale = [0, 10000, 1000000, 333333][i % 4], keys = keySets[i % 4];
        out.push({run, rule: r.rule, pile, attempt, seed, scale, stale: [60, 900, 3600][i % 3], keys, filter: r.rule === "ship-busy"});
        i++;
      }
      return out;
    })();
    async function drawProblems(className = SIM) {
      const problems = [];
      for (const input of INPUTS) {
        const got = await cls(className).draw({is_pile: pileOf(input), it_keys: keysOf(input.keys), ...(input.filter ? {iv_filter: new abap.types.Character(1).set("X")} : {})});
        const g = got.get();
        const abapDraw = {outcome: trim(g.outcome.get()), duration: g.duration.get(), wait: g.wait.get(), hits: g.hits.get(), keys: g.keys.array().map((k) => k.get())};
        const want = draw(configOf(ruleOf(input.rule)), input, input.keys, {filter: input.filter});
        if (JSON.stringify(abapDraw) !== JSON.stringify(want)) problems.push(`${JSON.stringify(input)}: ABAP ${JSON.stringify(abapDraw)}, twin ${JSON.stringify(want)}`);
        if (problems.length > 3) break;
      }
      return problems;
    }

    it("the ABAP generator draws what its JavaScript twin draws, on a table of inputs", async () => {
      expect(INPUTS.length).to.be.greaterThan(200);
      expect(await drawProblems()).to.deep.equal([]);
      // the outcomes over the table are not all one
      const outcomes = new Set(INPUTS.map((input) => draw(configOf(ruleOf(input.rule)), input, input.keys, {filter: input.filter}).outcome));
      expect([...outcomes].sort()).to.deep.equal(["DUMP", "HANG", "OK", "SLOW"]);
      // the stream itself, and an alert's text
      for (const [seed, text] of [[1, ""], [42, "RUN|rule|3|1"], [2147483646, "a-b_c.d:e|zZ9 ?"]]) {
        let state = await cls(SIM).start({iv_seed: int(seed), iv_text: str(text)});
        const ours = [];
        for (let i = 0; i < 5; i++) {
          state = await cls(SIM).next({iv_state: state});
          ours.push(state.get() % 1000000);
        }
        const s = start(seed, text);
        expect(ours, `${seed} ${text}`).to.deep.equal(Array.from({length: 5}, () => s.next()));
      }
      const config = configOf(ruleOf("ship-cargo-limit"));
      const text = await cls(SIM).alert({is_pile: pileOf({run: "R", rule: "ship-cargo-limit", pile: 4, attempt: 2, seed: 1, scale: 0, stale: 0}),
        is_config: await cls(SIM).config({iv_rule: str("ship-cargo-limit")}), iv_key: str("S1")});
      expect(text.get()).to.equal(alertText(config, {pile: 4, attempt: 2}, "S1")).and.to.equal("SIM S1  : simulated hit, pile 4, attempt 2");
    });

    it("mutant: a generator that ignores the seed (the clock instead): the draws differ from the twin's", async () => {
      const name = "zcl_l3_fleet2_m_seed";
      await loadAs(SIM, name, edit(edit(committed(SIM), "    rv_state = iv_seed MOD c_modulus.\n", "    GET TIME STAMP FIELD lv_now.\n    rv_state = lv_now MOD c_modulus.\n"),
        "    DATA lv_room TYPE i.\n", "    DATA lv_room TYPE i.\n    DATA lv_now TYPE timestamp.\n"));
      expect((await drawProblems(name)).join("\n")).to.match(/ABAP .* twin /);
    });

    it("mutant: the precedence broken in the generated class (ship-min-crew's own hits dropped): the draws differ", async () => {
      const name = "zcl_l3_fleet2_m_prec";
      const text = committed(SIM);
      const at = text.indexOf("WHEN 'ship-min-crew'.");
      const tail = text.slice(at);
      const mutated = text.slice(0, at) + edit(tail, "        rs_config-hits = 'F'.\n        rs_config-hits_a = 1.\n", "        rs_config-hits = 'P'.\n        rs_config-hits_a = 0.\n"
        + "        rs_config-cdf = rs_config-cdf && `135335 406006 676676 857123 947347 983436 995466 998903 999763 999954 999992 999999 1000000`.\n");
      await loadAs(SIM, name, mutated);
      expect((await drawProblems(name)).join("\n")).to.match(/ship-min-crew/);
    });

    // ---- the golden draws the ABAP Unit proof checks on a system ---------------
    it("the proof's golden draws are the twin's", () => {
      const proof = readFileSync("src/l3proof/zcl_l3_fleet_proof.clas.testclasses.abap", "utf8");
      const golden = [...proof.matchAll(/golden\( iv_run = '(\w+)' iv_rule = '([\w-]+)' iv_pile = (\d+) iv_attempt = (\d+) iv_seed = (\d+)\s+iv_outcome = '(\w+)' iv_duration = (\d+) iv_hits = (\d+) \)/g)];
      expect(golden.length).to.be.greaterThan(3);
      for (const [, run, rule, pile, attempt, seed, outcome, duration, hits] of golden) {
        const d = draw(configOf(ruleOf(rule)), {run, rule, pile: +pile, attempt: +attempt, seed: +seed, scale: 0, stale: 900}, [], {filter: rule === "ship-busy"});
        expect([outcome, +duration, +hits], `${run} ${rule} ${pile} ${attempt} ${seed}`).to.deep.equal([d.outcome, d.duration, d.hits]);
      }
    });

    // ---- WAIT on the injected clock --------------------------------------------
    it("WAIT UP TO inside a step waits on the injected clock: a manual clock ends it, the wall clock does not", async () => {
      const wall0 = Date.now();
      let done = false;
      const step = dialogStep(async () => { await abap.statements.wait({seconds: {get: () => 3600}}); done = true; });
      await new Promise((r) => setTimeout(r, 30));
      expect([done, clock.pending().length]).to.deep.equal([false, 1]);
      await clock.advance(3599000);
      await new Promise((r) => setTimeout(r, 10));
      expect(done, "a second before the hour").to.equal(false);
      await clock.advance(1000);
      await step;
      expect(done).to.equal(true);
      expect(Date.now() - wall0, "an hour of WAIT in wall milliseconds").to.be.lessThan(2000);
      expect(clock.now() - START).to.equal(3600000);
    });

    // ---- the long twin ------------------------------------------------------------
    // the outcome frequencies over every attempt made: within four standard
    // deviations (plus one draw) of each configured probability. This is a
    // smoke check, and a broad one: on a group of a few dozen attempts the
    // band is about 20 points wide. The oracle is the exact comparison with
    // the JavaScript twin, pile by pile and row by row (problemsAgainst,
    // logProblems); this only says the draws are not wildly off.
    const frequencyProblems = (predicted) => {
      const groups = new Map();
      for (const {config, p, pred} of predicted) {
        const made = pred.attempts.slice(0, p.attempt);
        const key = JSON.stringify([config.ok, config.slow, config.dump, config.hang]);
        const g = groups.get(key) ?? {config, n: 0, counts: {OK: 0, SLOW: 0, DUMP: 0, HANG: 0}};
        for (const a of made) { g.n++; g.counts[a.outcome]++; }
        groups.set(key, g);
      }
      const problems = [];
      for (const {config, n, counts} of groups.values()) {
        for (const [o, p] of [["OK", config.ok], ["SLOW", config.slow], ["DUMP", config.dump], ["HANG", config.hang]]) {
          const q = p / 1e6, f = counts[o] / n, tolerance = 4 * Math.sqrt(q * (1 - q) / n) + 1 / n;
          if (Math.abs(f - q) > tolerance) problems.push(`${o}: ${counts[o]} of ${n} (${f.toFixed(3)}), configured ${q}, tolerance ${tolerance.toFixed(3)}`);
        }
      }
      return {problems, groups: [...groups.values()].map((g) => ({n: g.n, ...g.counts}))};
    };

    it("the long twin: a night of 2 stages and over 200 piles, with dumps and hangs, in under a minute while the clock moves hours", async () => {
      await seedShips(110);
      await tune("simulate.time_scale", "1000000"); // on the manual clock a simulated second is a second
      await tune("retry.max", "20");
      await tune("retry.backoff", "30");
      await tune("budget.glass", "100000");
      const {run, wall, simulated, doctorReports} = await twin();
      const piles = pilesOf(run);
      const predicted = prediction(run, {retryMax: 20});
      // eslint-disable-next-line no-console
      console.log(`      long twin: ${piles.length} piles, ${piles.reduce((n, p) => n + p.attempt, 0)} attempts, ${doctorReports.filter((r) => r.startsWith("RESUBMIT")).length} resubmits; wall ${(wall / 1000).toFixed(1)} s, simulated ${(simulated / 3600).toFixed(2)} h`);
      expect(piles.length).to.be.greaterThanOrEqual(200);
      expect(new Set(piles.map((p) => p.stage_no))).to.deep.equal(new Set([1, 2]));
      expect(wall, "wall milliseconds").to.be.lessThan(60000);
      expect(simulated, "simulated seconds").to.be.greaterThan(2 * 3600);
      // every pile final as configured, the run final and its lock released
      expect(piles.every((p) => p.status === "DONE" || (p.status === "FAILED" && p.attempt === 21) || ["HELD", "FUSED"].includes(p.status))).to.equal(true);
      expect(lockRow()).to.deep.include({run_id: run, status: "RELEASED"});
      expect(recorded(run)).to.equal("work=sim,close=sim");
      expect(gates(run).every((g) => ["DONE", "PARTIAL", "NOT-RUN"].includes(g))).to.equal(true);
      // dumps and hangs happened and were healed
      const outcomes = predicted.flatMap(({p, pred}) => pred.attempts.slice(0, p.attempt).map((a) => a.outcome));
      expect(outcomes.filter((o) => o === "DUMP").length).to.be.greaterThan(10);
      expect(outcomes.filter((o) => o === "HANG").length).to.be.greaterThan(0);
      expect(doctorReports.some((r) => r.startsWith("RESUBMIT RETRY"))).to.equal(true);
      // the run is exactly what the twin says, pile by pile, row by row
      expect(problemsAgainst(run, predicted)).to.deep.equal([]);
      expect(logProblems(run, predicted)).to.deep.equal([]);
      const {problems, groups} = frequencyProblems(predicted);
      expect(problems, JSON.stringify(groups)).to.deep.equal([]);
    });

    // ---- determinism ------------------------------------------------------------
    const tableOf = (run) => ({
      piles: pilesOf(run).map(({stage_no, rule_name, pile_no, status, attempt, reason, alerts, started, ended, range_low, range_high, hits, closed, open_alerts}) =>
        ({stage_no, rule_name, pile_no, status, attempt, reason, alerts, started, ended, range_low, range_high, hits, closed, open_alerts})),
      doctor: read("SELECT seq, doc_action, reason, rule_name, pile_no, acted FROM zosd_l3_doctor WHERE run_id = ? ORDER BY seq", run),
      events: read("SELECT seq, kind, reserved, consumed, refunded, glass, amount, reason, acted FROM zosd_l3_event WHERE run_id = ? ORDER BY seq", run),
      log: read("SELECT rule_name, pile_no, alert_seq, alert_text, closed FROM zosd_l3_alert WHERE run_id = ? ORDER BY rule_name, pile_no, alert_seq", run),
    });
    // jobs of another program released beside a twin (ZGG_EX_012, a converted
    // demo report), each to start a day later, so it stays deletable (a job
    // released to start at once counts as running for BP_JOB_DELETE)
    const box = (v = "") => new abap.types.String().set(v);
    const releaseJob = (name) => dialogStep(async () => {
      const count = new abap.types.String();
      await abap.FunctionModules.JOB_OPEN({exporting: {jobname: box(name)}, importing: {jobcount: count}});
      await abap.FunctionModules.JOB_SUBMIT({exporting: {jobname: box(name), jobcount: box(count.get()), report: box("ZGG_EX_012"),
        authcknam: box(abap.builtin.sy.get().uname.get().trim())}});
      const at = new Date(clock.now() + 86400000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
      await abap.FunctionModules.JOB_CLOSE({exporting: {jobname: box(name), jobcount: box(count.get()),
        sdlstrtdt: box(at.slice(0, 8)), sdlstrttm: box(at.slice(8))}});
      return count.get();
    });
    const deleteJob = (name, count) => dialogStep(async () => {
      try {
        await abap.FunctionModules.BP_JOB_DELETE({exporting: {jobname: box(name), jobcount: box(count)}});
      } catch (error) { throw new Error(`BP_JOB_DELETE ${name} ${count}: ${error.classic ?? error.message}`); }
    });
    async function smallTwin(seed, {interfere = false} = {}) {
      await seedShips(24);
      await tune("simulate.time_scale", "1000000");
      await tune("budget.glass", "100000");
      if (seed) await tune("simulate.seed", seed);
      // with interfere: two jobs of another program released before the twin's,
      // the second deleted from the middle of the outbox, a third released after
      let before;
      if (interfere) before = [await releaseJob("SIMX_1"), await releaseJob("SIMX_2")];
      const {run} = await twin({prefix: "5EED0000", afterStart: interfere ? async () => {
        await deleteJob("SIMX_2", before[1]);
        await releaseJob("SIMX_3");
      } : undefined});
      return {run, table: tableOf(run)};
    }

    it("determinism: the same seed gives the same pile table and event log; another seed does not", async () => {
      const first = await smallTwin();
      expect(first.table.piles.length).to.be.greaterThan(10);
      expect(first.table.doctor.length, "the doctor acted").to.be.greaterThan(0);
      await fresh();
      const second = await smallTwin();
      expect(second.run).to.equal(first.run);
      for (const part of ["piles", "doctor", "log", "events"]) expect(second.table[part], part).to.deep.equal(first.table[part]);
      // jobs of another program released around the twin's, one deleted from
      // the middle of the outbox: the twin's jobs still run in their release
      // order (RELEASE_SEQ), and the same seed gives the same tables
      await fresh();
      const since = lastJob();
      const third = await smallTwin(undefined, {interfere: true});
      expect(third.run).to.equal(first.run);
      for (const part of ["piles", "doctor", "log", "events"]) expect(third.table[part], `${part}, with a deleted job between`).to.deep.equal(first.table[part]);
      const others = jobsSince(since).filter((j) => j.job_name.startsWith("SIMX_")).map((j) => j.job_name);
      expect(others, "the deleted job never reached the queue").to.deep.equal(["SIMX_1", "SIMX_3"]);
      await fresh();
      const other = await smallTwin("43");
      expect(other.run).to.equal(first.run);
      expect(other.table.piles).to.not.deep.equal(first.table.piles);
    });

    // ---- the chaos matrix ----------------------------------------------------------
    // a variant's seed and time scale are settings, whose defaults the committed
    // set gives: each test tunes the two (simulated seconds on the manual clock)
    const DEFAULTS = `simulate:
  allow_sink: [log]
  default:
    duration: {dist: fixed, value: 10}
`;
    // (a) 20% dumps
    const dumpsBlock = `${DEFAULTS}    outcome: {ok: 0.8, dump: 0.2}
    hits: {dist: fixed, value: 1}
`;
    async function dumpProblems(editSim) {
      await seedShips(30);
      await tune("budget.glass", "100000");
      await tune("simulate.time_scale", "1000000");
      return withConfig(dumpsBlock, async ({configs}) => {
        const {run, doctorReports} = await twin();
        const predicted = prediction(run, {configs});
        const problems = [...problemsAgainst(run, predicted), ...logProblems(run, predicted)];
        if (!doctorReports.some((r) => r.startsWith("RESUBMIT RETRY"))) problems.push("no pile was retried");
        if (lockRow()?.status !== "RELEASED") problems.push("the run is not final");
        return problems;
      }, {editSim});
    }
    it("chaos (a): 20% dumps: the doctor retries them and the run completes, as the twin says", async () => {
      expect(await dumpProblems()).to.deep.equal([]);
    });
    it("mutant: a dump that returns normally", async () => {
      const problems = await dumpProblems((t) => edit(t, "    IF is_draw-outcome = 'DUMP' OR is_draw-outcome = 'HANG'.\n", "    IF is_draw-outcome = 'HANG'.\n"));
      expect(problems.join("\n")).to.match(/DONE at attempt 1, the twin says (DONE at [23]|FAILED)/);
    });

    // (b) a pile that hangs twice: the doctor leaves a job that hangs past stale alone; when it ends abnormally it is retried
    const hangBlock = () => `${DEFAULTS}    outcome: {ok: 1}
  stages:
    candidates:
      keep: 1
  rules:
    ship-cargo-limit:
      outcome: {ok: 0.5, hang: 0.5}
`;
    const HANG_RUN = "4A4A0000000040008000000000000001";
    async function hangProblems(editSim) {
      // the seed whose cargo pile 1 hangs, hangs again, then completes; its other piles complete within the budget
      const variant = compileSet(manifest("hangseed", [[SET_TEXT.slice(SET_TEXT.indexOf("simulate:\n"), SET_TEXT.indexOf("settings:\n")), hangBlock()]]));
      const cargo = configOf(variant.simulate.rules.find((r) => r.rule === "ship-cargo-limit"));
      let seed;
      for (let s = 1; s < 500 && !seed; s++) {
        const outcomes = [1, 2, 3].map((attempt) => draw(cargo, {run: HANG_RUN, rule: "ship-cargo-limit", pile: 1, attempt, seed: s, scale: 1000000, stale: 900}, []).outcome);
        const others = [2, 3].every((pile) => [1, 2, 3].some((attempt) => draw(cargo, {run: HANG_RUN, rule: "ship-cargo-limit", pile, attempt, seed: s, scale: 1000000, stale: 900}, []).outcome === "OK"));
        if (outcomes.join() === "HANG,HANG,OK" && others) seed = s;
      }
      expect(seed, "a seed with the pile that hangs twice").to.be.a("number");
      await seedShips(6);
      await tune("budget.glass", "100000");
      await tune("retry.backoff", "0");
      await tune("simulate.time_scale", "1000000");
      await tune("simulate.seed", String(seed));
      return withConfig(hangBlock(), async ({configs}) => {
        const problems = [];
        const seen = [];
        // a WAIT longer than stale is a hang: at stale + 1 s, the doctor looks
        const hold = async (due) => {
          if (due - clock.now() <= 900000) return;
          const running = read("SELECT rule_name, pile_no, attempt, started FROM zosd_l3_pile WHERE status = 'RUNNING'");
          await clock.advance(901000);
          const actions = await doctor();
          seen.push({running: running.map((p) => `${p.rule_name} ${p.pile_no} ${p.attempt}`), actions});
          if (actions.some((a) => a.startsWith("FAILED"))) problems.push(`at stale + 1 s the doctor failed a hanging pile: ${actions.join("; ")}`);
          if (read("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE status = 'RUNNING'")[0].n !== 1) problems.push("the hanging pile is not RUNNING at stale + 1 s");
        };
        const {run} = await twin({bind: "work=sim", hold, prefix: "4A4A0000"});
        expect(run).to.equal(HANG_RUN);
        const pile = pilesOf(run).find((p) => p.rule_name === "ship-cargo-limit" && p.pile_no === 1);
        if (!(pile.status === "DONE" && pile.attempt === 3)) problems.push(`the pile is ${pile.status} at attempt ${pile.attempt}, not DONE at 3`);
        const hangsOfPile = seen.filter((s) => s.running.some((r) => r.startsWith("ship-cargo-limit 1 "))).length;
        if (hangsOfPile !== 2) problems.push(`the pile hung past stale ${hangsOfPile} times, not twice`);
        problems.push(...problemsAgainst(run, prediction(run, {configs, seed})));
        return problems;
      }, {editSim});
    }
    it("chaos (b): a pile that hangs twice: left alone past stale, failed when it ends, retried, done at its third attempt", async () => {
      expect(await hangProblems()).to.deep.equal([]);
    });
    it("mutant: a hang shorter than stale", async () => {
      const problems = await hangProblems((t) => edit(t, "        lv_product = lv_product + is_pile-stale.\n", ""));
      expect(problems.join("\n")).to.match(/hung past stale 0 times/);
    });

    // (c) hits that cross WARN, NARROW and GLASS
    const glassBlock = `${DEFAULTS}    outcome: {ok: 0.7, dump: 0.3}
    hits: {dist: fixed, value: 2}
  stages:
    candidates:
      outcome: {ok: 1}
      keep: 1
`;
    it("chaos (c): hits over WARN, NARROW and GLASS: never past the glass, NARROW caps the chains, GLASS stops submission, continue_glass resumes", async () => {
      await seedShips(12);
      await tune("budget.glass", "60");
      await tune("budget.warn", "1000");
      await tune("budget.narrow_at", "2500");
      await tune("retry.max", "9");
      await tune("retry.backoff", "0");
      await tune("simulate.time_scale", "1000000");
      await withConfig(glassBlock, async () => {
        let overshoot = 0, samples = 0, conflicts = 0;
        const realUpdate = client.update;
        client.update = async function (options) {
          const result = await realUpdate.call(this, options);
          // the one run of the test: the tables were emptied before it
          if (options.table.replaceAll('"', "").toLowerCase() === "zosd_l3_pile" && options.set.some((s) => /GOV-CLAIM/.test(s)) && result.dbcnt === 1) {
            const states = await this.query("SELECT state FROM zosd_l3_budget");
            if (trim(states[0]?.state) === "NARROW") {
              samples++;
              const active = await this.query("SELECT COUNT(*) AS n FROM zosd_l3_pile WHERE stage_no = 2 AND (status='RUNNING' OR (status='PLANNED' AND (job_count<>'' OR reason='GOV-CLAIM')))");
              if (Number(active[0].n) > 1) conflicts++;
            }
          }
          return result;
        };
        const after = () => {
          const b = read("SELECT reserved, glass FROM zosd_l3_budget")[0];
          if (b && b.reserved > b.glass) overshoot++;
        };
        let run;
        try {
          ({run} = await twin({bind: "work=sim", after, passes: 30}));
        } catch (e) { client.update = realUpdate; throw e; }
        // the twin stops at GLASS: the run holds its lock, nothing more is submitted
        const budget = read("SELECT * FROM zosd_l3_budget WHERE run_id = ?", run)[0];
        const kinds = read("SELECT kind FROM zosd_l3_event WHERE run_id = ? ORDER BY seq", run).map((e) => e.kind);
        expect(budget.state).to.equal("GLASS");
        expect(kinds).to.include.members(["WARN", "NARROW", "GLASS"]);
        expect(kinds.indexOf("WARN")).to.be.lessThan(kinds.indexOf("NARROW"));
        expect(kinds.indexOf("NARROW")).to.be.lessThan(kinds.indexOf("GLASS"));
        expect(budget.reserved).to.be.at.most(budget.glass);
        expect(lockRow().status).to.equal("HELD");
        const since = lastJob();
        expect((await doctor()).every((a) => a.startsWith("GLASS")), "the doctor only reports GLASS").to.equal(true);
        const resumed = await dialogStep(async () => report(await cls().resume({iv_run: str(run)})));
        expect(resumed[0]).to.match(/^GLASS/);
        await drainAndWork({after});
        expect(jobsSince(since), "no job after GLASS").to.deep.equal([]);
        // a person continues with a reason; the run completes
        const ok = await dialogStep(() => cls().continue_glass({iv_run: str(run), iv_new_glass: int(1000), iv_reason: str("chaos (c): capacity approved")}));
        expect(trim(ok.get())).to.equal("X");
        for (let pass = 0; pass < 60 && lockRow().status !== "RELEASED"; pass++) {
          await drainAndWork({after});
          clock.set(clock.now() + 900000);
          await doctor();
        }
        client.update = realUpdate;
        expect(lockRow().status).to.equal("RELEASED");
        expect(gates(run)).to.deep.equal(["DONE", "DONE"]);
        expect(overshoot, "reserved past the glass").to.equal(0);
        expect(samples, "claims under NARROW").to.be.greaterThan(0);
        expect(conflicts, "claims under NARROW with another chain active").to.equal(0);
        expect(read("SELECT kind FROM zosd_l3_event WHERE run_id = ?", run).map((e) => e.kind)).to.include("CONTINUE");
      });
    });

    // (d) a per-pile spike
    it("chaos (d): a spike of hits in one pile is HELD by the per-pile cap, the others complete", async () => {
      await seedShips(9);
      await tune("budget.glass", "100000");
      await tune("budget.per_pile", "1");
      await tune("simulate.time_scale", "1000000");
      await withConfig(`${DEFAULTS}    outcome: {ok: 1}
    hits: {dist: fixed, value: 2}
  stages:
    candidates:
      keep: 1
`, async ({configs}) => {
        const {run} = await twin({bind: "work=sim"});
        const stage2 = pilesOf(run).filter((p) => p.stage_no === 2);
        const width = (p) => read("SELECT COUNT(*) AS n FROM zosd_l3_work WHERE run_id = ? AND key_value BETWEEN ? AND ?", run, p.range_low, p.range_high)[0].n;
        expect(stage2.filter((p) => width(p) === 2).every((p) => p.status === "HELD" && p.reason === "PER-PILE")).to.equal(true);
        expect(stage2.filter((p) => width(p) === 1).every((p) => p.status === "DONE")).to.equal(true);
        expect(stage2.some((p) => p.status === "HELD") && stage2.some((p) => p.status === "DONE")).to.equal(true);
        expect(read("SELECT COUNT(*) AS n FROM zosd_l3_alert a JOIN zosd_l3_pile p ON a.run_id = p.run_id AND a.rule_name = p.rule_name AND a.pile_no = p.pile_no WHERE p.run_id = ? AND p.status = 'HELD'", run)[0].n,
          "a held pile writes nothing").to.equal(0);
        expect(gates(run)).to.deep.equal(["DONE", "PARTIAL"]);
        expect(lockRow().status).to.equal("RELEASED");
        expect(configs("ship-busy").keep).to.equal(1000000);
      });
    });

    // (e) the kill switch mid-run
    it("chaos (e): the kill switch mid-run: the rest go back to PLANNED, the doctor changes nothing, and resume( ) completes the run as the twin says", async () => {
      await seedShips(20);
      await tune("simulate.time_scale", "1000000");
      await tune("budget.glass", "100000");
      await tune("retry.max", "9");
      let jobs = 0, killedAt;
      const afterJob = async () => {
        jobs++;
        if (jobs === 14) { killedAt = jobs; await exec(["INSERT INTO zosd_l3_kill (mandt, set_name, reason) VALUES ('', 'fleet2', 'chaos (e)')"]); }
      };
      const wall0 = clock.now();
      const run = trim((await begin("work=sim,close=sim")).get().run_id.get());
      for (let pass = 0; pass < 40 && !killedAt; pass++) {
        await drainAndWork({after: afterJob});
        clock.set(clock.now() + 900000);
        if (!killedAt) await doctor();
      }
      expect(killedAt).to.equal(14);
      await drainAndWork();
      const killed = pilesOf(run).filter((p) => p.reason === "KILLED");
      expect(killed.length, "piles sent back").to.be.greaterThan(0);
      expect(killed.every((p) => p.status === "PLANNED" && !p.job_count)).to.equal(true);
      const before = pilesOf(run);
      expect(await doctor()).to.deep.equal(["KILLED the kill switch is set"]);
      expect(pilesOf(run)).to.deep.equal(before);
      await exec(["DELETE FROM zosd_l3_kill"]);
      await dialogStep(() => cls().resume({iv_run: str(run)}));
      for (let pass = 0; pass < 60 && lockRow().status !== "RELEASED"; pass++) {
        await drainAndWork();
        clock.set(clock.now() + 900000);
        await doctor();
      }
      expect(lockRow().status).to.equal("RELEASED");
      expect(clock.now()).to.be.greaterThan(wall0);
      // a kill spends no attempt: the run ends as the uninterrupted twin says
      const predicted = prediction(run, {retryMax: 9});
      expect(problemsAgainst(run, predicted)).to.deep.equal([]);
      expect(logProblems(run, predicted)).to.deep.equal([]);
    });

    // ---- round 2: a simulated run and a real one of the same set and date ------------
    // a real fleet to alert on: S001 in maintenance with a voyage ahead, among the twin's ships
    const realFleet = async (n = 20) => {
      await seedShips(n);
      await exec(["UPDATE zosd_l2_ship SET status = 'M' WHERE ship_id = 'S001'",
        "INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123', 'V00001', 'S001', '20991005')"]);
    };
    const runReal = async (mode = "S") => trim((await dialogStep(() => cls().run({iv_date: new abap.types.Date().set(DATE),
      iv_mode: new abap.types.Character(1).set(mode)}))).get().run_id.get());
    const logOf = (run) => read("SELECT rule_name, pile_no, alert_seq, model_hash, alert_text FROM zosd_l3_alert WHERE run_id = ? ORDER BY rule_name, pile_no, alert_seq", run);
    // every path that finalises, purges or heals, against a simulated run of
    // the date: none may touch a real run's rows, and a real run none of the twin's
    async function sharedDateProblems() {
      const problems = [];
      await realFleet();
      await tune("simulate.time_scale", "1000000");
      await tune("budget.glass", "100000");
      const real = await runReal();
      const sentinel = logOf(real);
      if (!sentinel.length || sentinel.some((r) => !r.model_hash.startsWith("sha256:"))) problems.push(`the real run logged ${sentinel.length} real rows`);
      const intact = (when) => {
        const now = logOf(real);
        if (JSON.stringify(now) !== JSON.stringify(sentinel)) problems.push(`${when}: the real run's rows are ${now.length}, were ${sentinel.length}`);
      };
      const {run: sim, result} = await twin();
      intact("after the twin");
      // a finalisation that was interrupted: the twin's lock HELD again, long ago
      await exec([`UPDATE zosd_l3_run SET status = 'HELD' WHERE set_name = 'fleet2' AND check_date = '${DATE}'`]);
      clock.set(clock.now() + 2 * 3600000);
      const report = await doctor();
      if (!report.includes("RELEASE ALL-FINAL")) problems.push(`the doctor answered ${JSON.stringify(report)}, not RELEASE ALL-FINAL`);
      intact("after the doctor's RELEASE ALL-FINAL");
      // a collect( ) with no binding at all, a resume( ), a purge( )
      result.get().bind.set("");
      await exec([`UPDATE zosd_l3_run SET status = 'HELD' WHERE set_name = 'fleet2' AND check_date = '${DATE}'`]);
      await dialogStep(() => cls().collect({is_result: result}));
      intact("after collect( ) without a binding");
      await dialogStep(() => cls().resume({iv_run: str(sim)}));
      intact("after resume( )");
      await dialogStep(() => cls().purge({}));
      intact("after purge( )");
      await exec([`UPDATE zosd_l3_run SET status = 'RELEASED' WHERE set_name = 'fleet2' AND check_date = '${DATE}'`]);
      // the reverse: a real run of the date leaves the twin's rows
      const twinRows = logOf(sim);
      if (!twinRows.length || twinRows.some((r) => !r.model_hash.startsWith("sim256:"))) problems.push(`the twin logged ${twinRows.length} sim256: rows`);
      await runReal();
      if (JSON.stringify(logOf(sim)) !== JSON.stringify(twinRows)) problems.push(`a real run of the date changed the twin's rows: ${logOf(sim).length}, were ${twinRows.length}`);
      return problems;
    }
    it("P1: a real run's alerts survive the doctor, collect( ), resume( ) and purge( ) of a simulated run of the same date, and the reverse", async () => {
      expect(await sharedDateProblems()).to.deep.equal([]);
    });
    it("mutant: finalise with the default hash, not the run's own", async () => {
      const name = "zcl_l3_fleet2_m_final";
      await loadAs(RUNNER, name, edit(committed(RUNNER), "      lv_hash = sim_hash( iv_hash ).\n", "      lv_hash = iv_hash.\n"));
      const problems = await answering(RUNNER, name, () => sharedDateProblems());
      expect(problems.join("\n")).to.match(/the real run's rows are \d+, were \d+|changed the twin's rows/);
    });

    // ---- round 2: a run keeps the work it started with --------------------------------
    // a real run in jobs whose min-crew pile dumps once: the doctor fails it
    async function realWithFailedPile() {
      await realFleet(6);
      await tune("budget.glass", "100000");
      const real = abap.Classes.ZCL_L2_SHIP_MIN_CREW.check;
      let left = 1;
      abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = async function (...args) {
        if (left > 0) { left--; throw new Error("min crew dumps (a test fault)"); }
        return real.apply(this, args);
      };
      try {
        const run = await runReal("P");
        await drainAndWork();
        clock.set(clock.now() + 60000);
        await doctor();
        return run;
      } finally { abap.Classes.ZCL_L2_SHIP_MIN_CREW.check = real; }
    }
    const failedOf = (run) => pilesOf(run).filter((p) => p.status === "FAILED");
    async function overrideProblems() {
      const problems = [];
      const run = await realWithFailedPile();
      if (!failedOf(run).length) problems.push("no pile failed");
      if (recorded(run) !== "work=real") problems.push(`the run recorded ${recorded(run)}`);
      const answer = await dialogStep(async () => report(await cls().resume({iv_run: str(run), iv_bind: str("work=sim")})));
      if (JSON.stringify(answer) !== JSON.stringify(["REFUSED WORK-BIND"])) problems.push(`resume( work=sim ) answered ${JSON.stringify(answer)}`);
      await drainAndWork();
      // healed with the run's own binding, as a real run
      await dialogStep(() => cls().resume({iv_run: str(run)}));
      for (let pass = 0; pass < 10 && lockRow()?.status !== "RELEASED"; pass++) { await drainAndWork(); clock.set(clock.now() + 900000); await doctor(); }
      if (lockRow()?.status !== "RELEASED") problems.push("the real run did not complete");
      const sims = read("SELECT COUNT(*) AS n FROM zosd_l3_alert WHERE alert_text LIKE 'SIM%' OR model_hash LIKE 'sim256:%'")[0].n;
      if (sims) problems.push(`${sims} SIM rows in a real run's log`);
      if (recorded(run) !== "work=real") problems.push(`the run's record became ${recorded(run)}`);
      return problems;
    }
    it("P2-a: resume( ) refuses a work binding the run did not start with, and heals it as it started", async () => {
      expect(await overrideProblems()).to.deep.equal([]);
    });
    it("mutant: resume( ) accepts a work override", async () => {
      const name = "zcl_l3_fleet2_m_override";
      const text = committed(RUNNER);
      const from = text.slice(text.indexOf("    IF sim_named( iv_bind ) IS NOT INITIAL\n       AND"), text.indexOf("    heal( EXPORTING iv_run = ls_lock-run_id\n                    iv_date = ls_lock-check_date\n                    iv_now = lv_now\n                    iv_force = abap_true"));
      expect(from).to.match(/REFUSED/);
      await loadAs(RUNNER, name, edit(edit(text, from, ""), "    IF rv_bind IS INITIAL.\n      rv_bind = iv_bind.\n    ENDIF.\n",
        "    IF iv_bind IS NOT INITIAL.\n      rv_bind = iv_bind.\n    ENDIF.\n"));
      const problems = await answering(RUNNER, name, () => overrideProblems());
      expect(problems.join("\n")).to.match(/resume\( work=sim \) answered|SIM rows/);
    });
    it("P2-a: a factory whose default is sim does not make the doctor resubmit a run that started real as a simulated one", async () => {
      const run = await realWithFailedPile();
      expect(failedOf(run).length).to.be.greaterThan(0);
      const file = manifest("defaultsim", [["  work: real\n", "  work: sim\n"]]);
      const {files} = await renderSet(compileSet(file));
      const name = `zcl_l3_fleet2_ports_d${++variantCount}`;
      await loadAs(PORTS, name, files[`${PORTS}.clas.abap`]);
      await answering(PORTS, name, async () => {
        expect(trim((await cls(PORTS).variant({iv_port: str("work")})).get())).to.equal("sim");
        for (let pass = 0; pass < 10 && lockRow()?.status !== "RELEASED"; pass++) { clock.set(clock.now() + 900000); await doctor(); await drainAndWork(); }
      });
      expect(lockRow()?.status).to.equal("RELEASED");
      expect(pilesOf(run).every((p) => p.status === "DONE")).to.equal(true);
      expect(read("SELECT COUNT(*) AS n FROM zosd_l3_alert WHERE alert_text LIKE 'SIM%' OR model_hash LIKE 'sim256:%'")[0].n).to.equal(0);
    });

    // ---- round 2: no draw state in statics ---------------------------------------------
    // two simulated runs in their own dialog steps at once (mode S, two dates,
    // seeds 42 and 43): each waits while the other draws, and each run's hits
    // and chance closures are what the twin says for its own seed
    const interleaveBlock = `${"simulate:\n  allow_sink: [log]\n  default:\n    duration: {dist: fixed, value: 30}\n"}    outcome: {ok: 1}
    hits: {dist: fixed, value: 2}
    autoclose: 0.5
  stages:
    candidates:
      keep: 1
`;
    const D2 = "20991002";
    async function interleavedProblems(editClose) {
      await seedShips(8);
      await tune("simulate.time_scale", "1000000");
      await tune("budget.glass", "100000");
      await tune("simulate.seed", "42");
      return withConfig(interleaveBlock, async ({configs}) => {
        const problems = [];
        const runOn = (day) => dialogStep(() => cls().run({iv_date: new abap.types.Date().set(day), iv_bind: str("work=sim,close=sim")}));
        const results = await virtual(async () => {
          const a = runOn(DATE);
          while (!clock.pending().length) await new Promise((r) => setTimeout(r, 1));
          await tune("simulate.seed", "43");
          const b = runOn(D2);
          return Promise.all([a, b]);
        });
        for (const [result, seed] of [[results[0], 42], [results[1], 43]]) {
          const run = trim(result.get().run_id.get());
          const work = read("SELECT key_value FROM zosd_l3_work WHERE run_id = ? ORDER BY key_value", run).map((r) => r.key_value);
          const want = [];
          for (const p of pilesOf(run).filter((x) => x.stage_no === 2)) {
            const keys = work.filter((k) => k >= p.range_low && k <= p.range_high);
            const config = configs(p.rule_name);
            const d = draw(config, {run, rule: p.rule_name, pile: p.pile_no, attempt: 0, seed, scale: 1000000, stale: 900}, keys);
            d.keys.forEach((k, i) => want.push(`${p.rule_name} ${p.pile_no} ${i + 1} ${alertText(config, {pile: p.pile_no, attempt: 0}, k)} ${closes(config, {seed, run, rule: p.rule_name, key: k}) ? "X" : "-"}`));
          }
          const got = read("SELECT rule_name, pile_no, alert_seq, alert_text, closed FROM zosd_l3_alert WHERE run_id = ?", run)
            .map((r) => `${r.rule_name} ${r.pile_no} ${r.alert_seq} ${r.alert_text} ${r.closed === "X" ? "X" : "-"}`);
          got.sort(); want.sort();
          if (!got.length) problems.push(`seed ${seed}: no rows`);
          if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`seed ${seed}: ${got.filter((l, i) => l !== want[i]).length} rows differ from the twin, first ${got.find((l, i) => l !== want[i])}`);
        }
        return problems;
      }, {editClose});
    }
    it("P2-b: two runs drawing at once, each with its own seed, each match the twin", async () => {
      expect(await interleavedProblems()).to.deep.equal([]);
    });
    it("mutant: a chance autoclose with a static seed (the first run's)", async () => {
      const problems = await interleavedProblems((t) => edit(edit(t, "    INTERFACES zif_l3_fleet2_close.\n", "    INTERFACES zif_l3_fleet2_close.\n    CLASS-DATA gv_seed TYPE i.\n"),
        "        lv_seed = seed_of( lv_run ).\n", "        IF gv_seed IS INITIAL.\n          gv_seed = seed_of( lv_run ).\n        ENDIF.\n        lv_seed = gv_seed.\n"));
      expect(problems.join("\n")).to.match(/seed 43: \d+ rows differ/);
    });

    // ---- round 2: the manual clock and the real scheduler ------------------------------
    it("P2-c: one advance of 3660 s, with the real scheduler and a job that waits 79 s on the same clock, completes the job", async () => {
      await seedShips(2);
      await tune("simulate.time_scale", "1000000");
      await tune("budget.glass", "100000");
      await withConfig(`${"simulate:\n  allow_sink: [log]\n  default:\n    duration: {dist: fixed, value: 79}\n"}    outcome: {ok: 1}
  stages:
    candidates:
      keep: 0
`, async () => {
        const {JobScheduler} = await import("../tools/osd-job-scheduler.mjs");
        const run = trim((await begin("work=sim")).get().run_id.get());
        const scheduler = new JobScheduler({root, store, env: process.env, clock});
        // the scheduler's pass is a timer of the clock, due at +60 s; the job it
        // runs waits 79 s on the same clock
        const start0 = clock.now();
        clock.setTimer(() => scheduler.tick(), 60000);
        const advanced = clock.advance(3660000).then(() => "advanced");
        const stall = new Promise((r) => setTimeout(() => r("stalled"), 20000));
        expect(await Promise.race([advanced, stall])).to.equal("advanced");
        scheduler.stop();
        expect(clock.now() - start0).to.equal(3660000);
        const pile = pilesOf(run).find((p) => p.stage_no === 1);
        expect(pile).to.include({status: "DONE"});
        expect(stamp(pile.ended) - stamp(pile.started)).to.equal(79);
      });
    });
    it("a WAIT on a manual clock nobody moves ends at its wall-clock ceiling, and says so", async () => {
      const {setWaitClock} = await import("../tools/osd-dialog-step.mjs");
      const restore = setWaitClock(clock, {ceilingMs: 300});
      const said = [];
      const error = console.error;
      console.error = (...items) => said.push(items.join(" "));
      const wall0 = Date.now();
      try {
        await dialogStep(async () => { await abap.statements.wait({seconds: {get: () => 3600}}); });
      } finally { console.error = error; restore(); }
      expect(Date.now() - wall0).to.be.within(250, 5000);
      expect(said.join("\n")).to.match(/WAIT UP TO 3600 s on an injected clock: nobody moved the clock for 300 ms/);
      expect(clock.pending(), "its timer is gone").to.deep.equal([]);
    });

    // ---- round 2 (dell): the outbox in release order -----------------------------------
    it("the outbox imports the jobs one second released in release order, a deleted one leaving a gap", async () => {
      await drainAndWork();
      const since = lastJob();
      const a = await releaseJob("SIMO_A");
      const b = await releaseJob("SIMO_B");
      await releaseJob("SIMO_C");
      await deleteJob("SIMO_B", b);
      await releaseJob("SIMO_D");
      const seqs = read("SELECT jobname, release_seq FROM zosd_job_outbox WHERE jobname LIKE 'SIMO_%' ORDER BY release_seq").map((r) => r.jobname);
      expect(seqs).to.deep.equal(["SIMO_A", "SIMO_C", "SIMO_D"]);
      await drainJobOutbox(store);
      expect(jobsSince(since).map((j) => j.job_name)).to.deep.equal(["SIMO_A", "SIMO_C", "SIMO_D"]);
      expect(a).to.be.a("string");
      await drainAndWork();
    });

    // ---- the run-time half of the safety rule ------------------------------------
    async function factoryProblems(editFactory = (t) => t) {
      const file = manifest("noallow", [["  allow_sink: [log]\n", ""]]);
      const {files} = await renderSet(compileSet(file));
      const name = `zcl_l3_fleet2_ports_s${++variantCount}`;
      await loadAs(PORTS, name, editFactory(files[`${PORTS}.clas.abap`]));
      return answering(PORTS, name, async () => {
        const problems = [];
        const refusal = async (bind, parallel) => {
          try {
            await cls(PORTS).check({iv_bind: str(bind), ...(parallel ? {iv_parallel: new abap.types.Character(1).set("X")} : {})});
            return undefined;
          } catch (e) { return String(e?.reason?.get?.() ?? e?.message ?? e); }
        };
        const onLog = await refusal("work=sim", true);
        if (!/production sink/.test(onLog ?? "")) problems.push(`work=sim on the log: ${onLog ?? "allowed"}`);
        if (await refusal("work=sim,alerts=capture", false) !== undefined) problems.push("work=sim on capture in a step is refused");
        if (!/replay/.test(await refusal("work=sim,alerts=capture,ships=capture", false) ?? "")) problems.push("work=sim in a replay is allowed");
        if (!/only beside work=sim/.test(await refusal("close=sim", false) ?? "")) problems.push("close=sim without work=sim is allowed");
        return problems;
      });
    }
    it("the factory refuses a simulated run on a production sink that allow_sink does not name, in a replay, and a sim autoclose without it", async () => {
      expect(await factoryProblems()).to.deep.equal([]);
    });
    it("mutant: a factory that lets a simulated run write to a production sink", async () => {
      const problems = await factoryProblems((t) => edit(t, "      IF lv_sink = 'log'.\n", "      IF lv_sink = 'none of them'.\n"));
      expect(problems.join("\n")).to.match(/work=sim on the log: allowed/);
    });

    it("a real run of the same runner is unchanged: work=real calls the L2 classes and writes under the real hash", async () => {
      await seedShips(0);
      await exec(["INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123', 'S001', 'Albatross', 'M')",
        "INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123', 'V00001', 'S001', '20991005')"]);
      const result = await dialogStep(() => cls().run({iv_date: new abap.types.Date().set(DATE)}));
      const run = trim(result.get().run_id.get());
      const rows = read("SELECT model_hash, alert_text FROM zosd_l3_alert WHERE run_id = ?", run);
      expect(rows.length).to.be.greaterThan(0);
      expect(rows.every((r) => r.model_hash.startsWith("sha256:") && !r.alert_text.startsWith("SIM"))).to.equal(true);
      expect(recorded(run)).to.equal("work=real");
    });
  });
});
