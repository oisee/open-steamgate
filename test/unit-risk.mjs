// ABAP Unit's RISK LEVEL, checked rather than trusted: the static half
// (tools/osd-unit-risk.mjs, what a test's object reaches), the database
// hooks it runs on (tools/osd-dialog-step.mjs, B17's first consumer), and
// the runtime guard (tools/osd-unit.mjs) that fails a HARMLESS class that
// writes anyway.
import {expect} from "chai";
import {ObjectStore} from "../tools/osd-store.mjs";
import {UnitRun} from "../tools/osd-unit.mjs";
import {writeKindOf, scheduledRisk} from "../tools/osd-unit-risk.mjs";
import {hookDatabase, activeHooks, nativeWriteOf} from "../tools/osd-dialog-step.mjs";

describe("tools/osd-unit-risk: a declared RISK LEVEL against what the test reaches", function () {
  this.timeout(180000);
  const store = new ObjectStore();
  const runner = new UnitRun(store);

  it("names a write statement, a call it cannot follow, and nothing else", () => {
    expect(writeKindOf("InsertDatabase", "INSERT ztab FROM ls_row")).to.equal("INSERT");
    expect(writeKindOf("ModifyDatabase", "MODIFY ztab FROM TABLE lt")).to.equal("MODIFY");
    expect(writeKindOf("Commit", "COMMIT WORK")).to.equal("COMMIT WORK");
    expect(writeKindOf("CallFunction", "CALL FUNCTION 'Z_POST' IN UPDATE TASK EXPORTING x = y")).to.equal("CALL FUNCTION IN UPDATE TASK");
    expect(writeKindOf("CallFunction", "CALL FUNCTION lv_name EXPORTING x = y")).to.equal("a dynamic CALL FUNCTION");
    expect(writeKindOf("CallFunction", "CALL FUNCTION 'Z_READ' EXPORTING x = y")).to.equal(undefined);
    expect(writeKindOf("Call", "CALL METHOD (lv_class)=>(lv_method)")).to.equal("a dynamic method call");
    expect(writeKindOf("Call", "lo_object->(lv_method)( )")).to.equal("a dynamic method call");
    expect(writeKindOf("Call", "lo_object->read( )")).to.equal(undefined);
    expect(writeKindOf("CreateObject", "CREATE OBJECT lo TYPE (lv_class)")).to.equal("a dynamic CREATE OBJECT");
    expect(writeKindOf("CreateObject", "CREATE OBJECT lo TYPE zcl_x")).to.equal(undefined);
    // an internal table is not the database: abaplint parses those as other statements
    expect(writeKindOf("InsertInternal", "INSERT ls INTO TABLE lt")).to.equal(undefined);
  });

  it("schedules on the declaration, except that undeclared and a HARMLESS that writes are DANGEROUS", () => {
    const write = [{object: "ZCL_X", kind: "INSERT", file: "zcl_x.clas.abap", line: 3}];
    expect(scheduledRisk({riskLevel: "harmless", riskLevelDeclared: true}, [])).to.equal("harmless");
    expect(scheduledRisk({riskLevel: "harmless", riskLevelDeclared: true}, write)).to.equal("dangerous");
    expect(scheduledRisk({riskLevel: "harmless", riskLevelDeclared: false}, [])).to.equal("dangerous");
    expect(scheduledRisk({riskLevel: "critical", riskLevelDeclared: true}, [])).to.equal("critical");
  });

  it("flags this tree's SEGW tests, which declare HARMLESS and write, and guards a class that reaches no write", async () => {
    const segw = await runner.withRisk(runner.classes("CLAS", "ZCL_STG_SEGW_TEST"));
    expect(segw.writesTotal).to.be.greaterThan(0);
    // the test's own statements are named first
    expect(segw.writes[0].object).to.equal("ZCL_STG_SEGW_TEST");
    const crud = segw.classes.find((c) => c.name === "LTCL_CRUD");
    expect(crud).to.include({riskLevel: "harmless", riskLevelDeclared: true, schedule: "dangerous", guard: false});

    const tokens = await runner.withRisk(runner.classes("CLAS", "ZCL_OSD_ABAP_TOKENS"));
    expect(tokens.writesTotal, JSON.stringify(tokens.writes)).to.equal(0);
    for (const testClass of tokens.classes) {
      expect(testClass, testClass.name).to.include({schedule: testClass.riskLevelDeclared ? testClass.riskLevel : "dangerous"});
      expect(testClass.guard).to.equal(testClass.schedule === "harmless");
    }
    expect(tokens.classes.some((c) => c.guard), "at least one guarded class to run below").to.equal(true);
  });

  // the runtime half, against real runs: a guarded class that writes fails
  // with the reason, one that does not passes as before
  it("the runtime guard fails a HARMLESS class that writes, naming the table", async () => {
    const plan = runner.classes("CLAS", "ZCL_STG_SEGW_TEST");
    const guarded = {...plan, classes: plan.classes.map((c) => ({...c, guard: c.name === "LTCL_CRUD"}))};
    const result = await runner.runDetached("CLAS", "ZCL_STG_SEGW_TEST", {plan: guarded, testClass: "LTCL_CRUD"});
    const alerts = result.testClasses[0].testMethods.flatMap((m) => m.alerts).concat(result.testClasses[0].alerts);
    const guard = alerts.filter((a) => a.kind === "riskLevel");
    expect(guard.length, JSON.stringify(alerts).slice(0, 800)).to.be.greaterThan(0);
    expect(guard[0].title).to.match(/^RISK LEVEL HARMLESS but wrote to ZSTG_/);
    expect(result.ok).to.equal(false);

    // the same class unguarded passes: the failure is the guard's, not the test's
    const unguarded = await runner.runDetached("CLAS", "ZCL_STG_SEGW_TEST", {plan, testClass: "LTCL_CRUD"});
    expect(unguarded.ok, JSON.stringify(unguarded.testClasses[0].testMethods.flatMap((m) => m.alerts)).slice(0, 800)).to.equal(true);
  });

  it("a guarded class that reaches no write passes", async () => {
    const plan = await runner.withRisk(runner.classes("CLAS", "ZCL_OSD_ABAP_TOKENS"));
    const result = await runner.runDetached("CLAS", "ZCL_OSD_ABAP_TOKENS", {plan});
    expect(result.ok, JSON.stringify(result.testClasses.flatMap((c) => c.testMethods.flatMap((m) => m.alerts))).slice(0, 800)).to.equal(true);
    expect(result.counts.methods).to.be.greaterThan(0);
  });
});

