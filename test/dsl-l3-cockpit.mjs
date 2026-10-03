import {expect} from "chai";
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import vm from "node:vm";
import {DatabaseSync} from "node:sqlite";
import {compileSet, checkSet, SetError} from "../tools/dsl-l3.mjs";
import {compile, writeCompiled} from "../tools/stg-compile.mjs";
import {buildApp} from "../tools/osd-bsp-app.mjs";
import {admit, loadManifest, unitFor} from "../tools/osd-deploy-manifest.mjs";
import {compileCockpit} from "../tools/dsl-l3-cockpit.mjs";
import {cockpitActions, cockpitService} from "../tools/dsl-l3-cockpit-service.mjs";
import {loadCockpitMutant} from "./helpers/dsl-cockpit-mutant.mjs";
const SET = "src/l2demo/fleet2.l3.yaml", SERVICE = "ZL3C_FLEET2_SRV";
const BASE = `http://localhost:${process.env.STG_PORT ?? 3030}/sap/opu/odata/sap/${SERVICE}`;
const trim = (v) => typeof v === "string" ? v.trim() : v;
function series(source = readFileSync("recipes/l3-cockpit/Series.js", "utf8")) {
  const context = {module: {exports: {}}, Date, Set}; vm.runInNewContext(source, context); return context.module.exports;
}
describe("DSL L3 run cockpit", function () {
  this.timeout(900000);
  it("regenerates byte for byte, including the unopted set", async () => {
    expect(await checkSet(SET, "src/l2demo")).deep.equal([]);
    expect(await checkSet("src/l2demo/fleet.l3.yaml", "src/l2demo")).deep.equal([]);
  });
  it("refuses long BSP names, unknown keys and missing stages at the cockpit line", () => {
    const dir = mkdtempSync(join(tmpdir(), "cockpit-compile-"));
    const text = readFileSync(SET, "utf8").replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, r) => `rule: ${join(process.cwd(), "src/l2demo", r)}`);
    try {
      for (const [source, pattern] of [[text.replace("app: zosd_fleet2", "app: z1234567890123456"), /at most 15/], [text.replace("title: Fleet run cockpit", "typo: Fleet run cockpit"), /unknown cockpit key/],
        [readFileSync("src/l2demo/fleet.l3.yaml", "utf8").replace(/rule: ([a-z_]+\.l2\.yaml)/g, (_, r) => `rule: ${join(process.cwd(), "src/l2demo", r)}`) + "\ncockpit: {app: ztest, service: ZTEST, title: Test}\n", /requires stages/]]) {
        const file = join(dir, "set.l3.yaml"); writeFileSync(file, source);
        expect(() => compileSet(file)).throw(SetError).and.match(pattern).and.match(/:\d+:/);
      }
    } finally {rmSync(dir, {recursive: true, force: true});}
  });
  it("the service compiler owns the base classes, annotations, read-only flags and all functions", () => {
    const compiled = compile(readFileSync("src/l2demo/zl3c_fleet2.stg.yaml", "utf8"));
    expect(compiled.model.functions).length(12);
    expect(compiled.model.entities.every((e) => !e.creatable && !e.updatable && !e.deletable)).equal(true);
    expect(compiled.classes["zcl_zl3c_fleet2_mpc_ann.clas.abap"]).include("to_Pile/@com.sap.vocabularies.UI.v1.LineItem");
    const lines = readFileSync("src/l2demo/zcl_zl3c_fleet2_dpc_ext.clas.abap", "utf8").trimEnd().split("\n");
    const trace = JSON.parse(readFileSync("src/l2demo/zcl_zl3c_fleet2_dpc_ext.clas.abap.trace.json", "utf8"));
    expect(trace.lines).length(lines.length);
    const at = compileSet(SET).cockpit.set_line;
    expect(trace.lines.every((t) => t.set_line === at)).equal(true);
  });
  it("handles long set names and exposes the optional simulation runner seam", () => {
    const m = compileSet(SET);
    const c = compileCockpit({cockpit: {app: "ztest", service: "ZTEST_SRV", title: "Test"}}, {...m, set: "abcdefghijklmnop"}, {line: () => 1, fail: (_, message) => {throw new Error(message);}});
    expect(`ZCL_${c.project}_MPC_EXT`.length).at.most(30);
    const start = cockpitActions({...m, simulate: {}}).find((a) => a.name === "StartRun");
    expect(start.params.Work).equal("String(4)");
    expect(start.call).include("iv_bind = lv_work").and.include("work={ lv_work }");
    // 5d's public DDIC contract adds RUN_BIND to the stage, not a table.
    const bound = cockpitService(m, {tableSource: (table) => {
      const xml = readFileSync(`src/dsl/${table}.tabl.xml`, "utf8");
      return table === "zosd_l3_stage" ? xml.replace("</DD03P_TABLE>", "<DD03P><FIELDNAME>RUN_BIND</FIELDNAME><DATATYPE>CHAR</DATATYPE><LENG>000255</LENG></DD03P></DD03P_TABLE>") : xml;
    }});
    expect(bound.doc.entities.Stage.properties.RunBind.type).equal("String(255)");
    expect(bound.doc.entities.Stage.keys).deep.equal(["RunId", "StageNo"]);
    expect(bound.doc.annotations.Stage.lineItem.some((c) => c.value === "RunBind")).equal(true);
  });
  it("packages the generated service, BSP and ICF node under deploy unit l3demo", () => {
    const out = mkdtempSync(join(tmpdir(), "cockpit-deploy-"));
    try {
      writeCompiled(compile(readFileSync("src/l2demo/zl3c_fleet2.stg.yaml", "utf8")), out);
      writeFileSync(join(out, "zcl_zl3c_fleet2_dpc_ext.clas.abap"), readFileSync("src/l2demo/zcl_zl3c_fleet2_dpc_ext.clas.abap"));
      buildApp({from: "src/l2demo/cockpit/zosd_fleet2", app: "ZOSD_FLEET2", out, service: SERVICE,
        only: ["index.html", "Component.js", "manifest.json", "Cockpit.controller.js", "Cockpit.fragment.xml", "List.controller.js", "Series.js", "i18n/i18n.properties"]});
      const files = readdirSync(out), unit = unitFor(loadManifest(), out, "l3demo");
      expect(files.some((f) => f.endsWith(".sicf.xml"))).equal(true);
      expect(files).include("zosd_fleet2.wapa.xml").and.include("zl3c_fleet2.iwpr.xml");
      expect(admit({files, read: (f) => readFileSync(join(out, f), "utf8"), unit})).deep.equal([]);
    } finally {rmSync(out, {recursive: true, force: true});}
  });
  it("plots piles, stage planning and event capacities at their actual timestamps", () => {
    const rows = [{StageNo: 1, Status: "DONE", Ended: "20261001000002"}, {StageNo: 1, Status: "HELD", Ended: "20261001000003"}, {StageNo: 2, Status: "DONE", Ended: "20261001000005"}];
    const stages = [{StageNo: 1, Opened: "20261001000001"}, {StageNo: 2, Opened: "20261001000004"}];
    const events = [{Seq: 1, Acted: "20261001000002", Reserved: 2, Glass: 10}, {Seq: 2, Acted: "20261001000005", Reserved: 3, Glass: 20}];
    const api = series(), s = api.compute(rows, events, stages, {WarnAt: 7000, NarrowAt: 8000}, Date.UTC(2026, 9, 1, 0, 0, 6));
    expect(api.time(new Date(s.start))).equal(s.start);
    expect(s.plan.map((p) => [p.planned, p.done])).deep.equal([[2, 0], [2, 1], [2, 1], [3, 1], [3, 2], [3, 2]]);
    expect(s.capacity.map((p) => [p.reserved, p.glass, p.warn, p.narrow])).deep.equal([[2, 10, 7, 8], [3, 20, 14, 16], [3, 20, 14, 16]]);
    const currentOnly = api.compute(rows, [], stages, {Reserved: 4, Glass: 20, WarnAt: 7000, NarrowAt: 8000}, s.end);
    expect(currentOnly.capacity.map((p) => [p.at, p.reserved])).deep.equal([[s.end, 4]]);
    const mutant = series(readFileSync("recipes/l3-cockpit/Series.js", "utf8").replace('}).length};', '}).length + 1};'));
    expect(() => expect(mutant.compute(rows, events, stages, {}, s.end).plan.at(-1).done).equal(2)).throw();
    const chart = api.svg(s, s.plan, ["planned", "done"], ["Plan", "Done"]);
    expect(chart).include("viewBox").and.include("00:00:01").and.include("00:00:06");
    // One second out of five spans 130 pixels, and one of three piles
    // spans one third of the 175-pixel vertical plot, rather than equal
    // spacing for events of unequal duration.
    expect(chart).match(/H185V131\.666/).and.match(/H575V73\.333/);
    const historical = api.compute(rows, events, stages.map((s) => ({...s, Status: "DONE", Ended: "20261001000005"})), {}, Date.UTC(2026, 9, 2));
    expect(historical.end).equal(Date.UTC(2026, 9, 1, 0, 0, 5));
    const instant = api.compute([rows[0]], [], [{StageNo: 1, Status: "DONE", Opened: rows[0].Ended, Ended: rows[0].Ended}], null, Date.UTC(2026, 9, 2));
    expect(instant.plan.map((p) => p.done)).deep.equal([1, 1]);
    expect(instant.end - instant.start).equal(1000);
  });
  describe("Gateway, file DB, real runners and jobs", () => {
    let server, dir, dbPath, prior, context, abap, client, dialogStep, store, drainJobOutbox, workQueuedBatch, clock;
    const tables = ["alert", "pile", "run", "stage", "work", "doctor", "kill", "conf", "conf_log", "run_conf", "budget", "event", "object"].map((t) => `zosd_l3_${t}`);
    const sources = ["ship", "voy", "crew", "cargo"].map((t) => `zosd_l2_${t}`);
    const read = (sql, ...args) => {const db = new DatabaseSync(dbPath); try {return db.prepare(sql).all(...args).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trim(v)])));} finally {db.close();}};
    const exec = (sqls) => dialogStep(async () => {for (const sql of sqls) await client.execute(sql);});
    const get = async (path) => {const r = await fetch(`${BASE}/${path}`); expect(r.status, await r.clone().text()).equal(200); return (await r.json()).d;};
    const action = async (name, params = {}) => {const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "number" ? String(v) : "'" + v.replaceAll("'", "''") + "'")}`).join("&");
      const r = await fetch(`${BASE}/${name}?${query}`, {method: name === "ScheduleStatus" ? "GET" : "POST"}); expect(r.status, await r.clone().text()).equal(200); return (await r.json()).d;};
    async function drain() {for (let i = 0; i < 150; i++) {await drainJobOutbox(store); const out = await workQueuedBatch(process.cwd(), store); expect(out.kind).not.equal("failed"); if (!["completed", "step", "running"].includes(out.kind)) break;}}
    before(async () => {
      dir = mkdtempSync(join(tmpdir(), "cockpit-db-")); dbPath = join(dir, "business.sqlite");
      prior = Object.fromEntries(["STG_DB", "STG_DB_PATH", "OSD_OPERATIONS_DB"].map((k) => [k, process.env[k]]));
      const start = await import("./start.mjs");
      const existing = globalThis.abap;
      if (existing?.context) context = {databaseConnections: {...existing.context.databaseConnections}, RFCDestinations: {...existing.context.RFCDestinations}, osdGeneration: existing.context.osdGeneration};
      process.env.STG_DB = "file"; process.env.STG_DB_PATH = dbPath; process.env.OSD_OPERATIONS_DB = join(dir, "operations.sqlite");
      await (await import("../output/init.mjs")).initializeABAP(); abap = globalThis.abap; client = abap.context.databaseConnections.DEFAULT;
      ({dialogStep} = await import("../tools/osd-dialog-step.mjs"));
      const jobs = await import("../tools/osd-batch-runs.mjs"); store = new jobs.BatchRuns(process.cwd(), process.env); workQueuedBatch = jobs.workQueuedBatch;
      ({drainJobOutbox} = await import("../tools/osd-job-outbox.mjs"));
      const scheduler = await import("../tools/osd-job-scheduler.mjs"); clock = scheduler.installAbapClock(abap, scheduler.manualClock("2026-10-01T00:00:00Z"));
      server = start.startServer(true);
    });
    beforeEach(async () => {
      await exec([...tables, ...sources].map((t) => `DELETE FROM ${t}`));
      await exec(["INSERT INTO zosd_l2_ship (mandt, ship_id, name, status) VALUES ('123','S001','Maintenance','M'), ('123','S002','Active','A')",
        "INSERT INTO zosd_l2_voy (mandt, voyage_id, ship_id, dep_date) VALUES ('123','V00001','S001','20261005'), ('123','V00002','S002','20261005')"]);
    });
    after(async () => {await drain().catch(() => {}); await server?.close(); store?.close(); clock?.(); await client?.disconnect();
      if (context) Object.assign(abap.context, context);
      for (const [k, v] of Object.entries(prior ?? {})) {if (v === undefined) delete process.env[k]; else process.env[k] = v;}
      if (dir) rmSync(dir, {recursive: true, force: true});});
    it("entity sets enforce their fixed set filter, keys and navigation; writes are 405", async () => {
      const r = await action("StartRun", {CheckDate: "20261001", Mode: "S"}); expect(r.Answer).equal("DONE");
      await action("SetSetting", {Param: "budget.glass", Value: "20", Note: "isolation fixture"});
      await action("SetKill", {Reason: "isolation fixture"});
      // A successful synchronous run need not emit a governor event.
      await exec(["INSERT INTO zosd_l3_event (mandt,run_id,seq,set_name,kind,reason) VALUES ('','FIXTURE',1,'fleet2','WARN','isolation fixture')"]);
      for (const table of tables.filter((t) => !["zosd_l3_work", "zosd_l3_object", "zosd_l3_alert"].includes(t))) {
        await exec([`INSERT OR REPLACE INTO ${table} SELECT ${read(`PRAGMA table_info(${table})`).map((f) => f.name === "set_name" ? "'other'" : f.name === "run_id" ? "'OTHER'" : f.name === "mandt" ? "'999'" : f.name).join(",")} FROM ${table} WHERE set_name='fleet2'`]);
      }
      const model = compileSet(SET);
      const {cockpitService} = await import("../tools/dsl-l3-cockpit-service.mjs");
      for (const e of cockpitService(model).entities) {
        expect(read(`SELECT * FROM ${e.table} WHERE set_name='other'`), e.name + " other fixture").not.length(0);
        const rows = (await get(e.name + "Set")).results;
        expect(rows.every((r) => r.SetName === "fleet2"), e.name).equal(true);
        expect((await get(e.name + "Set?$filter=SetName eq 'other'")).results, e.name).length(0);
        const write = await fetch(`${BASE}/${e.name}Set`, {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"}); expect(write.status).equal(405);
      }
      expect((await get(`RunSet('${r.RunId}')/to_Pile`)).results).length(7);
      for (const method of ["MERGE", "PATCH", "DELETE"]) {
        const response = await fetch(`${BASE}/RunSet('${r.RunId}')`, {method, headers: {"Content-Type": "application/json"}, body: method === "DELETE" ? undefined : '{"Status":"DONE"}'});
        expect(response.status, method).equal(405);
      }
      expect((await fetch(`${BASE}/RunSet('OTHER')`)).status).equal(404);
    });
    it("settings change and reset through runner audit, bounds and missing notes refuse", async () => {
      expect((await action("SetSetting", {Param: "budget.glass", Value: "20", Note: "more capacity"})).Answer).equal("OK");
      expect(read("SELECT * FROM zosd_l3_conf_log WHERE note_text='more capacity'")).length(1);
      expect((await action("SetSetting", {Param: "budget.glass", Value: "0", Note: "too small"})).Answer).match(/^REFUSED: SetSetting: .*outside its range/);
      expect((await action("SetSetting", {Param: "budget.glass", Value: "30", Note: ""})).Answer).match(/^REFUSED: SetSetting: .*note is empty/);
      expect((await action("ResetSetting", {Param: "budget.glass", Note: "restore capacity"})).Answer).equal("OK");
      expect((await get("ChangeSet")).results.some((r) => r.NoteText === "restore capacity")).equal(true);
    });
    it("chaos settings through the cockpit: a profile from the manifest, and outcome shares that total over 1000 are refused in words", async () => {
      try {
        expect((await action("SetSetting", {Param: "simulate.dump", Value: "700", Note: "a rough night"})).Answer).equal("OK");
        const over = (await action("SetSetting", {Param: "simulate.hang", Value: "400", Note: "too rough"})).Answer;
        expect(over).match(/^REFUSED: SetSetting: .*simulate dump \+ hang \+ slow above 1000/);
        expect(over.length, "an ABAP literal holds 255 characters").lessThan(255);
        expect((await action("SetSetting", {Param: "simulate.hang", Value: "300", Note: "just fits"})).Answer).equal("OK");
        expect((await action("SetSetting", {Param: "simulate.profile", Value: "typhoon", Note: "no such profile"})).Answer).match(/^REFUSED: SetSetting:/);
        expect((await action("SetSetting", {Param: "simulate.profile", Value: "storm", Note: "weather"})).Answer).equal("OK");
        const stored = Object.fromEntries((await get("SettingSet")).results.map((r) => [trim(r.ParamName), trim(r.ParamVal)]));
        expect([stored["simulate.dump"], stored["simulate.hang"], stored["simulate.profile"]]).deep.equal(["700", "300", "storm"]);
      } finally {
        for (const Param of ["simulate.dump", "simulate.hang", "simulate.profile"]) expect((await action("ResetSetting", {Param, Note: "back to the manifest"})).Answer).equal("OK");
      }
    });
    it("returns the runner refusal text for an unknown work variant", async () => {
      expect((await action("StartRun", {CheckDate: "20261001", Mode: "S", Work: "bogus"})).Answer)
        .include("REFUSED:").and.include("no such variant for the port");
    });
    async function simulatedDump() {
      await action("SetSetting", {Param: "simulate.time_scale", Value: "0", Note: "instant dump fixture"});
      const uuid = abap.Classes.CL_SYSTEM_UUID, priorCrypto = uuid.CRYPTO;
      const fixed = [0, 0, 0x4000, 0x8000, 1].map((n, i) => n.toString(16).padStart([8, 4, 4, 4, 12][i], "0")).join("-");
      uuid.CRYPTO = {randomUUID: () => fixed};
      try {
        expect((await action("StartRun", {CheckDate: "20261001", Mode: "S", Work: "sim"})).Answer)
          .include("REFUSED:").and.include("SIM: the simulated work ends abnormally, as a dump does");
      } finally {uuid.CRYPTO = priorCrypto;}
    }
    it("returns a synchronous simulated dump as an answer", simulatedDump);
    it("explains how to work a submitted parallel run on a plain serving host", async () => {
      const r = await action("StartRun", {CheckDate: "20261001", Mode: "P"});
      expect(r.Answer).include("SUBMITTED").and.include("node tools/osd-batch-runs.mjs worker");
      expect((await get(`PileSet?$filter=RunId eq '${r.RunId}'`)).results.every((p) => p.Status === "PLANNED")).equal(true);
      await drain();
      expect((await get(`RunSet('${r.RunId}')/to_Stage`)).results.every((s) => s.Status === "DONE")).equal(true);
    });
    it("mutant: removing the dispatch catch makes both refusal oracles red", async () => {
      const real = abap.Classes.ZCL_ZL3C_FLEET2_DPC_EXT;
      const original = readFileSync("src/l2demo/zcl_zl3c_fleet2_dpc_ext.clas.abap", "utf8");
      const source = original.replace("    TRY.\n        CASE iv_action_name.", "        CASE iv_action_name.")
        .replace(/      CATCH cx_root INTO lx_error\.[\s\S]*?    ENDTRY\.\n/, "");
      expect(source).not.equal(original);
      const mutant = await loadCockpitMutant("zcl_cockpit_catch_mut", source.replaceAll("zcl_zl3c_fleet2_dpc_ext", "zcl_cockpit_catch_mut"), join(dir, "catch-mutant"));
      abap.Classes.ZCL_ZL3C_FLEET2_DPC_EXT = mutant;
      try {
        for (const oracle of [async () => {
          expect((await action("StartRun", {CheckDate: "20261001", Mode: "S", Work: "bogus"})).Answer).include("no such variant for the port");
        }, simulatedDump]) {
          let failed = false;
          try {await oracle();} catch {failed = true;}
          expect(failed).equal(true);
        }
      } finally {abap.Classes.ZCL_ZL3C_FLEET2_DPC_EXT = real;}
    });
    it("retains history from stage plans, orders newest first and filters the derived run state", async () => {
      await exec([
        "INSERT INTO zosd_l3_stage (mandt,run_id,stage_no,set_name,check_date,status,opened) VALUES ('','OLD',1,'fleet2','20260930','DONE',20260930000000), ('','OLD',2,'fleet2','20260930','DONE',20260930000001)",
      ]);
      const r = await action("StartRun", {CheckDate: "20261001", Mode: "S"});
      const runs = (await get("RunSet")).results;
      expect(runs.map((s) => [s.RunId, s.Status])).deep.equal([[r.RunId, "DONE"], ["OLD", "DONE"]]);
      expect((await get("RunSet('OLD')")).Status).equal("DONE");
      expect((await get("RunSet?$filter=CheckDate eq datetime'2026-09-30T00:00:00' and Status eq 'DONE'")).results.map((s) => s.RunId)).deep.equal(["OLD"]);
      expect((await get("RunSet?$filter=Status eq 'GLASS'")).results).length(0);
    });
    it("a real governed GLASS run continues through the service and finishes with a visible CONTINUE", async () => {
      await action("SetSetting", {Param: "budget.glass", Value: "1", Note: "one alert"});
      const r = await action("StartRun", {CheckDate: "20261001", Mode: "P"}); await drain();
      expect((await get(`BudgetSet('${r.RunId}')`)).State).equal("GLASS");
      expect((await action("Resume", {RunId: r.RunId})).Answer).include("GLASS");
      expect((await action("ContinueGlass", {RunId: r.RunId, NewGlass: 100, Reason: ""})).Answer).match(/^REFUSED: ContinueGlass: /);
      expect((await action("ContinueGlass", {RunId: r.RunId, NewGlass: 100, Reason: "staff available"})).Answer).equal("OK");
      await drain();
      const events = (await get(`EventSet?$filter=RunId eq '${r.RunId}'`)).results;
      expect(events.some((e) => e.Kind === "CONTINUE" && e.Reason === "staff available")).equal(true);
      const stages = (await get(`RunSet('${r.RunId}')/to_Stage`)).results;
      expect(stages.every((s) => s.Status === "DONE")).equal(true);
      const piles = (await get(`RunSet('${r.RunId}')/to_Pile`)).results;
      const budget = await get(`BudgetSet('${r.RunId}')`);
      const plot = series().compute(piles, events, stages, budget, Date.now());
      expect(plot.plan.at(-1).done).equal(piles.filter((p) => p.Status === "DONE").length);
      expect(plot.capacity.at(-1).glass).equal(+budget.Glass);
      expect(plot.capacity.at(-1).reserved).equal(+budget.Reserved);
    });
    it("a HELD pile released with a reason audits RELEASE and resumes", async () => {
      await exec(["INSERT INTO zosd_l2_ship (mandt,ship_id,name,status) VALUES ('123','S003','Also active','A')", "INSERT INTO zosd_l2_voy (mandt,voyage_id,ship_id,dep_date) VALUES ('123','V00003','S003','20261005')"]);
      await action("SetSetting", {Param: "budget.per_pile", Value: "1", Note: "small cap"});
      await action("SetSetting", {Param: "piles.checks.size", Value: "3", Note: "three keys per pile"});
      const r = await action("StartRun", {CheckDate: "20261001", Mode: "S"});
      const held = (await get(`PileSet?$filter=RunId eq '${r.RunId}' and Status eq 'HELD'`)).results;
      expect(held.length).above(0);
      const p = held[0], args = {RunId: r.RunId, RuleName: p.RuleName, PileNo: +p.PileNo, PerPile: 100};
      expect((await action("ReleasePile", {...args, Reason: ""})).Answer).match(/^REFUSED: ReleasePile: /);
      expect((await action("ReleasePile", {...args, Reason: "reviewed pile"})).Answer).equal("OK");
      expect((await get(`EventSet?$filter=RunId eq '${r.RunId}'`)).results.some((e) => e.Kind === "RELEASE" && e.Reason === "reviewed pile")).equal(true);
      await action("Resume", {RunId: r.RunId}); await drain();
    });
    it("kill, doctor and schedule actions return the runner answers and audit", async () => {
      expect((await action("SetKill", {Reason: "stop work"})).Answer).equal("OK");
      expect((await action("StartRun", {CheckDate: "20261001", Mode: "S"})).Answer).equal("KILLED");
      expect((await action("ClearKill", {Reason: "ready again"})).Answer).equal("OK");
      expect((await get("DoctorSet")).results.map((r) => r.DocAction)).include("SET-KILL").and.include("CLEAR-KILL");
      await action("Doctor");
      const scheduled = await action("Schedule"); expect(scheduled.Answer).match(/\d+/);
      await drainJobOutbox(store);
      const waiting = (await action("ScheduleStatus")).Answer;
      expect(waiting.split(" / ").every((s) => s.startsWith("SCHEDULED ")), waiting).equal(true);
      expect((await action("Unschedule")).Answer).match(/^deleted [1-9][0-9]*, refused 0$/);
      expect((await action("ScheduleStatus")).Answer).equal("UNSCHEDULED / UNSCHEDULED");
    });
    it("mutants: removed set filter, direct table action and accepted missing audited reason each turn red", async () => {
      const real = abap.Classes.ZCL_ZL3C_FLEET2_DPC_EXT, original = readFileSync("src/l2demo/zcl_zl3c_fleet2_dpc_ext.clas.abap", "utf8");
      await exec(["INSERT INTO zosd_l3_pile (mandt,run_id,rule_name,pile_no,set_name,status) VALUES ('','OTHER','x',1,'other','DONE')"]);
      const variants = [
        ["zcl_cockpit_filter_mut", original.replaceAll("lv_where = |SET_NAME = 'fleet2'|.", "lv_where = |SET_NAME <> ' '|."), async () => expect((await get("RunSet")).results.every((r) => r.SetName === "fleet2")).equal(true)],
        ["zcl_cockpit_write_mut", original.replace("lv_ok = zcl_l3_fleet2=>set_setting( iv_param = lv_param iv_value = lv_value iv_note = lv_note ).", "UPDATE zosd_l3_conf SET param_val = lv_value WHERE set_name = 'fleet2' AND param_name = lv_param.\n        lv_ok = abap_true."), async () => {await action("SetSetting", {Param: "budget.glass", Value: "20", Note: "mutant audit"}); expect(read("SELECT * FROM zosd_l3_conf_log WHERE note_text='mutant audit'")).length(1);}],
        ["zcl_cockpit_reason_mut", original.replace("iv_per_pile = lv_cap iv_reason = lv_reason", "iv_per_pile = lv_cap iv_reason = 'invented reason'"), async () => expect((await action("ReleasePile", {RunId: "HELD", RuleName: "x", PileNo: 1, PerPile: 0, Reason: ""})).Answer).match(/^REFUSED: ReleasePile: /)],
      ];
      await exec(["INSERT INTO zosd_l3_run (mandt,set_name,check_date,run_id,status,started) VALUES ('','other','20261001','OTHER','RELEASED',20261001000000)",
        "INSERT INTO zosd_l3_run (mandt,set_name,check_date,run_id,status) VALUES ('','fleet2','20261002','HELD','HELD')",
        "INSERT INTO zosd_l3_budget (mandt,run_id,set_name,state,glass) VALUES ('','HELD','fleet2','RUNNING',100)",
        "INSERT INTO zosd_l3_pile (mandt,run_id,rule_name,pile_no,set_name,status,check_date) VALUES ('','HELD','x',1,'fleet2','HELD','20261002')"]);
      for (const [name, text, oracle] of variants) {
        let failed = false;
        abap.Classes.ZCL_ZL3C_FLEET2_DPC_EXT = await loadCockpitMutant(name, text.replaceAll("zcl_zl3c_fleet2_dpc_ext", name), join(dir, name));
        try {await oracle();} catch {failed = true;} finally {abap.Classes.ZCL_ZL3C_FLEET2_DPC_EXT = real;}
        expect(failed, name).equal(true);
      }
      expect((await get("RunSet")).results.every((r) => r.SetName === "fleet2")).equal(true);
    });
  });
});
