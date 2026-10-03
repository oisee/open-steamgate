import {expect} from "chai";
import * as core from "@abaplint/core";
import {createRequire} from "node:module";
import {UnitRun} from "../tools/osd-unit.mjs";
import {UnitRisk} from "../tools/osd-unit-risk.mjs";
import {CrossReference} from "../tools/osd-xref.mjs";
const {riskWarning} = createRequire(import.meta.url)("../editors/vscode/lib.js");
const harmless = {riskLevelDeclared: true, riskLevel: "harmless", schedule: "dangerous"};

function fixture(body = "zcl_report=>read( ).", implementations = {}) {
  const files = {
    "zcl_test.clas.abap": `CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.`,
    "zcl_test.clas.testclasses.abap": `CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS.
      PRIVATE SECTION. METHODS run FOR TESTING. ENDCLASS.
      CLASS ltcl_test IMPLEMENTATION. METHOD run. ${body} ENDMETHOD. ENDCLASS.`,
    "zcl_report.clas.abap": `CLASS zcl_report DEFINITION PUBLIC. PUBLIC SECTION.
      CLASS-METHODS read. CLASS-METHODS unused_write.
      DATA unused TYPE REF TO zif_store. ENDCLASS.
      CLASS zcl_report IMPLEMENTATION. METHOD read.
      SELECT * FROM ztab_a INTO TABLE @DATA(a).
      SELECT * FROM ztab_b INTO TABLE @DATA(b).
      SELECT * FROM ztab_c INTO TABLE @DATA(c).
      ENDMETHOD. METHOD unused_write. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
    "zif_store.intf.abap": "INTERFACE zif_store PUBLIC. METHODS read. ENDINTERFACE.",
    ...Object.fromEntries(["zcl_reader", "zcl_writer"].map((name) => [`${name}.clas.abap`,
      `CLASS ${name} DEFINITION PUBLIC. PUBLIC SECTION. INTERFACES zif_store. ENDCLASS.
       CLASS ${name} IMPLEMENTATION. METHOD zif_store~read.
       ${name === "zcl_writer" ? "COMMIT WORK." : ""} ENDMETHOD. ENDCLASS.`])),
    ...implementations,
  };
  const registry = new core.Registry();
  for (const [name, source] of Object.entries(files)) registry.addFile(new core.MemoryFile(name, source));
  registry.parse();
  const objects = [...registry.getObjects()];
  const store = {registry: () => registry, list: () => objects.map((o) => ({type: o.getType(), name: o.getName().toUpperCase()}))};
  return {store, risk: new UnitRisk(store)};
}
const warning = (result) => riskWarning(harmless, {object: {name: "ZCL_TEST"}, writesTotal: result.total, ...result});

describe("ABAP Unit executable call closure", () => {
  it("fleet fixture: reads three tables without reaching type-only writers or unused methods", async () => {
    const {risk, store} = fixture();
    const result = await risk.writesReached("ZCL_TEST");
    if (process.env.OSD_RISK_RED_PROOF) {
      console.log("fleet closure:", JSON.stringify(result));
      console.log("fleet warning:", warning(result));
      const rows = new CrossReference(store).build().tables().wbcrossgt;
      for (const [from, to] of [["ZCL_TEST", "ZCL_REPORT"], ["ZCL_REPORT", "ZIF_STORE"]]) {
        console.log("legacy edge:", JSON.stringify(rows.find((r) => r.INCLUDE === from && r.NAME === to)));
      }
      console.log("legacy interface expansion:", store.registry().getObject("CLAS", "ZCL_WRITER").getClassDefinition().interfaces.map((i) => i.name), "-> ZCL_WRITER");
    }
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
    expect(result.reached).to.equal(2);
    expect(warning(result)).to.equal(undefined);
    const rows = new CrossReference(store).build().tables().wbcrossgt;
    expect(rows.some((r) => r.INCLUDE === "ZCL_REPORT" && r.NAME === "ZIF_STORE")).to.equal(true);
  });

  it("static COMMIT path reports the test, callee and source positions", async () => {
    const result = await fixture("zcl_report=>unused_write( ).").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(warning(result)).to.contain("LTCL_TEST=>RUN (").and.contain("→ ZCL_REPORT=>UNUSED_WRITE (").and.contain("COMMIT WORK in ZCL_REPORT");
    expect(result.writes[0].path.every((p) => p.file && p.line > 0)).to.equal(true);
    expect(result.writes[0].path[1].file).to.equal("zcl_report.clas.abap");
    expect(result.writes[0].path[1].callSite.file).to.equal("zcl_test.clas.testclasses.abap");
  });

  for (const name of ["zcl_reader", "zcl_writer"]) it(`interface dispatch uses only instantiated ${name}`, async () => {
    const result = await fixture(`DATA lo TYPE REF TO zif_store. CREATE OBJECT lo TYPE ${name}. lo->read( ).`).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(name === "zcl_writer" ? 1 : 0);
    expect(result.dynamicCallsTotal).to.equal(0);
    if (name === "zcl_writer") expect(warning(result)).to.contain("ZCL_WRITER=>ZIF_STORE~READ");
  });

  it("a reachable factory contributes its returned NEW target", async () => {
    const {risk} = fixture("DATA lo TYPE REF TO zif_store. lo = zcl_factory=>make( ). lo->read( ).", {
      "zcl_factory.clas.abap": `CLASS zcl_factory DEFINITION PUBLIC. PUBLIC SECTION.
      CLASS-METHODS make RETURNING VALUE(ro) TYPE REF TO zif_store. ENDCLASS.
      CLASS zcl_factory IMPLEMENTATION. METHOD make. ro = NEW zcl_reader( ). ENDMETHOD. ENDCLASS.`,
    });
    const result = await risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  it("dynamic calls report uncertainty without expanding to unrelated writers", async () => {
    const result = await fixture("CALL METHOD (lv_class)=>(lv_method).").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.reached).to.equal(1);
    expect(warning(result)).to.contain("may reach a database write through a dynamic call in LTCL_TEST=>RUN (zcl_test.clas.testclasses.abap:");
  });

  it("unknown interface receivers use the weaker unresolved warning", async () => {
    const result = await fixture("DATA lo TYPE REF TO zif_store. lo->read( ).").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(warning(result)).to.contain("through an unresolved call");
  });

  it("a base call cannot reach an uninstantiated subclass redefinition", async () => {
    const result = await fixture("DATA lo TYPE REF TO zcl_base. CREATE OBJECT lo. lo->read( ).", {
      "zcl_base.clas.abap": "CLASS zcl_base DEFINITION PUBLIC. PUBLIC SECTION. METHODS read. ENDCLASS. CLASS zcl_base IMPLEMENTATION. METHOD read. ENDMETHOD. ENDCLASS.",
      "zcl_child.clas.abap": "CLASS zcl_child DEFINITION PUBLIC INHERITING FROM zcl_base. PUBLIC SECTION. METHODS read REDEFINITION. ENDCLASS. CLASS zcl_child IMPLEMENTATION. METHOD read. COMMIT WORK. ENDMETHOD. ENDCLASS.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  it("constructors and local helper calls execute, string contents do not", async () => {
    const result = await fixture("DATA(lo) = NEW zcl_worker( ). DATA(text) = 'zcl_writer=>read( )'.", {
      "zcl_worker.clas.abap": "CLASS zcl_worker DEFINITION PUBLIC. PUBLIC SECTION. METHODS constructor. METHODS post. ENDCLASS. CLASS zcl_worker IMPLEMENTATION. METHOD constructor. post( ). ENDMETHOD. METHOD post. COMMIT WORK. ENDMETHOD. ENDCLASS.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.writes[0].method).to.equal("ZCL_WORKER=>POST");
  });
  for (const statement of ["INSERT ztab FROM row.", "MODIFY ztab FROM row."]) it(`static ${statement.split(" ")[0]} remains a write`, async () => {
    const result = await fixture(statement).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(warning(result)).to.contain(statement.split(" ")[0]);
  });

  it("NEW followed by a method call follows that method", async () => {
    const result = await fixture("NEW zcl_worker( )->post( ).", {
      "zcl_worker.clas.abap": "CLASS zcl_worker DEFINITION PUBLIC. PUBLIC SECTION. METHODS post. ENDCLASS. CLASS zcl_worker IMPLEMENTATION. METHOD post. COMMIT WORK. ENDMETHOD. ENDCLASS.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  it("interface dispatch reaches an instantiated subclass redefinition", async () => {
    const result = await fixture("DATA lo TYPE REF TO zcl_base. CREATE OBJECT lo TYPE zcl_child. lo->read( ).", {
      "zcl_base.clas.abap": "CLASS zcl_base DEFINITION PUBLIC. PUBLIC SECTION. METHODS read. ENDCLASS. CLASS zcl_base IMPLEMENTATION. METHOD read. ENDMETHOD. ENDCLASS.",
      "zcl_child.clas.abap": "CLASS zcl_child DEFINITION PUBLIC INHERITING FROM zcl_base. PUBLIC SECTION. METHODS read REDEFINITION. ENDCLASS. CLASS zcl_child IMPLEMENTATION. METHOD read. COMMIT WORK. ENDMETHOD. ENDCLASS.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.writes[0].object).to.equal("ZCL_CHILD");
  });

  it("literal call text inside arguments never becomes a call edge", async () => {
    const result = await fixture("zcl_report=>read( text = `lo->write( )` ).").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  it("a truncated warning marks omitted hops and keeps both endpoints", () => {
    const path = Array.from({length: 12}, (_, i) => ({method: `ZCL_${i}=>RUN`, file: `zcl_${i}.clas.abap`, line: i + 1}));
    const message = warning({writes: [{object: "ZCL_11", kind: "COMMIT WORK", file: "zcl_11.clas.abap", line: 12, path}], total: 1});
    expect(message).to.contain("ZCL_0=>RUN").and.contain("…").and.contain("ZCL_10=>RUN").and.contain("COMMIT WORK in ZCL_11");
    expect(message.split(" → ").length - 1).to.be.at.most(5);
  });

  it("discovery preserves uncertainty separately and schedules it serially", async () => {
    const {store} = fixture("CALL METHOD (lv_class)=>(lv_method).");
    const plan = await new UnitRun(store).withRisk({object: {name: "ZCL_TEST"}, classes: [harmless]});
    expect(plan.writesTotal).to.equal(0);
    expect(plan.dynamicCallsTotal).to.equal(1);
    expect(plan.classes[0]).to.include({schedule: "dangerous", guard: false});
    expect(riskWarning(plan.classes[0], plan)).to.contain("through a dynamic call");
  });

  it("dynamic calls inside assignment expressions also report uncertainty", async () => {
    const result = await fixture("DATA(result) = lo->(lv_method)( ).").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(1);
  });

  it("counts distinct write statements on the same source line", async () => {
    const result = await fixture("COMMIT WORK. COMMIT WORK.").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(2);
  });

  for (const body of ["CALL FUNCTION lv_name.", "DATA lo TYPE REF TO zif_store. CREATE OBJECT lo TYPE (lv_class)."])
    it(`dynamic target is uncertain: ${body}`, async () => {
      const result = await fixture(body).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(0);
      expect(result.dynamicCallsTotal).to.equal(1);
      expect(result.reached).to.equal(1);
      expect(warning(result)).to.contain("through a dynamic call");
    });

  it("literal function calls follow the called module, not the whole group", async () => {
    const result = await fixture("CALL FUNCTION 'Z_POST'.", {
      "zfg_risk.fugr.z_post.abap": "FUNCTION z_post. COMMIT WORK. ENDFUNCTION.",
      "zfg_risk.fugr.z_unused.abap": "FUNCTION z_unused. COMMIT WORK. ENDFUNCTION.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.writes[0].method).to.equal("ZFG_RISK=>Z_POST");
    expect(result.dynamicCallsTotal).to.equal(0);
  });

});