describe("tools/osd-dialog-step: hooks at the database seam (B17)", function () {
  let saved;
  beforeEach(() => {
    saved = globalThis.abap;
  });
  afterEach(() => {
    globalThis.abap = saved;
  });

  it("a native statement is a write or a read", () => {
    expect(nativeWriteOf('INSERT INTO "ZSTG_DEMO" VALUES (1)')).to.deep.equal({operation: "INSERT", table: "ZSTG_DEMO"});
    expect(nativeWriteOf("delete from zosd_svc where x = 1")).to.deep.equal({operation: "DELETE", table: "ZOSD_SVC"});
    expect(nativeWriteOf("UPDATE ztab SET a = 1")).to.deep.equal({operation: "UPDATE", table: "ZTAB"});
    expect(nativeWriteOf("SELECT * FROM ztab")).to.equal(undefined);
    expect(nativeWriteOf("SAVEPOINT s1")).to.equal(undefined);
  });

  it("sees every write while a hook is active, fails it on a throw, and restores the client after", async () => {
    const calls = [];
    const client = {
      insert: async (o) => { calls.push(["insert", o.table]); return {subrc: 0, dbcnt: 1}; },
      update: async (o) => { calls.push(["update", o.table]); return {subrc: 0, dbcnt: 1}; },
      delete: async (o) => { calls.push(["delete", o.table]); return {subrc: 0, dbcnt: 1}; },
      execute: async (sql) => { calls.push(["execute", sql]); },
      select: async () => ({rows: []}),
    };
    const original = {insert: client.insert, execute: client.execute};
    globalThis.abap = {context: {databaseConnections: {DEFAULT: client}}};
    const seen = [];
    const off = hookDatabase("watch", {write: (operation, table) => seen.push(`${operation} ${table}`)});
    expect(activeHooks()).to.deep.equal(["watch"]);
    await client.insert({table: "zstg_demo"});
    await client.execute(["SELECT 1", "DELETE FROM zosd_svc"]);
    await client.select({});
    expect(seen).to.deep.equal(["INSERT ZSTG_DEMO", "DELETE ZOSD_SVC"]);
    const refuse = hookDatabase("refuse", {write: (operation, table) => { throw new Error(`no ${table}`); }});
    let error;
    try {
      await client.update({table: "ztab"});
    } catch (e) {
      error = e;
    }
    expect(String(error?.message)).to.equal("no ZTAB");
    expect(calls.map((c) => c[0]), "the refused write never reached the client").to.deep.equal(["insert", "execute"]);
    refuse();
    off();
    expect(activeHooks()).to.deep.equal([]);
    expect(client.insert, "restored").to.equal(original.insert);
    expect(client.execute).to.equal(original.execute);
  });
});
