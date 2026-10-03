import {expect} from "chai";
import * as core from "@abaplint/core";
import {createRequire} from "node:module";
import {UnitRun} from "../tools/osd-unit.mjs";
import {UnitRisk} from "../tools/osd-unit-risk.mjs";
import {STATEMENT_KINDS, statementKindOf} from "../tools/osd-unit-risk-statements.mjs";
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
  it("classifies every kind from abaplint's statement registry explicitly", () => {
    const unclassified = core.ArtifactsABAP.getStatements().map((s) => s.constructor.name)
      .filter((kind) => !Object.hasOwn(STATEMENT_KINDS, kind));
    expect(unclassified, "audit new statement kinds; never silently default to harmless").to.deep.equal([]);
    for (const kind of ["Unknown", "MacroCall", "MacroContent", "MacroRecursion", "NativeSQL", "Comment", "Empty"])
      expect(Object.hasOwn(STATEMENT_KINDS, kind), kind).to.equal(true);
    expect(statementKindOf("FutureStatement")).to.equal("unknown");
    expect(statementKindOf("constructor")).to.equal("unknown");
  });

  it("critic r2: RAISE EXCEPTION TYPE follows the writing constructor", async () => {
    const result = await fixture("TRY. RAISE EXCEPTION TYPE zcx_write. CATCH zcx_write. ENDTRY.", {
      "zcx_write.clas.abap": `CLASS zcx_write DEFINITION PUBLIC. PUBLIC SECTION. METHODS constructor.
        ENDCLASS. CLASS zcx_write IMPLEMENTATION. METHOD constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.dynamicCallsTotal).to.equal(0);
    expect(warning(result)).to.contain("ZCX_WRITE=>CONSTRUCTOR").and.contain("COMMIT WORK");
  });

  it("critic r2: EXEC SQL INSERT is a database write", async () => {
    const result = await fixture("EXEC SQL.\nINSERT INTO ztab VALUES (1)\nENDEXEC.").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(warning(result)).to.contain("Native SQL").and.contain("zcl_test.clas.testclasses.abap:");
  });

  for (const body of [
    "RAISE RESUMABLE EXCEPTION TYPE zcx_write.",
    "RAISE SHORTDUMP TYPE zcx_write.",
    "DATA(n) = COND i( WHEN 1 = 2 THEN 1 ELSE THROW zcx_write( ) ).",
    "DATA(n) = COND i( WHEN 1 = 2 THEN 1 ELSE THROW RESUMABLE zcx_write( ) ).",
    "RAISE EXCEPTION NEW zcx_write( ).",
    "DATA(lo) = CAST zcx_write( NEW zcx_write( ) ).",
    "DATA(lo) = CONV zcx_write( NEW zcx_write( ) ).",
  ]) it(`exception/expression construction follows superclass constructors: ${body}`, async () => {
    const result = await fixture(body, {
      "zcx_base.clas.abap": `CLASS zcx_base DEFINITION PUBLIC. PUBLIC SECTION. METHODS constructor.
        CLASS-METHODS class_constructor. ENDCLASS. CLASS zcx_base IMPLEMENTATION.
        METHOD constructor. COMMIT WORK. ENDMETHOD. METHOD class_constructor. ROLLBACK WORK. ENDMETHOD. ENDCLASS.`,
      "zcx_write.clas.abap": `CLASS zcx_write DEFINITION PUBLIC INHERITING FROM zcx_base. PUBLIC SECTION.
        METHODS constructor. ENDCLASS. CLASS zcx_write IMPLEMENTATION. METHOD constructor. ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(2);
    expect(result.dynamicCallsTotal).to.equal(0);
    expect(result.writes.map((w) => w.method)).to.have.members(["ZCX_BASE=>CONSTRUCTOR", "ZCX_BASE=>CLASS_CONSTRUCTOR"]);
  });

  it("casting an existing reference and raising it do not construct another object", async () => {
    const result = await fixture("DATA lo TYPE REF TO zcx_write. DATA(cast) = CAST zcx_write( lo ). RAISE EXCEPTION cast.", {
      "zcx_write.clas.abap": `CLASS zcx_write DEFINITION PUBLIC. PUBLIC SECTION. METHODS constructor.
        ENDCLASS. CLASS zcx_write IMPLEMENTATION. METHOD constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  for (const body of ["RAISE EXCEPTION TYPE zcx_missing.", "DATA(n) = COND i( WHEN 1 = 2 THEN 1 ELSE THROW zcx_missing( ) )."])
    it(`unavailable exception constructors remain uncertain: ${body}`, async () => {
      const result = await fixture(body).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(0);
      expect(result.dynamicCallsTotal).to.equal(1);
      expect(warning(result)).to.contain("may reach a database write");
    });

  for (const [body, kind] of [
    ["future execution.", "Unknown"], ["CALL 'example'.", "CallKernel"],
    ["PERFORM post.", "Perform"], ["RAISE EVENT done.", "RaiseEvent"],
  ]) it(`unknown ${kind} gives a weaker warning naming the kind and source`, async () => {
    const result = await fixture(body).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCalls[0].kind).to.equal(`an unknown ${kind} statement`);
    expect(warning(result)).to.contain(`through an unknown ${kind} statement in LTCL_TEST=>RUN (zcl_test.clas.testclasses.abap:`);
  });

  it("a future parser kind also produces a weaker warning without an audit entry", async () => {
    const {risk, store} = fixture("future execution.");
    for (const file of store.registry().getObject("CLAS", "ZCL_TEST").getABAPFiles())
      for (const statement of file.getStatements()) if (statement.get().constructor.name === "Unknown")
        statement.get = () => new (class FutureExecution {})();
    const result = await risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(warning(result)).to.contain("an unknown FutureExecution statement");
  });

  for (const [body, operation] of [
    ["UPDATE ztab SET field = 1.", "UPDATE"], ["DELETE FROM ztab.", "DELETE"],
    ["ROLLBACK WORK.", "ROLLBACK WORK"], ["SET UPDATE TASK LOCAL.", "SET UPDATE TASK LOCAL"],
    ["CALL TRANSACTION 'Z_TEST'.", "CALL TRANSACTION"], ["SUBMIT zreport AND RETURN.", "SUBMIT"],
    ["EXPORT item = item TO DATABASE ztab(ab) ID 'key'.", "EXPORT TO DATABASE"],
    ["INSERT REPORT 'Z_TEST' FROM lines.", "INSERT REPORT"], ["DELETE REPORT 'Z_TEST'.", "DELETE REPORT"],
    ["CALL DATABASE PROCEDURE (name) EXPORTING x = y.", "CALL DATABASE PROCEDURE"],
  ]) it(`nonlocal/database write remains visible: ${operation}`, async () => {
    const result = await fixture(body).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(warning(result)).to.contain(operation);
  });

  it("EXPORT to memory and pure/read/control statements keep the fleet fixture quiet", async () => {
    const result = await fixture(`DATA n TYPE i. n = 1. ADD 1 TO n. IF n > 0.
      EXPORT n = n TO MEMORY ID 'key'. IMPORT n = n FROM MEMORY ID 'key'.
      zcl_report=>read( ). ENDIF.`).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
    expect(warning(result)).to.equal(undefined);
  });

  it("database/dynamic keywords in literal arguments do not change the statement verdict", async () => {
    const result = await fixture(`EXPORT text = 'TO DATABASE' TO MEMORY ID 'key'.
      CALL FUNCTION 'Z_READ' EXPORTING text = 'IN UPDATE TASK'.
      DATA lo TYPE REF TO zcl_worker. CREATE OBJECT lo EXPORTING text = 'TYPE (lv_class)'.`, {
      "zfg_risk.fugr.z_read.abap": "FUNCTION z_read. ENDFUNCTION.",
      "zcl_worker.clas.abap": `CLASS zcl_worker DEFINITION PUBLIC. PUBLIC SECTION.
        METHODS constructor IMPORTING text TYPE string. ENDCLASS.
        CLASS zcl_worker IMPLEMENTATION. METHOD constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.dynamicCallsTotal).to.equal(0);
    expect(result.writes[0].method).to.equal("ZCL_WORKER=>CONSTRUCTOR");
  });

  for (const body of ["cl_sql_statement=>execute_update( ).", "DATA lo TYPE REF TO cl_sql_statement. lo->execute_update( )."])
    it(`ADBC is a database escape even when the library body is unavailable: ${body}`, async () => {
      const result = await fixture(body).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(1);
      expect(warning(result)).to.contain("ADBC call");
    });

  it("inherited ADBC calls remain database escapes without the parent library body", async () => {
    const result = await fixture("DATA lo TYPE REF TO zcl_statement. lo->execute_update( ).", {
      "zcl_statement.clas.abap": `CLASS zcl_statement DEFINITION PUBLIC INHERITING FROM cl_sql_statement.
        ENDCLASS. CLASS zcl_statement IMPLEMENTATION. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(warning(result)).to.contain("ADBC call");
  });

  it("AMDP calls count one database escape rather than opaque body chunks", async () => {
    const result = await fixture("zcl_amdp=>post( ).", {
      "zcl_amdp.clas.abap": `CLASS zcl_amdp DEFINITION PUBLIC. PUBLIC SECTION. CLASS-METHODS post.
        ENDCLASS. CLASS zcl_amdp IMPLEMENTATION.
        METHOD post BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
        INSERT INTO ztab VALUES (1);
        UPDATE ztab SET field = 2;
        ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.dynamicCallsTotal).to.equal(0);
    expect(warning(result)).to.contain("AMDP call in ZCL_AMDP");
  });

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

  for (const body of ["DATA(n) = zcl_cache=>count.", "zcl_cache=>count = 1.", "DATA(n) = zcl_cache=>const."])
    it(`static component initialization: ${body}`, async () => {
      const result = await fixture(body, {
        "zcl_cache.clas.abap": `CLASS zcl_cache DEFINITION PUBLIC. PUBLIC SECTION.
          CLASS-DATA count TYPE i. CONSTANTS const TYPE i VALUE 1. CLASS-METHODS class_constructor.
          ENDCLASS. CLASS zcl_cache IMPLEMENTATION. METHOD class_constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
      }).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(1);
      expect(warning(result)).to.contain("ZCL_CACHE=>CLASS_CONSTRUCTOR");
    });

  for (const body of ["DATA(lo) = NEW zcl_child( ).", "DATA(n) = zcl_child=>count."])
    it(`superclass initialization chain: ${body}`, async () => {
      const result = await fixture(body, {
        "zcl_grandparent.clas.abap": `CLASS zcl_grandparent DEFINITION PUBLIC. PUBLIC SECTION.
          CLASS-METHODS class_constructor. ENDCLASS. CLASS zcl_grandparent IMPLEMENTATION.
          METHOD class_constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
        "zcl_base.clas.abap": `CLASS zcl_base DEFINITION PUBLIC INHERITING FROM zcl_grandparent. PUBLIC SECTION.
          CLASS-DATA count TYPE i. CLASS-METHODS class_constructor. METHODS constructor.
          ENDCLASS. CLASS zcl_base IMPLEMENTATION.
          METHOD class_constructor. ENDMETHOD. METHOD constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
        "zcl_child.clas.abap": `CLASS zcl_child DEFINITION PUBLIC INHERITING FROM zcl_base. PUBLIC SECTION.
          CLASS-METHODS class_constructor. METHODS constructor.
          ENDCLASS. CLASS zcl_child IMPLEMENTATION.
          METHOD class_constructor. ENDMETHOD. METHOD constructor. super->constructor( ). ENDMETHOD. ENDCLASS.`,
      }).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(body.includes("NEW") ? 2 : 1);
      expect(result.writes.some((w) => w.method === "ZCL_GRANDPARENT=>CLASS_CONSTRUCTOR")).to.equal(true);
      expect(result.dynamicCallsTotal).to.equal(0);
    });

  for (const call of ["post( ).", "me->post( ).", "CALL METHOD post."])
    it(`implicit inherited virtual dispatch: ${call}`, async () => {
      const result = await fixture("DATA lo TYPE REF TO zcl_base. CREATE OBJECT lo TYPE zcl_child. lo->run( ).", {
        "zcl_base.clas.abap": `CLASS zcl_base DEFINITION PUBLIC. PUBLIC SECTION. METHODS run. METHODS post.
          ENDCLASS. CLASS zcl_base IMPLEMENTATION. METHOD run. ${call} ENDMETHOD. METHOD post. ENDMETHOD. ENDCLASS.`,
        "zcl_child.clas.abap": `CLASS zcl_child DEFINITION PUBLIC INHERITING FROM zcl_base. PUBLIC SECTION.
          METHODS post REDEFINITION. ENDCLASS. CLASS zcl_child IMPLEMENTATION. METHOD post. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
      }).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(1);
      expect(warning(result)).to.contain("ZCL_BASE=>RUN").and.contain("ZCL_CHILD=>POST");
      expect(result.dynamicCallsTotal).to.equal(0);
    });

  for (const call of [
    "FIELD-SYMBOLS <lo> TYPE REF TO zcl_worker. ASSIGN lo TO <lo>. <lo>->post( ).",
    "FIELD-SYMBOLS <lo> TYPE REF TO zcl_worker. ASSIGN lo TO <lo>. CALL METHOD <lo>->post.",
    "TYPES ty_worker TYPE REF TO zcl_worker. FIELD-SYMBOLS <lo> TYPE ty_worker. ASSIGN lo TO <lo>. <lo>->post( ).",
    "DATA lt_objs TYPE STANDARD TABLE OF REF TO zcl_worker WITH DEFAULT KEY. APPEND lo TO lt_objs. lt_objs[ 1 ]->post( ).",
    "TYPES: BEGIN OF ty_row, obj TYPE REF TO zcl_worker, END OF ty_row. DATA row TYPE ty_row. row-obj = lo. row-obj->post( ).",
    "CAST zcl_worker( lo )->post( ).",
    "zcl_worker=>make( )->post( ).",
    "NEW zcl_worker( )->post( ).",
  ]) it(`AST receiver dispatch: ${call}`, async () => {
    const result = await fixture(`DATA(lo) = NEW zcl_worker( ). ${call}`, {
      "zcl_worker.clas.abap": `CLASS zcl_worker DEFINITION PUBLIC. PUBLIC SECTION. METHODS post.
        CLASS-METHODS make RETURNING VALUE(ro) TYPE REF TO zcl_worker.
        ENDCLASS. CLASS zcl_worker IMPLEMENTATION. METHOD post. COMMIT WORK. ENDMETHOD.
        METHOD make. ro = NEW zcl_worker( ). ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  for (const body of ["<unknown>->post( ).", "lt_unknown[ 1 ]->post( ).", "CALL METHOD lo->(name).",
    "CALL METHOD (name).", "CALL FUNCTION (name).", "CREATE OBJECT <lo> TYPE (name).",
    "RAISE EVENT done.", "SET HANDLER lo->post FOR sender."])
    it(`unresolved execution never stays harmless: ${body}`, async () => {
      const result = await fixture(body).risk.writesReached("ZCL_TEST");
      expect(result.total).to.equal(0);
      expect(result.dynamicCallsTotal).to.be.greaterThan(0);
      expect(warning(result)).to.contain("may reach a database write");
    });

  it("IN UPDATE TASK is a confirmed write even without the module body", async () => {
    const result = await fixture("CALL FUNCTION 'Z_POST' IN UPDATE TASK.").risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(warning(result)).to.contain("CALL FUNCTION IN UPDATE TASK");
  });

  it("type-only static components do not initialize classes", async () => {
    const result = await fixture("DATA row TYPE zcl_cache=>ty_row.", {
      "zcl_cache.clas.abap": `CLASS zcl_cache DEFINITION PUBLIC. PUBLIC SECTION. TYPES ty_row TYPE i.
        CLASS-METHODS class_constructor. ENDCLASS. CLASS zcl_cache IMPLEMENTATION.
        METHOD class_constructor. COMMIT WORK. ENDMETHOD. ENDCLASS.`,
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(0);
  });

  it("missing initialization bodies and missing superclasses remain uncertain", async () => {
    for (const definition of ["CLASS-METHODS class_constructor.", "METHODS constructor."]) {
      const result = await fixture("DATA(lo) = NEW zcl_incomplete( ).", {
        "zcl_incomplete.clas.abap": `CLASS zcl_incomplete DEFINITION PUBLIC. PUBLIC SECTION.
          ${definition} ENDCLASS. CLASS zcl_incomplete IMPLEMENTATION. ENDCLASS.`,
      }).risk.writesReached("ZCL_TEST");
      expect(warning(result)).to.contain("may reach a database write");
    }
    const result = await fixture("DATA(lo) = NEW zcl_incomplete( ).", {
      "zcl_incomplete.clas.abap": "CLASS zcl_incomplete DEFINITION PUBLIC INHERITING FROM zcl_missing. ENDCLASS. CLASS zcl_incomplete IMPLEMENTATION. ENDCLASS.",
    }).risk.writesReached("ZCL_TEST");
    expect(warning(result)).to.contain("may reach a database write");
  });

  it("analysis failure is visible in the weaker warning", () => {
    expect(riskWarning(harmless, {riskError: "registry unavailable"})).to.contain("may reach a database write").and.contain("registry unavailable");
  });

  it("function bodies retain builtin expressions and report unavailable calls", async () => {
    const result = await fixture("CALL FUNCTION 'Z_POST'.", {
      "zfg_risk.fugr.z_post.abap": "FUNCTION z_post. DATA(n) = strlen( 'x' ). missing( ). ENDFUNCTION.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(result.dynamicCallsTotal).to.equal(1);
    expect(warning(result)).to.contain("may reach a database write");
  });

  it("a declared test whose body is unavailable stays uncertain", async () => {
    const result = await fixture("", {
      "zcl_test.clas.testclasses.abap": "CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS. PRIVATE SECTION. METHODS run FOR TESTING. ENDCLASS.",
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(0);
    expect(warning(result)).to.contain("may reach a database write");
  });

  it("one inherited body is visited for each possible runtime receiver", async () => {
    const result = await fixture("DATA(a) = NEW zcl_reader_child( ). a->run( ). DATA(b) = NEW zcl_writer_child( ). b->run( ).", {
      "zcl_base.clas.abap": `CLASS zcl_base DEFINITION PUBLIC. PUBLIC SECTION. METHODS run. METHODS post.
        ENDCLASS. CLASS zcl_base IMPLEMENTATION. METHOD run. post( ). ENDMETHOD. METHOD post. ENDMETHOD. ENDCLASS.`,
      ...Object.fromEntries(["reader", "writer"].map((name) => [`zcl_${name}_child.clas.abap`,
        `CLASS zcl_${name}_child DEFINITION PUBLIC INHERITING FROM zcl_base. PUBLIC SECTION. METHODS post REDEFINITION.
        ENDCLASS. CLASS zcl_${name}_child IMPLEMENTATION. METHOD post. ${name === "writer" ? "COMMIT WORK." : ""} ENDMETHOD. ENDCLASS.`])),
    }).risk.writesReached("ZCL_TEST");
    expect(result.total).to.equal(1);
    expect(result.writes[0].object).to.equal("ZCL_WRITER_CHILD");
    expect(result.dynamicCallsTotal).to.equal(0);
  });

});
