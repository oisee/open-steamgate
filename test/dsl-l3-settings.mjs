// DSL L3 settings: application-data defaults, tuning, read-once runs and trace.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {basename, sep} from "node:path";
import {pathToFileURL} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {checkSet, compileSet, explainAlert, renderSet, SetError} from "../tools/dsl-l3.mjs";
import {modulesOf} from "../tools/osd-transpile.mjs";

const SET = "src/l2demo/fleet2.l3.yaml";
const DATE = "20261001";
const TABLES = ["zosd_l3_alert", "zosd_l3_pile", "zosd_l3_run", "zosd_l3_stage", "zosd_l3_work", "zosd_l3_doctor",
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
        ["max: 100000", "max: 2147483648", /bounds must lie within/]]) {
        const file = join(dir, "fleet2.l3.yaml");
        writeFileSync(file, text.replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, f) => `rule: ${join(process.cwd(), "src/l2demo", f)}`)
          .replace(from, to));
        expect(() => compileSet(file)).to.throw(SetError).and.to.match(message);
      }
    } finally { rmSync(dir, {recursive: true, force: true}); }
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
      expect(snapshot).to.have.length(6);
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
      expect(logs()).to.have.length(10);
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
