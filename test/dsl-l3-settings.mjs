// DSL L3 settings: application-data defaults, tuning, read-once runs and trace.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {basename, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, explainAlert, renderSet, SetError} from "../tools/dsl-l3.mjs";
import {compileSettings} from "../tools/dsl-l3-settings.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const SET = "src/l2demo/fleet2.l3.yaml";
const DATE = "20261001";
const TABLES = ["zosd_l3_budget", "zosd_l3_event", "zosd_l3_object", "zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_stage", "zosd_l3_work", "zosd_l3_doctor",
  "zosd_l3_kill", "zosd_l3_conf", "zosd_l3_conf_log", "zosd_l3_run_conf"];
const FLEET = {
  zosd_l2_ship: [["S001", "Albatross", "M"], ["S002", "Bluebird", "A"], ["S003", "Condor", "A"], ["S004", "Dove", "A"]],
  zosd_l2_voy: [["V00001", "S001", "20261005"], ["V00002", "S002", "20261010"], ["V00003", "S002", "20261011"],
    ["V00004", "S002", "20261012"], ["V00005", "S004", "20260901"], ["V00099", "S003", "20261020"]],
  zosd_l2_crew: [["C00001", "S001", "P", "20260101"], ["C00002", "S002", "C", "20260101"],
    ["C00003", "S004", "C", "20260101"], ["C00004", "S004", "P", "20260101"]],
  zosd_l2_cargo: [["K00001", "S003", "600.50"], ["K00002", "S003", "500.00"], ["K00003", "S004", "1.25"]],
};
const COLUMNS = {zosd_l2_ship: ["ship_id", "name", "status"], zosd_l2_voy: ["voyage_id", "ship_id", "dep_date"],
  zosd_l2_crew: ["crew_id", "ship_id", "role", "since"], zosd_l2_cargo: ["cargo_id", "ship_id", "weight"]};
const trim = (v) => typeof v === "string" ? v.trim() : v;

