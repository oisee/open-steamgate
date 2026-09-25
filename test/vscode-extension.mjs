// The VS Code extension's logic that needs no VS Code (editors/vscode/lib.js):
// which object a file is, where its includes live, and what a unit run's
// answer means per method. The live half, against a real server, is in
// test/osd-child.mjs.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {checkReportDocument, activationSuccessDocument, activationFailureDocument, uriOf as facadeUriOf} from "../tools/adt-documents.mjs";
import {entitySetMapFor} from "../tools/segw-entityset-map.mjs";

const {objectOf, adtObjectOf, uriOf, fileOf, outcomes, abapFrame, parseCheckReport, parseActivationResult, runActionFor,
  entitySetMethodLines, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf} =
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
    // a service's own class, cursor outside any entity-set method: F8 there
    // means a Gateway client, before ABAP Unit -- still not yet
    const dpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: true});
    expect(dpc.kind).to.equal("not-yet");
    expect(dpc.text).to.contain("get_entityset");
    const mpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_MPC_EXT"}, {hasUnitTests: true});
    expect(mpc.kind).to.equal("not-yet");
    // Q2b: cursor inside a known entity-set method does what its lens does
    const inside = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"},
      {hasUnitTests: true, entitySet: {service: "ZSTG_DEMO_SRV", set: "TravelSet", entityKind: "get_entityset"}});
    expect(inside).to.deep.equal({kind: "call-entityset", service: "ZSTG_DEMO_SRV", set: "TravelSet", entityKind: "get_entityset"});
    expect(runActionFor({type: "INTF", name: "ZIF_A"})).to.deep.equal({kind: "not-yet", text: "not yet: an interface has nothing of its own to run"});
    expect(runActionFor({type: "FUGR", name: "ZFG"}).text).to.contain("/sap/bc/osd/rfc/functions/<NAME>");
    expect(runActionFor({type: "TABL", name: "ZSTG_DEMO"}).text).to.equal("not yet: data preview");
    expect(runActionFor({type: "DDLS", name: "ZC_STG_DEMO"}).text).to.equal("not yet: data preview");
    expect(runActionFor({type: "IWSV", name: "ZSTG_DEMO_SRV"}).text).to.equal("not yet: the Gateway client on the service document");
    expect(runActionFor({type: "SICF", name: "ZOSD_APP"}).kind).to.equal("not-yet");
    expect(runActionFor({type: "BOGUS", name: "X"}).text).to.contain("BOGUS");
  });

  // ---- Q2b "Runner": the CodeLens over a SEGW _DPC_EXT class's own
  // `<set>_get_entityset` / `<set>_get_entity` methods, and F8 doing what
  // the lens above the cursor's own method does.

  it("Q2b: a lens line over each METHOD <set>_get_entityset. / <set>_get_entity. line, none elsewhere", () => {
    const source = [
      "CLASS zcl_x IMPLEMENTATION.",
      "  METHOD travelset_get_entityset.",
      "    \" body",
      "  ENDMETHOD.",
      "  METHOD travelset_get_entity.",
      "  ENDMETHOD.",
      "  METHODS travelset_get_entityset REDEFINITION.", // a declaration, not the body: no line for this
      "  METHOD other_method.",
      "  ENDMETHOD.",
      "ENDCLASS.",
    ].join("\n");
    expect(entitySetMethodLines(source)).to.deep.equal([
      {line: 2, method: "TRAVELSET_GET_ENTITYSET", kind: "get_entityset"},
      {line: 5, method: "TRAVELSET_GET_ENTITY", kind: "get_entity"},
    ]);
  });

  it("Q2b: a lens only for a method the server's map names, titled with the set's real name", () => {
    const source = [
      "  METHOD travelset_get_entityset.",
      "  ENDMETHOD.",
      "  METHOD bookingset_get_entityset.", // the server does not know this one
      "  ENDMETHOD.",
    ].join("\n");
    const map = {service: "ZSTG_DEMO_SRV", sets: [{method: "TRAVELSET_GET_ENTITYSET", kind: "get_entityset", set: "TravelSet"}]};
    expect(entitySetLenses(source, map)).to.deep.equal([
      {line: 1, kind: "get_entityset", set: "TravelSet", service: "ZSTG_DEMO_SRV", title: "▶ Call TravelSet"},
    ]);
    expect(entitySetLenses(source, undefined)).to.deep.equal([]);
  });

  it("Q2b: the method a cursor's (0-based) line sits inside, cleared by the ENDMETHOD that closes it", () => {
    const source = [
      "  METHOD travelset_get_entityset.", // 0
      "    DATA lv TYPE i.",               // 1
      "  ENDMETHOD.",                      // 2
      "  METHOD travelset_get_entity.",    // 3
      "  ENDMETHOD.",                      // 4
      "  DATA gv TYPE i.",                 // 5, between methods
    ].join("\n");
    expect(methodAtLine(source, 0)).to.equal("TRAVELSET_GET_ENTITYSET");
    expect(methodAtLine(source, 1)).to.equal("TRAVELSET_GET_ENTITYSET");
    expect(methodAtLine(source, 2)).to.equal(undefined);
    expect(methodAtLine(source, 3)).to.equal("TRAVELSET_GET_ENTITY");
    expect(methodAtLine(source, 5)).to.equal(undefined);
  });

  it("Q2b: an OData v2 answer's rows, the key predicate off __metadata, columns without it", () => {
    const setBody = {d: {results: [
      {__metadata: {uri: "http://x/TravelSet('T0001')"}, TravelId: "T0001", Description: "A"},
      {__metadata: {uri: "http://x/TravelSet('T0002')"}, TravelId: "T0002", Description: "B"},
    ]}};
    const rows = resultRows(setBody);
    expect(rows).to.have.lengthOf(2);
    expect(keyOf(rows[0])).to.equal("'T0001'");
    expect(stripMetadata(rows[0])).to.deep.equal({TravelId: "T0001", Description: "A"});

    const entityBody = {d: {__metadata: {uri: "http://x/BookingSet(TravelID='T0001',BookingID='0001')"}, TravelID: "T0001", BookingID: "0001"}};
    const one = resultRows(entityBody);
    expect(one).to.have.lengthOf(1);
    expect(keyOf(one[0])).to.equal("TravelID='T0001',BookingID='0001'");

    expect(resultRows({})).to.deep.equal([]);
    expect(keyOf({})).to.equal(undefined);
  });

  it("Q2b: end to end against the demo's own sources -- what a CodeLens gets is what tools/adt-facade.mjs answers", () => {
    const readSource = (name) => readFileSync(`src/demo/${name.toLowerCase()}.clas.abap`, "utf8");
    const registrations = [{dpc: "ZCL_ZSTG_DEMO_DPC_EXT", mpc: "ZCL_ZSTG_DEMO_MPC_EXT", external: "ZSTG_DEMO_SRV", service: "ZSTG_DEMO_SRV"}];
    const map = entitySetMapFor("ZCL_ZSTG_DEMO_DPC_EXT", registrations, readSource);
    expect(map.service).to.equal("ZSTG_DEMO_SRV");
    const dpcSource = readSource("ZCL_ZSTG_DEMO_DPC_EXT");
    const lenses = entitySetLenses(dpcSource, map);
    expect(lenses.map((l) => l.title)).to.include("▶ Call TravelSet");
    const travel = lenses.find((l) => l.kind === "get_entityset" && l.set === "TravelSet");
    expect(dpcSource.split(/\r\n|\r|\n/)[travel.line - 1]).to.match(/METHOD travelset_get_entityset\.\s*$/i);
    // and F8 with the cursor on that same line does the same as the lens
    const entitySet = {service: map.service, set: travel.set, entityKind: travel.kind};
    expect(runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: false, entitySet}))
      .to.deep.equal({kind: "call-entityset", service: "ZSTG_DEMO_SRV", set: "TravelSet", entityKind: "get_entityset"});
  });
});
