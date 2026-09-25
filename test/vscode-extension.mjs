// The VS Code extension's logic that needs no VS Code (editors/vscode/lib.js):
// which object a file is, where its includes live, and what a unit run's
// answer means per method. The live half, against a real server, is in
// test/osd-child.mjs.
import {expect} from "chai";
import {createRequire} from "node:module";
import {checkReportDocument, activationSuccessDocument, activationFailureDocument, uriOf as facadeUriOf} from "../tools/adt-documents.mjs";

const {objectOf, adtObjectOf, uriOf, fileOf, outcomes, abapFrame, parseCheckReport, parseActivationResult, runActionFor} =
  createRequire(import.meta.url)("../editors/vscode/lib.js");

describe("editors/vscode: the extension's logic", function () {
  it("names the object and include of an abapGit file", () => {
    expect(objectOf("/x/zcl_a.clas.testclasses.abap")).to.deep.equal({type: "CLAS", name: "ZCL_A", base: "zcl_a", include: "testclasses"});
    expect(objectOf("zcl_a.clas.abap").include).to.equal("main");
    expect(objectOf("#ns#zcl_a.clas.locals_imp.abap")).to.include({name: "/NS/ZCL_A", include: "implementations"});
    expect(objectOf("zprog.prog.abap")).to.include({type: "PROG", name: "ZPROG"});
    expect(objectOf("zif_a.intf.abap")).to.equal(undefined);
  });

  it("finds an include's file beside another file of the object", () => {
    const object = objectOf("zcl_a.clas.abap");
    expect(fileOf("/d", object, "testclasses")).to.equal("/d/zcl_a.clas.testclasses.abap");
    expect(fileOf("/d", object, "main")).to.equal("/d/zcl_a.clas.abap");
    expect(fileOf("/d", object, "implementations")).to.equal("/d/zcl_a.clas.locals_imp.abap");
  });

  it("reads a run per method, the first ABAP frame as the place", () => {
    const run = {testClasses: [
      {name: "LTCL_A", alerts: [], testMethods: [
        {name: "OK", ms: 3, alerts: []},
        {name: "BAD", ms: 4, alerts: [{kind: "failedAssertion", title: "differ", details: ["Expected [1]", "Actual [2]"],
          stack: [{uri: "cl_abap_unit_assert.clas.abap", line: 0}, {uri: "zcl_a.clas.testclasses.abap", line: 12, column: 5}]}]},
      ]},
      {name: "LTCL_SETUP", alerts: [{kind: "exception", title: "class_setup", details: [], stack: []}], testMethods: []},
    ]};
    const got = outcomes(run, [{testClass: "LTCL_SETUP", method: "M1"}]);
    expect(got.map((r) => [r.testClass, r.method, r.passed])).to.deep.equal([
      ["LTCL_A", "OK", true], ["LTCL_A", "BAD", false], ["LTCL_SETUP", "M1", false]]);
    expect(got[1].alerts[0].frame).to.deep.equal({file: "zcl_a.clas.testclasses.abap", line: 12, column: 5});
    expect(abapFrame({stack: []})).to.equal(undefined);
  });

  it("names the object of a file Check/Activate can reach, interfaces included", () => {
    expect(adtObjectOf("/x/zcl_a.clas.testclasses.abap")).to.deep.equal({type: "CLAS", name: "ZCL_A", base: "zcl_a", include: "testclasses"});
    expect(adtObjectOf("zif_a.intf.abap")).to.deep.equal({type: "INTF", name: "ZIF_A", base: "zif_a", include: "main"});
    expect(adtObjectOf("zprog.prog.abap")).to.include({type: "PROG", name: "ZPROG"});
    expect(adtObjectOf("readme.md")).to.equal(undefined);
  });

  it("builds an object's own ADT URI the way tools/adt-documents.mjs does, and refuses a type it does not know", () => {
    expect(uriOf({type: "CLAS", base: "zcl_a"})).to.equal(facadeUriOf("CLAS", "zcl_a"));
    expect(uriOf({type: "INTF", base: "zif_a"})).to.equal(facadeUriOf("INTF", "zif_a"));
    expect(uriOf({type: "PROG", base: "zprog"})).to.equal(facadeUriOf("PROG", "zprog"));
    expect(() => uriOf({type: "FUGR", base: "zfg"})).to.throw(/FUGR/);
  });

  it("Ctrl+F2: reads a check run's diagnostics off checkReportDocument's real shape", () => {
    const clean = parseCheckReport(checkReportDocument([{uri: "/sap/bc/adt/oo/classes/zcl_a", issues: []}]));
    expect(clean).to.deep.equal([{uri: "/sap/bc/adt/oo/classes/zcl_a", status: "processed", statusText: "no errors", issues: []}]);

    const broken = parseCheckReport(checkReportDocument([{uri: "/sap/bc/adt/oo/classes/zcl_a", issues: [
      {severity: "E", message: "\"X\" is not defined", line: 12, column: 5},
      {severity: "W", message: "unused variable", line: 3, column: 1},
    ]}]));
    expect(broken).to.have.lengthOf(1);
    expect(broken[0].statusText).to.equal("2 error(s)");
    expect(broken[0].issues).to.deep.equal([
      {line: 12, column: 5, severity: "E", message: '"X" is not defined'},
      {line: 3, column: 1, severity: "W", message: "unused variable"},
    ]);

    // a check that could not run: no issues, but not a clean pass either
    const notProcessed = parseCheckReport(checkReportDocument([{uri: "/sap/bc/adt/oo/classes/zcl_x", issues: [], status: "notProcessed", statusText: "ZCL_X does not exist"}]));
    expect(notProcessed[0]).to.include({status: "notProcessed", statusText: "ZCL_X does not exist"});
  });

  it("Ctrl+F3: tells a clean activation from a failed one, off the real activation documents", () => {
    expect(parseActivationResult(activationSuccessDocument())).to.deep.equal({ok: true, issues: []});

    const failed = parseActivationResult(activationFailureDocument([
      {type: "CLAS", name: "ZCL_A", issues: [{severity: "E", message: "Syntax error", line: 7, column: 3}]},
    ]));
    expect(failed.ok).to.equal(false);
    expect(failed.issues).to.deep.equal([{line: 7, column: 3, objDescr: "ZCL_A", message: "Syntax error"}]);
  });

  it("SE80's F8, one entry per object type: what this build does, or the route its turn would use", () => {
    expect(runActionFor({type: "CLAS", name: "ZCL_DEMO"}, {hasUnitTests: true})).to.deep.equal({kind: "unit"});
    expect(runActionFor({type: "CLAS", name: "ZCL_DEMO"}, {hasUnitTests: false}).kind).to.equal("not-yet");
    // a service's own class: F8 there means a Gateway client, before ABAP Unit
    const dpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: true});
    expect(dpc).to.deep.equal({kind: "not-yet", text: "not yet: a Gateway client prefilled with the service and the entity set of the method under the cursor"});
    const mpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_MPC_EXT"}, {hasUnitTests: true});
    expect(mpc.kind).to.equal("not-yet");
    expect(runActionFor({type: "INTF", name: "ZIF_A"})).to.deep.equal({kind: "not-yet", text: "not yet: an interface has nothing of its own to run"});
    expect(runActionFor({type: "FUGR", name: "ZFG"}).text).to.contain("/sap/bc/osd/rfc/functions/<NAME>");
    expect(runActionFor({type: "TABL", name: "ZSTG_DEMO"}).text).to.equal("not yet: data preview");
    expect(runActionFor({type: "DDLS", name: "ZC_STG_DEMO"}).text).to.equal("not yet: data preview");
    expect(runActionFor({type: "IWSV", name: "ZSTG_DEMO_SRV"}).text).to.equal("not yet: the Gateway client on the service document");
    expect(runActionFor({type: "SICF", name: "ZOSD_APP"}).kind).to.equal("not-yet");
    expect(runActionFor({type: "BOGUS", name: "X"}).text).to.contain("BOGUS");
  });
});
