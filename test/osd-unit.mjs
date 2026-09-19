import {expect} from "chai";
import {ObjectStore} from "../tools/osd-store.mjs";
import {UnitRun, alertOf, statementAfter} from "../tools/osd-unit.mjs";
import {writeFileSync, rmSync} from "node:fs";
import {join} from "node:path";

// The test run of OSD. vsp reads a program, its test classes, their test
// methods and the alerts under a method, and a method with no alert is a
// method that passed. So the tree is checked shape first, then against a
// real run of this repository's own ABAP Unit tests.
describe("tools/osd-unit: ABAP Unit for one object, shaped as ADT reports it", function () {
  // a run boots the transpiled runtime in a child process
  this.timeout(180000);
  const store = new ObjectStore();
  const runner = new UnitRun(store);

  it("finds the test classes and their methods in the parse, without running anything", () => {
    const {object, classes} = runner.classes("CLAS", "ZCL_STG_SEGW_TEST");
    expect(object.name).to.equal("ZCL_STG_SEGW_TEST");
    expect(classes.map((c) => c.name)).to.include.members(["LTCL_CRUD", "LTCL_TREE", "LTCL_IMPORT"]);

    const tree = classes.find((c) => c.name === "LTCL_TREE");
    // what a client needs to render and to navigate to
    expect(tree).to.include({riskLevel: "harmless", durationCategory: "short", include: "testclasses"});
    expect(tree.line).to.be.greaterThan(1);
    expect(tree.testMethods.map((m) => m.name)).to.deep.equal([
      "ENTITY_TYPES_OF_THE_PROJECT", "PROPERTIES_IN_FILE_ORDER", "TEXT_TABLE_OF_THE_PROJECT",
    ]);
    // every method knows where it is written, so the façade can build a
    // navigation URI into the include. The position is the body, not the
    // declaration: a client that follows the URI wants the code
    const source = store.read("CLAS", "ZCL_STG_SEGW_TEST", "testclasses").source.split("\n");
    for (const method of tree.testMethods) {
      expect(method.line, method.name).to.be.greaterThan(tree.line);
      expect(source[method.line - 1].toUpperCase(), method.name).to.contain(`METHOD ${method.name}`);
    }
  });

  it("an object with no test classes is an empty run, not an error", () => {
    const {classes} = runner.classes("CLAS", "ZCL_STG_SEGW_TREE");
    expect(classes).to.deep.equal([]);
  });

  it("runs the tests of one object and reports every method, passed or not", async () => {
    // detached: a test writes to the database, and a server's own rows are
    // not what it should write to
    const result = await runner.runDetached("CLAS", "ZCL_STG_SEGW_TEST", {testClass: "LTCL_TREE"});
    expect(result.program).to.include({name: "ZCL_STG_SEGW_TEST", type: "CLAS/OC"});
    expect(result.testClasses.length).to.equal(1);

    const [tree] = result.testClasses;
    expect(tree.name).to.equal("LTCL_TREE");
    expect(tree.alerts).to.deep.equal([]);
    expect(tree.testMethods.length).to.equal(3);
    for (const method of tree.testMethods) {
      // no alert is what "passed" means on the wire
      expect(method.alerts, `${method.name}: ${JSON.stringify(method.alerts)}`).to.deep.equal([]);
      expect(method.unit).to.equal("s");
      expect(Number(method.executionTime)).to.be.at.least(0);
    }
    expect(result.counts).to.include({classes: 1, methods: 3, passed: 3, failed: 0});
    expect(result.ok).to.equal(true);
  });

  it("one method can be asked for on its own", async () => {
    const result = await runner.runDetached("CLAS", "ZCL_STG_SEGW_TEST", {testClass: "LTCL_TREE", method: "PROPERTIES_IN_FILE_ORDER"});
    expect(result.counts).to.include({methods: 1, passed: 1});
    expect(result.testClasses[0].testMethods[0].name).to.equal("PROPERTIES_IN_FILE_ORDER");
  });

  it("a test class that was never transpiled is an alert, not silence", async () => {
    // **The subject is planted, not borrowed.** This used to run against
    // `CL_ABAP_CHAR_UTILITIES`, on the note that "a library's own tests are
    // in the parse but not in output/" -- which was true by accident: the
    // store walked whole library folders, test classes and all, while the
    // build has never read a library's test classes. The moment the store
    // was made to read what the build reads (2026-09-19) the subject stopped
    // having a test class at all and the test went green over nothing.
    //
    // So the case is built instead of found: a class written now, with a test
    // class beside it, in a tree whose output/ was transpiled before it
    // existed. That is the property -- in the parse, not in output/ -- rather
    // than a circumstance of somebody's checkout.
    const name = "ZCL_OSD_UNTRANSPILED_PROBE";
    const file = join("src", "zcl_osd_untranspiled_probe.clas.abap");
    const tests = join("src", "zcl_osd_untranspiled_probe.clas.testclasses.abap");
    const xml = join("src", "zcl_osd_untranspiled_probe.clas.xml");
    writeFileSync(file, `CLASS zcl_osd_untranspiled_probe DEFINITION PUBLIC CREATE PUBLIC FOR TESTING
  DURATION SHORT RISK LEVEL HARMLESS.
ENDCLASS.

CLASS zcl_osd_untranspiled_probe IMPLEMENTATION.
ENDCLASS.
`);
    writeFileSync(tests, `CLASS ltcl_probe DEFINITION FOR TESTING DURATION SHORT RISK LEVEL HARMLESS FINAL.
  PRIVATE SECTION.
    METHODS nothing FOR TESTING RAISING cx_static_check.
ENDCLASS.

CLASS ltcl_probe IMPLEMENTATION.
  METHOD nothing.
  ENDMETHOD.
ENDCLASS.
`);
    writeFileSync(xml, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS>
<CLSNAME>${name}</CLSNAME><LANGU>E</LANGU><DESCRIPT>probe</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE>
</VSEOCLASS></asx:values></asx:abap></abapGit>
`);
    try {
      const fresh = new UnitRun(new ObjectStore());
      const result = await fresh.runDetached("CLAS", name);
      expect(result.ok).to.equal(false);
      const [alert] = result.testClasses[0].alerts;
      expect(alert.severity).to.equal("fatal");
      expect(alert.title).to.contain("has not been transpiled");
      expect(result.testClasses[0].testMethods).to.deep.equal([]);
    } finally {
      for (const f of [file, tests, xml]) rmSync(f, {force: true});
    }
  });

  it("a method that throws is one failed method, and the rest still run", async () => {
    // a method the module does not have: the runtime throws, and what
    // matters is that the throw is reported rather than ending the run
    const plan = runner.classes("CLAS", "ZCL_STG_SEGW_TEST");
    const tree = plan.classes.find((c) => c.name === "LTCL_TREE");
    tree.testMethods = [
      {name: "NO_SUCH_METHOD", method: "no_such_method", line: 1, column: 1},
      ...tree.testMethods.slice(0, 1),
    ];
    const result = await runner.runDetached("CLAS", "ZCL_STG_SEGW_TEST", {plan, testClass: "LTCL_TREE"});

    const [broken, survivor] = result.testClasses[0].testMethods;
    expect(broken.name).to.equal("NO_SUCH_METHOD");
    expect(broken.alerts.length).to.equal(1);
    expect(broken.alerts[0]).to.include({kind: "shortDump", severity: "fatal"});
    expect(broken.alerts[0].details).to.include("Raised in no_such_method");
    // the next method ran anyway, which is the whole point of the tree
    expect(survivor.alerts).to.deep.equal([]);
    expect(result.counts).to.include({methods: 2, passed: 1, failed: 1});
    expect(result.ok).to.equal(false);
  });

  it("a failed assertion becomes an alert with the failure text a human reads", () => {
    // the shape the transpiled runtime throws, checked against a real
    // kernel_cx_assert: msg, expected and actual are ABAP strings, and
    // EXTRA_CX says where it was raised
    class kernel_cx_assert extends Error {}
    const thrown = new kernel_cx_assert("assert");
    thrown.msg = {get: () => "Expected 'b', got 'a'"};
    thrown.expected = {get: () => "b"};
    thrown.actual = {get: () => "a"};
    thrown.EXTRA_CX = {INTERNAL_FILENAME: "cl_abap_unit_assert.clas.abap", INTERNAL_LINE: 460};

    const alert = alertOf(thrown, "text_table_of_the_project");
    expect(alert).to.include({kind: "failedAssertion", severity: "critical", title: "Expected 'b', got 'a'"});
    expect(alert.details).to.include.members(["Expected [b]", "Actual [a]", "Raised in text_table_of_the_project"]);
    expect(alert.stack[0]).to.include({uri: "cl_abap_unit_assert.clas.abap", line: 460});
  });

  it("a stack entry names the statement that raised, not the one before it", () => {
    // the transpiler maps a generated line to where the previous ABAP
    // statement ended, so a position read straight out of the map lands on
    // the line above: right screen, wrong line. Verified against a real
    // failure too, which moved from 199 to 200 on the assert it broke.
    const source = [
      "  METHOD does_something.",
      "    ls_response = zcl_stg_dispatcher=>dispatch( iv_method = 'GET'",
      "                                                iv_path   = '/x' ).",
      "",
      "*   a comment is not a statement",
      "    cl_abap_unit_assert=>assert_equals( act = ls_response-status exp = 200 ).",
      "  ENDMETHOD.",
    ].join("\n");

    // the end of the dispatch call, which is what the map points at
    expect(statementAfter(source, 3, source.split("\n")[2].length)).to.deep.equal({line: 6, column: 5});
    // a position inside a statement is already the statement
    expect(statementAfter(source, 6, 20)).to.deep.equal({line: 6, column: 20});
    // no source to read means the mapped position stands
    expect(statementAfter(undefined, 12, 3)).to.deep.equal({line: 12, column: 3});
  });

  it("an uncaught ABAP exception and a broken runtime are different kinds of alert", () => {
    class zcx_stg_error extends Error {}
    const raised = new zcx_stg_error("raised");
    raised.INTERNAL_ID = 42;
    raised.msg = {get: () => "Service ZSTG_SEGW_SRV is not registered"};
    const exception = alertOf(raised, "setup");
    expect(exception).to.include({kind: "exception", severity: "critical"});
    expect(exception.title).to.contain("ZCX_STG_ERROR");
    expect(exception.details).to.include("Service ZSTG_SEGW_SRV is not registered");

    const dump = alertOf(new TypeError("cannot read properties of undefined"), "run");
    expect(dump).to.include({kind: "shortDump", severity: "fatal", title: "cannot read properties of undefined"});
  });
});
