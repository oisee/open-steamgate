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
import {basename, join, relative, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {buildRule} from "../tools/dsl-l2.mjs";
import {buildSet, checkSet, compileSet, explainAlert, parseAlertKey, SetError} from "../tools/dsl-l3.mjs";
import {lowerNarrowSubmit} from "../tools/osd-narrow-submit.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const SET = "src/l2demo/fleet.l3.yaml";
const CORE = ".local/lars/open-abap-core/src";
const OUT = "src/l2demo";
const RUNNER = "zcl_l3_fleet";
const REPORT = "zl3_fleet";
const SET_TEXT = readFileSync(SET, "utf8");
const DATE = "20261001";
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
      for (const f of [`${RUNNER}.clas.abap`, `${RUNNER}.clas.xml`, `${RUNNER}.clas.trace.json`,
        `${REPORT}.prog.abap`, `${REPORT}.prog.xml`, `${REPORT}.prog.trace.json`]) {
        writeFileSync(join(copy, f), readFileSync(join(OUT, f)));
      }
      const file = join(copy, `${RUNNER}.clas.abap`);
      writeFileSync(file, readFileSync(file, "utf8").replace("MODIFY zosd_l3_alert", "INSERT zosd_l3_alert"));
      expect(await checkSet(SET, copy)).to.deep.equal([`${RUNNER}.clas.abap: differs from a fresh build`]);
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
    it("an unknown key", () => refused("key", "date: $date", "date: $date\nschedule: nightly", /^unknown key schedule/, /^schedule:/));
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
      writeFileSync(rule, readFileSync(join(OUT, "ship_captain.l2.yaml"), "utf8").replace("ship.status = 'A'", "ship.colour = 'A'"));
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
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    const log = () => read("SELECT * FROM zosd_l3_alert ORDER BY set_name, rule, model_hash, check_date, alert_seq")
      .map((r) => ({set: r.set_name.trim(), rule: r.rule.trim(), hash: r.model_hash.trim(), date: r.check_date,
        seq: Number(r.alert_seq), text: String(r.alert_text), run: r.run_id.trim(), ts: Number(r.run_ts),
        file: r.rule_file.trim(), line: Number(r.rule_line), class: r.rule_class.trim()})).sort(byKey);
    const content = (rows) => rows.map(({run, ts, ...rest}) => rest);
    // one order for the log and for the checks' answers: by key
    const byKey = (a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.seq - b.seq);
    const plain = (result) => {
      const r = result.get();
      return {run: r.run_id.get().trim(), mode: r.mode.get(), alerts: r.alerts.get(), date: r.check_date.get(),
        rules: r.rules.array().map((x) => Object.fromEntries(["rule", "model_hash", "jobname", "jobcount", "status", "alerts", "failed"]
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
    const runSet = (className, mode = "S") => dialogStep(() => abap.Classes[className.toUpperCase()].run({
      iv_date: date(), iv_mode: new abap.types.Character(1).set(mode)})).then(plain);
    const clearLog = () => exec(["DELETE FROM zosd_l3_alert"]);

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
    after(async () => {
      if (client) await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), "DELETE FROM zosd_l3_alert"]).catch(() => {});
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
      if (JSON.stringify(content(once)) !== JSON.stringify(want)) problems.push(`the log after one run is not the union of the checks: ${JSON.stringify(content(once))}`);
      for (const r of first.rules) if (r.status !== "DONE") problems.push(`${r.rule}: status ${r.status} after the first run`);
      for (const row of once) {
        const rule = model.rules.find((r) => r.name === row.rule);
        if (!rule || row.hash !== rule.hash) problems.push(`${row.rule} ${row.seq}: model hash ${row.hash} is not the rule's ${rule?.hash}`);
      }
      if (first.alerts !== want.length) problems.push(`the result counts ${first.alerts} alerts, the checks ${want.length}`);
      const second = await runSet(className);
      const twice = log();
      if (JSON.stringify(content(twice)) !== JSON.stringify(content(once))) problems.push(`a rerun changed the log: ${JSON.stringify(content(twice))}`);
      const keys = twice.map((r) => `${r.set}/${r.rule}/${r.hash}/${r.date}/${r.text}`);
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

    it("a rerun that finds fewer alerts drops the rows past the last one (same rule, hash and date)", async () => {
      await clearLog();
      await runSet(RUNNER);
      expect(log().filter((r) => r.rule === "ship-min-crew")).to.have.length(2);
      await exec(["INSERT INTO zosd_l2_crew (mandt, crew_id, ship_id, role, since) VALUES ('123', 'C00009', 'S003', 'C', '20260101')"]);
      try {
        await runSet(RUNNER);
        const after = log();
        expect(after.filter((r) => r.rule === "ship-min-crew").map((r) => [r.seq, r.text])).to.deep.equal([[1, "S002 Bluebird: 1 crew aboard"], [2, "S003 Condor: 1 crew aboard"]]);
        expect(after.filter((r) => r.rule === "ship-in-service-has-a-captain")).to.have.length(0);
        expect(content(after)).to.deep.equal(await expected());
      } finally {
        await exec(["DELETE FROM zosd_l2_crew WHERE crew_id = 'C00009'"]);
      }
    });

    describe("mode P: one background job per rule", () => {
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
      const runParallel = async () => {
        let raw;
        const submitted = await dialogStep(async () => {
          raw = await abap.Classes.ZCL_L3_FLEET.run({iv_date: date(), iv_mode: new abap.types.Character(1).set("P")});
          return raw;
        }).then(plain);
        return {...submitted, raw};
      };

      before(async () => {
        await clearLog();
        await runSet(RUNNER);
        sequential = content(log());
      });

      it("submits six jobs, each runs as its own step, and collect reports every rule finished", async () => {
        await clearLog();
        const submitted = await runParallel();
        expect(submitted.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("SUBMITTED"));
        expect(submitted.rules.map((r) => r.jobname)).to.deep.equal(model.rules.map((_, i) => `L3_FLEET_0${i + 1}`));
        expect(log(), "nothing is written before the jobs run").to.deep.equal([]);
        const before = await collect(submitted);
        expect(before.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("READY"));
        const {drained, outcomes} = await drainAndWork();
        expect(drained.imported).to.equal(6);
        expect(outcomes).to.have.length(6);
        const steps = read("SELECT program, input_json FROM zosd_job_step");
        expect(steps, "the steps are acknowledged and gone from the outbox").to.deep.equal([]);
        const runs = store.list().filter((r) => r.jobName.startsWith("L3_FLEET_"));
        expect(runs.map((r) => r.state)).to.deep.equal(Array(6).fill("COMPLETED"));
        const collected = await collect(submitted);
        expect(collected.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("FINISHED"));
        expect(collected.alerts).to.equal(7);
        expect(collected.rules.map((r) => r.alerts)).to.deep.equal(model.rules.map((r) => sequential.filter((x) => x.rule === r.name).length));
        const rows = log();
        expect(content(rows), "the same log as mode S").to.deep.equal(sequential);
        expect(new Set(rows.map((r) => r.run))).to.deep.equal(new Set([submitted.run]));
      });

      it("a second parallel run (a retry) leaves the same log, under its own run id", async () => {
        const submitted = await runParallel();
        const {outcomes} = await drainAndWork();
        expect(outcomes).to.have.length(6);
        const collected = await collect(submitted);
        expect(collected.rules.map((r) => r.status)).to.deep.equal(Array(6).fill("FINISHED"));
        const rows = log();
        expect(content(rows)).to.deep.equal(sequential);
        expect(new Set(rows.map((r) => r.run))).to.deep.equal(new Set([submitted.run]));
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
      const deps = ["src/dsl/zosd_l3_alert.tabl.xml", "src/jobs/tbtcjob.tabl.xml", "src/jobs/btcselect.tabl.xml", "src/jobs/btch0000.tabl.xml",
        "gen/gui/zcl_osd_batch_report.clas.abap",
        ...readdirSync(OUT).filter((f) => /^zosd_l2_.*\.(tabl|dtel)\.xml$/.test(f)).map((f) => join(OUT, f)),
        ...model.rules.flatMap((r) => [`${OUT}/${r.check_class}.clas.abap`, `${OUT}/${r.check_class}.clas.xml`]),
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
      for (const f of Object.keys(files).filter((f) => f.endsWith(".clas.abap"))) {
        await import(pathToFileURL(join(out, f.replace(/\.abap$/, ".mjs"))).href);
      }
      expect(abap.Classes[name.toUpperCase()], `${name} loaded`).to.exist;
    }
    const renamed = (name, text = readFileSync(join(OUT, `${RUNNER}.clas.abap`), "utf8")) => text.replaceAll(RUNNER, name);
    const mutate = (text, from, to) => {
      expect(text, `the runner holds ${JSON.stringify(from)}`).to.include(from);
      return text.replace(from, to);
    };

    describe("mutants of the runner", () => {
      it("control: the runner under another name, transpiled alone, passes the log check", async () => {
        await loadRunner("zcl_l3_fleet_ok", renamed("zcl_l3_fleet_ok"));
        expect((await logProblems("zcl_l3_fleet_ok")).problems).to.deep.equal([]);
      });

      it("INSERT instead of MODIFY: the rerun cannot rewrite its rows", async () => {
        await loadRunner("zcl_l3_fleet_m1", mutate(renamed("zcl_l3_fleet_m1"), "      MODIFY zosd_l3_alert FROM ls_row.", "      INSERT zosd_l3_alert FROM ls_row."));
        const {problems} = await logProblems("zcl_l3_fleet_m1");
        expect(problems.join("\n")).to.match(/status WRITE-FAILED after the rerun/);
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
        const key = `${row.set}/${row.rule}/${row.hash}/${row.date}/${row.seq}`;
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

      it("the command reads the alert row from the database file", () => {
        const row = log().find((r) => r.rule === "ship-cargo-limit");
        const run = spawnSync(process.execPath, ["tools/dsl-l3.mjs", "explain", `fleet/ship-cargo-limit/${row.hash.slice(7, 19)}/${DATE}/1`, "--db", dbPath], {encoding: "utf8"});
        expect(run.status, run.stderr).to.equal(0);
        expect(run.stdout).to.include("text    S003: 1100.50 kg booked");
        expect(run.stdout).to.match(/line {4}src\/l2demo\/ship_cargo_limit\.l2\.yaml:9: alert:/);
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