describe("DSL L3 slice 5b: settings", function () {
  this.timeout(900000);
  it("generates a fresh fleet2 and keeps fleet byte-identical", async () => {
    expect(await checkSet(SET, "src/l2demo")).to.deep.equal([]);
    expect(await checkSet("src/l2demo/fleet.l3.yaml", "src/l2demo")).to.deep.equal([]);
  });
  it("refuses unavailable names and bounds outside compiler ranges", () => {
    const text = readFileSync(SET, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "dsl-settings-manifest-"));
    try {
      for (const [from, to, message] of [["retry.max,", "retry.unknown,", /unavailable tunable/],
        ["max: 100000", "max: 2147483648", /bounds must lie within/],
        // a fuse tunable without a ceiling could be tuned off (up to INT4)
        ["    fuses.max_alerts: {min: 1, max: 100000}", "    retry.max: {min: 0, max: 99}", /fuses\.max_alerts is tunable only with bounds/]]) {
        const file = join(dir, "fleet2.l3.yaml");
        writeFileSync(file, text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, f) => `rule: ${join(process.cwd(), "src/l2demo", f)}`)
          .replace(from, to));
        expect(() => compileSet(file)).to.throw(SetError).and.to.match(message);
      }
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
  it("keeps integer parameter ranges and refuses unsupported parameter encodings", () => {
    const model = {"@id": "set/test", set: "test", params: [{name: "counter", default: "-1", type_name: "zosd_l2_days",
      "default@type": {built_in: "INT2", length: 5}}]};
    const compile = (bounds) => compileSettings({settings: {tunable: ["params.counter"], ...(bounds ? {bounds} : {})}}, model,
      {line: () => 1, fail: (_line, reason) => { throw new Error(reason); }});
    expect(compile().entries[0]).to.include({min: "-32768", max: "32767", value_type: "zosd_l2_days"});
    expect(() => compile({"params.counter": {max: "32768"}})).to.throw(/bounds must lie within/);
    model.params[0].default = "9223372036854775807";
    model.params[0]["default@type"].built_in = "INT8";
    expect(compile().entries[0].max).to.equal("9223372036854775807");
    model.params[0]["default@type"].built_in = "DEC";
    expect(() => compile()).to.throw(/unavailable tunable/);
  });
  it("renders schedule, parameter and each stage pile from typed settings", async () => {
    const text = readFileSync(SET, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "dsl-settings-surface-"));
    try {
      const file = join(dir, "fleet2.l3.yaml");
      writeFileSync(file, text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, f) => `rule: ${join(process.cwd(), "src/l2demo", f)}`)
        .replace("piles.checks.size]", "piles.checks.size, piles.candidates.size, schedule.every, params.active_status]"));
      const model = compileSet(file);
      const {files} = await renderSet(model);
      const runner = files["zcl_l3_fleet2.clas.abap"];
      const helper = files["zcl_l3_fleet2_conf.clas.abap"];
      expect(runner).to.include("gs_settings-vals-piles_candidates_size");
      expect(runner).to.include("gs_settings-vals-piles_checks_size");
      expect(runner).to.include("gs_settings-vals-params_active_status");
      expect(runner).to.include("prdweeks = lv_weeks");
      expect(helper).to.include("params.active_status");
      expect(helper).to.include("schedule.every");
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
  it("marks what belongs to a run (fuse, pile sizes, parameters) and what is the pass's policy", () => {
    const model = compileSet(SET);
    expect(model.settings.entries.map((e) => [e.name, e.scoped])).to.deep.equal([["budget.glass", true], ["budget.warn", true], ["budget.narrow_at", true], ["budget.per_pile", true], ["retry.max", false], ["retry.backoff", false],
      ["stale", false], ["fuses.max_alerts", true], ["keep.days", false], ["piles.checks.size", true]]);
  });
  it("a dry run reads its settings without seeding, logging or a snapshot", async () => {
    const text = readFileSync(SET, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "dsl-settings-dry-"));
    try {
      const file = join(dir, "fleet2.l3.yaml");
      writeFileSync(file, text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, f) => `rule: ${join(process.cwd(), "src/l2demo", f)}`)
        .replace("dry_run: false", "dry_run: true"));
      const runner = (await renderSet(compileSet(file))).files["zcl_l3_fleet2.clas.abap"];
      const dry = runner.slice(runner.indexOf("  METHOD dry."), runner.indexOf("ENDMETHOD.", runner.indexOf("  METHOD dry.")));
      expect(dry).to.include("gv_dry = abap_true.");
      const run = runner.slice(runner.indexOf("  METHOD run."), runner.indexOf("  METHOD plan."));
      expect(run).to.include("IF lv_dry = abap_true.\n      gs_settings = zcl_l3_fleet2_conf=>load( iv_write = abap_false ).");
      expect(run).to.include("IF lv_dry = abap_false.\n      zcl_l3_fleet2_conf=>snapshot(");
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
  it("renders the unstaged piles.size through the same settings structure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsl-settings-piles-"));
    try {
      const file = join(dir, "fleet.l3.yaml");
      writeFileSync(file, readFileSync("src/l2demo/fleet.l3.yaml", "utf8")
        .replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, f) => `rule: ${join(process.cwd(), "src/l2demo", f)}`)
        + "\nsettings:\n  tunable: [piles.size]\n");
      const model = compileSet(file);
      const {files} = await renderSet(model);
      expect(files["zcl_l3_fleet.clas.abap"]).to.include("gs_settings-vals-piles_size");
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });

  describe("on the file database", () => {
    let dir, dbPath, envBefore, priorAbap, priorContext, abap, client, dialogStep;
    const date = () => new abap.types.Date().set(DATE);
    const str = (s) => new abap.types.String().set(s);
    const cls = () => abap.Classes.ZCL_L3_FLEET2;
    const conf = () => abap.Classes.ZCL_L3_FLEET2_CONF;
    const read = (sql, ...args) => {
      const db = new DatabaseSync(dbPath, {readOnly: true});
      try { return db.prepare(sql).all(...args); } finally { db.close(); }
    };
    const exec = (statements) => dialogStep(async () => { for (const s of statements) await client.execute(s); });
    const run = () => dialogStep(() => cls().run({iv_date: date(), iv_mode: new abap.types.Character(1).set("S")}))
      .then((raw) => ({run: trim(raw.get().run_id.get()), status: trim(raw.get().status.get()),
        warnings: raw.get().settings_warnings.array().map((x) => trim(x.get())),
        rules: raw.get().rules.array().map((x) => ({name: trim(x.get().rule.get()), status: trim(x.get().status.get())}))}));
    const set = (name, value, note = "test tune") => dialogStep(() => cls().set_setting({iv_param: str(name), iv_value: str(value), iv_note: str(note)}))
      .then((x) => trim(x.get()) === "X");
    const reset = (name) => dialogStep(() => cls().reset_setting({iv_param: str(name)})).then((x) => trim(x.get()) === "X");
    const seed = () => dialogStep(() => cls().settings_seed());
    const rows = () => read("SELECT * FROM zosd_l3_conf WHERE set_name = 'fleet2' ORDER BY param_name");
    const logs = () => read("SELECT * FROM zosd_l3_conf_log WHERE set_name = 'fleet2' ORDER BY changed_at, change_id");
    const update = (sql) => exec([sql]);
    const changed = (from, to) => (text) => {
      expect(text).to.include(from);
      return text.replace(from, to);
    };
    async function mutant(name, edit) {
      const out = join(dir, name);
      mkdirSync(out, {recursive: true});
      const {Transpiler, core} = modulesOf(process.cwd());
      const reg = new core.Registry();
      const real = "zcl_l3_fleet2_conf";
      const source = edit(readFileSync(`src/l2demo/${real}.clas.abap`, "utf8").replaceAll(real, name)
        .replace("    DATA lv_stamp TYPE timestampl.\n", "")
        .replace(/    TRY\.\n        ls_log-change_id = cl_system_uuid=>create_uuid_c32_static\( \)\.\n      CATCH cx_uuid_error\.\n        GET TIME STAMP FIELD lv_stamp\.\n        ls_log-change_id = lv_stamp\.\n    ENDTRY\./,
          "    ls_log-change_id = is_new-param_name."));
      reg.addFile(new core.MemoryFile(`${name}.clas.abap`, source));
      reg.addFile(new core.MemoryFile(`${name}.clas.xml`, readFileSync(`src/l2demo/${real}.clas.xml`, "utf8")
        .replaceAll(real.toUpperCase(), name.toUpperCase())));
      for (const dep of ["src/dsl/zosd_l3_conf.tabl.xml", "src/dsl/zosd_l3_conf_log.tabl.xml", "src/dsl/zosd_l3_run_conf.tabl.xml",
        ".local/lars/open-abap-core/src/ddic/ttyp/string_table.ttyp.xml",
        ".local/lars/open-abap-core/src/ddic/dtel/mandt.dtel.xml",
        ]) {
        try { reg.addDependency(new core.MemoryFile(basename(dep), readFileSync(dep, "utf8"))); } catch { /* optional local dependency */ }
      }
      const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
      const output = await new Transpiler({...config.options, unknownTypes: "runtimeError", ignoreSourceMap: true, skip: []}).run(reg);
      const own = new Set(output.objects.map((o) => o.filename));
      const outputDir = pathToFileURL(join(process.cwd(), "output") + sep).href;
      for (const o of output.objects.filter((x) => x.object.type === "CLAS")) {
        writeFileSync(join(out, o.filename), o.chunk.getCode().replace(/import\("\.\/([^"]+)"\)/g,
          (m, file) => own.has(file) ? m : `import("${outputDir}${file}")`));
      }
      await import(pathToFileURL(join(out, `${name}.clas.mjs`)).href);
      return abap.Classes[name.toUpperCase()];
    }
    async function withMutant(name, edit, work) {
      const altered = await mutant(name, edit);
      const real = conf();
      abap.Classes.ZCL_L3_FLEET2_CONF = altered;
      try { return await work(); } finally { abap.Classes.ZCL_L3_FLEET2_CONF = real; }
    }

    before(async () => {
      await import("./start.mjs");
      dir = mkdtempSync(join(tmpdir(), "dsl-l3-settings-db-"));
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
      const inserts = Object.entries(FLEET).flatMap(([table, data]) => data.map((row) =>
        `INSERT INTO ${table} (mandt, ${COLUMNS[table].join(", ")}) VALUES ('123', ${row.map((v) => `'${v}'`).join(", ")})`));
      await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), ...inserts]);
    });
    beforeEach(async () => { await exec(TABLES.map((t) => `DELETE FROM ${t}`)); });
    after(async () => {
      if (client) await exec([...Object.keys(FLEET).map((t) => `DELETE FROM ${t}`), ...TABLES.map((t) => `DELETE FROM ${t}`)]).catch(() => {});
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

    it("seeds all defaults and logs each seed", async () => {
      await seed();
      const model = compileSet(SET);
      expect(rows().map((r) => [trim(r.param_name), trim(r.param_val), trim(r.origin), trim(r.dsl_value)]))
        .to.deep.equal(model.settings.entries.map((e) => [e.name, e.default, "DSL", e.default]).sort((a, b) => a[0].localeCompare(b[0])));
      expect(logs()).to.have.length(model.settings.entries.length);
    });

    it("tunes max_alerts for the next run, snapshots it, and explain shows actor and default", async () => {
      const first = await run();
      expect(await set("fuses.max_alerts", "1", "production tune")).to.equal(true);
      const second = await run();
      expect(second.rules.some((r) => r.status === "FUSED")).to.equal(true);
      const snapshot = read("SELECT * FROM zosd_l3_run_conf WHERE run_id = ? ORDER BY param_name", second.run);
      expect(snapshot).to.have.length(10);
      expect(snapshot.find((r) => trim(r.param_name) === "fuses.max_alerts")).to.include({param_val: "1", origin: "USER", dsl_value: "500"});
      expect(read("SELECT param_val FROM zosd_l3_run_conf WHERE run_id = ? AND param_name = 'fuses.max_alerts'", first.run)[0].param_val).to.equal("500");
      const alert = read("SELECT * FROM zosd_l3_alert WHERE run_id = ? ORDER BY rule_name, pile_no, alert_seq LIMIT 1", second.run)[0];
      expect(alert).to.exist;
      const key = `fleet2/${trim(alert.rule_name)}/${trim(alert.model_hash)}/${DATE}/${alert.pile_no}/${alert.alert_seq}`;
      const explained = await explainAlert(key, {sets: [SET], db: dbPath});
      expect(explained.text).to.include("settings effective for this run:");
      expect(explained.text).to.match(/fuses\.max_alerts = 1 \(USER, DSL 500; .* at /);
    });

    it("invalid stored value falls back with a warning and audit row", async () => {
      await seed();
      await update("UPDATE zosd_l3_conf SET param_val = 'nonsense', origin = 'USER' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'");
      const result = await run();
      expect(result.warnings.join(" ")).to.include("fuses.max_alerts invalid; DSL default used");
      expect(result.rules.some((r) => r.status === "FUSED")).to.equal(false);
      expect(read("SELECT param_val FROM zosd_l3_run_conf WHERE run_id = ? AND param_name = 'fuses.max_alerts'", result.run)[0].param_val).to.equal("500");
      expect(logs().some((r) => trim(r.note_text) === "invalid; DSL default used")).to.equal(true);
    });

    it("new DSL default updates DSL rows, leaves USER values and their actor, then reset restores DSL", async () => {
      await seed();
      expect(await set("fuses.max_alerts", "3", "operator edit")).to.equal(true);
      const changed = rows().find((r) => trim(r.param_name) === "fuses.max_alerts");
      await update("UPDATE zosd_l3_conf SET dsl_value = '499', param_val = '499' WHERE set_name = 'fleet2' AND param_name = 'retry.max'");
      await update("UPDATE zosd_l3_conf SET dsl_value = '499' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'");
      await seed();
      const dsl = rows().find((r) => trim(r.param_name) === "retry.max");
      const user = rows().find((r) => trim(r.param_name) === "fuses.max_alerts");
      expect([trim(dsl.param_val), trim(dsl.dsl_value), trim(dsl.origin)]).to.deep.equal(["2", "2", "DSL"]);
      expect([trim(user.param_val), trim(user.dsl_value), trim(user.origin), trim(user.changed_by)])
        .to.deep.equal(["3", "500", "USER", trim(changed.changed_by)]);
      expect(await reset("fuses.max_alerts")).to.equal(true);
      expect([trim(rows().find((r) => trim(r.param_name) === "fuses.max_alerts").param_val),
        trim(rows().find((r) => trim(r.param_name) === "fuses.max_alerts").origin)]).to.deep.equal(["500", "DSL"]);
      expect(logs().filter((r) => trim(r.param_name) === "fuses.max_alerts").map((r) => trim(r.note_text)))
        .to.include.members(["operator edit", "DSL default changed", "reset to DSL default"]);
      expect(logs().filter((r) => trim(r.param_name) === "fuses.max_alerts")).to.have.length(4);
      expect(logs().filter((r) => trim(r.param_name) === "retry.max")).to.have.length(2);
      expect(logs()).to.have.length(14);
    });

    it("refuses an unknown value and a value beyond its bounds without a change", async () => {
      await seed();
      const before = logs().length;
      expect(await set("fuses.max_alerts", "100001")).to.equal(false);
      expect(await set("unknown", "1")).to.equal(false);
      expect(rows().find((r) => trim(r.param_name) === "fuses.max_alerts").param_val).to.equal("500");
      expect(logs()).to.have.length(before);
    });

    it("reads settings once: a mid-run edit affects only the next run", async () => {
      await seed();
      const helper = conf();
      const source = abap.Classes.ZCL_L2_SHIP_BUSY;
      const original = source.keys;
      let reads = 0, changed = false;
      const originalLoad = helper.load;
      helper.load = async function (...args) { reads++; return originalLoad.apply(this, args); };
      source.keys = async function (...args) {
        if (!changed) { changed = true; await client.execute("UPDATE zosd_l3_conf SET param_val = '1', origin = 'USER' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'"); }
        return original.apply(this, args);
      };
      let first;
      try { first = await run(); } finally { helper.load = originalLoad; source.keys = original; }
      expect(changed).to.equal(true);
      expect(reads).to.equal(1);
      expect(first.rules.some((r) => r.status === "FUSED")).to.equal(false);
      const second = await run();
      expect(second.rules.some((r) => r.status === "FUSED")).to.equal(true);
    });

    const vals = (raw) => Object.fromEntries(Object.entries(raw.get()).map(([k, v]) => [k, v.get()]));
    const scope = (run, from) => dialogStep(async () => {
      const state = await conf().load({iv_write: new abap.types.Character(1).set("")});
      if (from) for (const [k, v] of Object.entries(from)) state.get().vals.get()[k].set(v);
      return conf().scope({iv_run: str(run), is_vals: state.get().vals});
    }).then(vals);

    it("load( iv_write = abap_false ) reads the defaults and writes nothing", async () => {
      const state = await dialogStep(() => conf().load({iv_write: new abap.types.Character(1).set("")}));
      expect(vals(state.get().vals)).to.include({fuses_max_alerts: 500, piles_checks_size: 2, retry_max: 2});
      expect(rows()).to.have.length(0);
      expect(logs()).to.have.length(0);
    });

    it("scope( ): the run's own fuse and pile size from its snapshot, the pass's retry and stale; no snapshot: the compiled defaults", async () => {
      const first = await run();
      expect(await set("fuses.max_alerts", "1")).to.equal(true);
      expect(await set("piles.checks.size", "1")).to.equal(true);
      expect(await set("retry.max", "5")).to.equal(true);
      // the live table says 1, 1 and 5; the run's snapshot says 500 and 2
      const live = vals((await dialogStep(() => conf().load({}))).get().vals);
      expect(live).to.include({fuses_max_alerts: 1, piles_checks_size: 1, retry_max: 5});
      expect(await scope(first.run)).to.include({fuses_max_alerts: 500, piles_checks_size: 2, retry_max: 5});
      // a run without a snapshot (planned by hand, or before 5b): the compiled defaults, never the table's
      expect(await scope("NO-SUCH-RUN")).to.include({fuses_max_alerts: 500, piles_checks_size: 2, retry_max: 5});
      // a snapshot value that is not valid falls back too, never to zero
      await update(`UPDATE zosd_l3_run_conf SET param_val = '0' WHERE run_id = '${first.run}' AND param_name = 'fuses.max_alerts'`);
      expect(await scope(first.run)).to.include({fuses_max_alerts: 500});
    });

    it("sane( ): a value that did not arrive in a job's selection (zero) is the compiled default, never a zero", async () => {
      const raw = await dialogStep(async () => {
        const state = await conf().load({iv_write: new abap.types.Character(1).set("")});
        const v = state.get().vals;
        v.get().fuses_max_alerts.set(0);
        v.get().piles_checks_size.set(0);
        v.get().stale.set(0);
        v.get().retry_max.set(0);
        v.get().retry_backoff.set(7);
        return conf().sane({is_vals: v});
      });
      expect(vals(raw)).to.include({fuses_max_alerts: 500, piles_checks_size: 2, stale: 900, retry_max: 0, retry_backoff: 7});
    });

    it("an invalid stored value is logged once, not once per pass, and snapshot as FALLBACK without the operator's name", async () => {
      await seed();
      await update("UPDATE zosd_l3_conf SET param_val = 'nonsense', origin = 'USER', changed_by = 'OPERATOR' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'");
      const first = await run();
      await run();
      await seed();
      expect(logs().filter((r) => trim(r.note_text) === "invalid; DSL default used")).to.have.length(1);
      const snap = read("SELECT * FROM zosd_l3_run_conf WHERE run_id = ? AND param_name = 'fuses.max_alerts'", first.run)[0];
      expect([trim(snap.param_val), trim(snap.origin), trim(snap.changed_by)]).to.deep.equal(["500", "FALLBACK", ""]);
    });

    it("two first runs seeding at once: the second INSERT finds the row and writes no second seed entry", async () => {
      const real = client.select;
      let raced = false;
      client.select = async function (options) {
        const result = await real.call(this, options);
        if (!raced && /FROM\s+"?zosd_l3_conf"?\s/i.test(options.select)) {
          raced = true;
          // a first run beside this one seeded and committed after this SELECT
          // (MANDT as this runtime writes it: no implicit client, ANORMALIES.md)
          for (const e of compileSet(SET).settings.entries) {
            await client.execute(`INSERT INTO zosd_l3_conf (mandt, set_name, param_name, param_val, origin, dsl_value, changed_by, changed_at, note_text) VALUES ('', 'fleet2', '${e.name}', '${e.default}', 'DSL', '${e.default}', 'OTHER', 0, '')`);
          }
          return {...result, rows: []};
        }
        return result;
      };
      try { await seed(); } finally { client.select = real; }
      expect(raced).to.equal(true);
      expect(rows().map((r) => trim(r.changed_by))).to.deep.equal(Array(10).fill("OTHER"));
      expect(logs()).to.have.length(0);
    });

    it("reset_all( ) puts every setting back, and a reset of a DSL value logs nothing", async () => {
      await seed();
      expect(await set("fuses.max_alerts", "7")).to.equal(true);
      expect(await set("stale", "120")).to.equal(true);
      const before = logs().length;
      expect(trim((await dialogStep(() => cls().reset_settings())).get())).to.equal("X");
      expect(rows().filter((r) => trim(r.origin) !== "DSL" || trim(r.param_val) !== trim(r.dsl_value))).to.have.length(0);
      expect(logs()).to.have.length(before + 2);
    });

    it("a run_rule( ) after the doctor reads its run's scope again, not the doctor's live values (review round 2, P2-B)", async () => {
      // run R is planned with a fuse of 1 (its snapshot); the operator resets it to 500
      expect(await set("fuses.max_alerts", "1")).to.equal(true);
      const r = await run();
      expect(await reset("fuses.max_alerts")).to.equal(true);
      // the doctor loads the live values (500); heal( ) is not called for R, its lock is released
      await dialogStep(() => cls().doctor({}));
      // one more pile of the minimum-crew rule for R, over every ship: two alerts, past R's fuse
      await exec([`INSERT INTO zosd_l3_pile (mandt, run_id, rule_name, pile_no, set_name, stage_no, model_hash, check_date, range_low, range_high, status, job_name, job_count, alerts, started, ended, attempt, reason)
        VALUES ('', '${r.run}', 'ship-min-crew', 99, 'fleet2', 2, '', '${DATE}', 'S000', 'S999', 'PLANNED', '', '', 0, 0, 0, 1, '')`]);
      const rule = await dialogStep(() => cls().run_rule({iv_rule: str("ship-min-crew"), iv_date: date(), iv_run: str(r.run), iv_pile: new abap.types.Integer().set(99)}));
      expect(trim(rule.get().status.get()), "the pile runs with R's fuse of 1").to.equal("FUSED");
    });

    it("collect( ) does not fail a pile the doctor gave another job between its job check and its reread (review round 2, P2-A)", async () => {
      const r = await dialogStep(() => cls().run({iv_date: date(), iv_mode: new abap.types.Character(1).set("S")}));
      const id = "RUNA0000000000000000000000000001";
      r.get().run_id.set(id);
      r.get().mode.set("P");
      await exec([
        `INSERT INTO zosd_l3_stage (mandt, run_id, stage_no, set_name, check_date, stage_name, status, opened, ended) VALUES ('', '${id}', 1, 'fleet2', '${DATE}', 'candidates', 'OPEN', 20000101000000, 0)`,
        `INSERT INTO zosd_l3_stage (mandt, run_id, stage_no, set_name, check_date, stage_name, status, opened, ended) VALUES ('', '${id}', 2, 'fleet2', '${DATE}', 'checks', 'WAITING', 0, 0)`,
        `INSERT INTO zosd_l3_pile (mandt, run_id, rule_name, pile_no, set_name, stage_no, model_hash, check_date, range_low, range_high, status, job_name, job_count, alerts, started, ended, attempt, reason)
          VALUES ('', '${id}', 'ship-busy', 1, 'fleet2', 1, '', '${DATE}', 'S000', 'S999', 'RUNNING', 'L3_FLEET2_101_0001', '00000001', 0, 0, 0, 1, '')`]);
      const real = abap.FunctionModules.SHOW_JOBSTATE;
      let calls = 0;
      // the seam: job 00000001 is found finished, and before collect( ) rereads the
      // row the doctor has resubmitted the pile as job 00000002, attempt 2
      abap.FunctionModules.SHOW_JOBSTATE = async (args) => {
        calls++;
        if (String(args.exporting.jobcount.get()).trim() === "00000001") {
          await client.execute(`UPDATE zosd_l3_pile SET status = 'PLANNED', job_count = '00000002', attempt = 2, reason = 'RETRY' WHERE run_id = '${id}'`);
          args.importing.finished.set("X");
        } else {
          args.importing.running.set("X");
        }
      };
      let result;
      try { result = await dialogStep(() => cls().collect({is_result: r})); } finally { abap.FunctionModules.SHOW_JOBSTATE = real; }
      expect(calls).to.equal(1);
      const pile = read("SELECT status, job_count, attempt FROM zosd_l3_pile WHERE run_id = ?", id)[0];
      expect([trim(pile.status), trim(pile.job_count), Number(pile.attempt)], "the replacement job's pile stands").to.deep.equal(["PLANNED", "00000002", 2]);
      expect(trim(result.get().status.get())).to.equal("RUNNING");
    });

    it("mutant: seeding over a USER row loses the tuned value", async () => {
      await seed();
      expect(await set("fuses.max_alerts", "1")).to.equal(true);
      await withMutant("zcl_l3_fleet2_mseed", changed("IF ls_row-origin = 'DSL'.", "IF abap_true = abap_true."), async () => {
        await update("UPDATE zosd_l3_conf SET dsl_value = '499' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'");
        await seed();
      });
      expect(trim(rows().find((r) => trim(r.param_name) === "fuses.max_alerts").param_val), "USER value should survive a DSL change").to.equal("500");
    });

    it("mutant: an invalid value is used instead of the compiled default", async () => {
      await seed();
      await update("UPDATE zosd_l3_conf SET param_val = '100001', origin = 'USER' WHERE set_name = 'fleet2' AND param_name = 'fuses.max_alerts'");
      const value = await withMutant("zcl_l3_fleet2_minvalid", changed("lv_effective = ls_spec-dsl_value.", "lv_effective = ls_row-param_val."),
        () => dialogStep(() => conf().load({})).then((x) => x.get().vals.get().fuses_max_alerts.get()));
      expect(value, "invalid value should have fallen back to 500").to.equal(100001);
    });

    it("mutant: set_setting skips the bounds", async () => {
      await seed();
      const accepted = await withMutant("zcl_l3_fleet2_mbounds",
        changed("IF authorised( ) = abap_false OR valid( iv_param = iv_param iv_value = iv_value ) = abap_false.",
          "IF authorised( ) = abap_false."), () => set("fuses.max_alerts", "100001"));
      expect(accepted, "out-of-bounds edit should have been refused").to.equal(true);
    });

    it("mutant: a new DSL default fails to update a DSL row", async () => {
      await seed();
      await update("UPDATE zosd_l3_conf SET dsl_value = '3', param_val = '3' WHERE set_name = 'fleet2' AND param_name = 'retry.max'");
      await withMutant("zcl_l3_fleet2_mdefault",
        changed("ELSEIF ls_row-dsl_value <> ls_spec-dsl_value.", "ELSEIF abap_false = abap_true."), () => seed());
      expect(trim(rows().find((r) => trim(r.param_name) === "retry.max").param_val), "DSL row should have moved to 2").to.equal("3");
    });

    it("mutant: a run without a snapshot loses its effective settings trace", async () => {
      await withMutant("zcl_l3_fleet2_msnapshot",
        changed("INSERT zosd_l3_run_conf FROM ls_run.", "CONTINUE."), async () => {
          const result = await run();
          expect(read("SELECT * FROM zosd_l3_run_conf WHERE run_id = ?", result.run), "snapshot is missing").to.have.length(0);
        });
    });
  });
});
