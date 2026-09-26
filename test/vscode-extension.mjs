// The VS Code extension's logic that needs no VS Code (editors/vscode/lib.js):
// which object a file is, where its includes live, and what a unit run's
// answer means per method. The live half, against a real server, is in
// test/osd-child.mjs.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {checkReportDocument, activationSuccessDocument, activationFailureDocument, uriOf as facadeUriOf} from "../tools/adt-documents.mjs";
import {entitySetMapFor} from "../tools/segw-entityset-map.mjs";
import {tableDataDocument} from "../tools/adt-facade.mjs";

const {objectOf, adtObjectOf, uriOf, fileOf, outcomes, abapFrame, parseCheckReport, parseActivationResult, runActionFor,
  entitySetMethodLines, entitySetLenses, methodAtLine, resultRows, stripMetadata, keyOf,
  readersLensLine, readersLensTitle, readersQuickPickItems, readerFilePattern,
  htmlEscape, freestyleRows, freestyleTableHtml, notebookFromJson, notebookToJson,
  HOTSPOTS_SQL, hotspotsFromRows, hotspotBucket, hotspotColor, hotspotBadge, hotspotHoverText,
  implementsClassrun,
  transpileLayers, classifyTestPath, PACKAGE_SPLIT_THRESHOLD, needsPackageSplit, packageDirsFrom, packageOf, hasTestMethods} =
  createRequire(import.meta.url)("../editors/vscode/lib.js");
import {implementsClassrun as facadeImplementsClassrun} from "../tools/osd-classrun.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

  // ---- Q6b "Classrun": F9, ADT's "Run as ABAP Application (Console)" --
  // implementsClassrun (the buffer scan F8's dispatch and osd-classrun.mjs's
  // server-side check both run) and the dispatch itself, held to the same
  // shape lib.js's own RUN_TABLE test above holds every other kind to.
  it("Q6b: a class buffer declaring IF_OO_ADT_CLASSRUN, off the source text alone", () => {
    const demo = readFileSync(new URL("../src/classrun/zcl_osd_classrun_demo.clas.abap", import.meta.url), "utf8");
    expect(implementsClassrun(demo)).to.equal(true);
    expect(implementsClassrun("CLASS zcl_x DEFINITION.\nENDCLASS.")).to.equal(false);
    // case- and whitespace-insensitive, the way an ABAP statement is
    expect(implementsClassrun("  interfaces   if_oo_adt_classrun .")).to.equal(true);
    // a class that merely names the interface in a comment does not count
    expect(implementsClassrun("* interfaces if_oo_adt_classrun would go here")).to.equal(false);
    // the two implementations (the editor's buffer scan and the façade's
    // own file scan, tools/osd-classrun.mjs) agree on the same fixture
    expect(facadeImplementsClassrun(demo)).to.equal(implementsClassrun(demo));
  });

  it("Q6b: F8 dispatches a no-tests classrun class to a run, tests still win, neither loses to the other", () => {
    expect(runActionFor({type: "CLAS", name: "ZCL_OSD_CLASSRUN_DEMO"}, {hasUnitTests: false, hasClassrun: true}))
      .to.deep.equal({kind: "classrun"});
    // ABAP Unit still wins when a class happens to carry both
    expect(runActionFor({type: "CLAS", name: "ZCL_OSD_CLASSRUN_DEMO"}, {hasUnitTests: true, hasClassrun: true}))
      .to.deep.equal({kind: "unit"});
    // neither: the same "not yet" as before Q6b existed
    expect(runActionFor({type: "CLAS", name: "ZCL_DEMO"}, {hasUnitTests: false, hasClassrun: false}).kind)
      .to.equal("not-yet");
    // a DPC_EXT's own dispatch (Q2b) still comes first, classrun or not
    const dpc = runActionFor({type: "CLAS", name: "ZCL_ZSTG_DEMO_DPC_EXT"}, {hasUnitTests: false, hasClassrun: true});
    expect(dpc.kind).to.equal("not-yet");
    expect(dpc.text).to.contain("get_entityset");
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

  // ---- Q3 "Readers": the lens over a class's or interface's own definition
  // line, its title, the quick pick a click shows, and the file glob a
  // chosen reader opens.

  it("Q3: the lens line is the object's own CLASS ... DEFINITION / INTERFACE line, none for another object's", () => {
    const clas = [
      "CLASS zcl_other DEFINITION PUBLIC.",      // 1, not this object
      "ENDCLASS.",                               // 2
      "CLASS zcl_x DEFINITION PUBLIC FINAL.",    // 3
      "  PUBLIC SECTION.",                       // 4
      "ENDCLASS.",                               // 5
      "CLASS zcl_x IMPLEMENTATION.",             // 6, not a DEFINITION line
      "ENDCLASS.",                               // 7
    ].join("\n");
    expect(readersLensLine(clas, {type: "CLAS", name: "ZCL_X"})).to.equal(3);
    expect(readersLensLine(clas, {type: "CLAS", name: "ZCL_NOT_THERE"})).to.equal(undefined);

    const intf = ["\" a comment", "INTERFACE zif_x PUBLIC."].join("\n");
    expect(readersLensLine(intf, {type: "INTF", name: "ZIF_X"})).to.equal(2);

    // an INTERFACES statement (implementing one, inside a class) is not an
    // INTERFACE statement (declaring one)
    expect(readersLensLine("  INTERFACES zif_x.", {type: "INTF", name: "ZIF_X"})).to.equal(undefined);
    expect(readersLensLine(clas, {type: "PROG", name: "ZCL_X"})).to.equal(undefined);
    expect(readersLensLine(clas, undefined)).to.equal(undefined);
  });

  it("Q3: the lens title, off the server's own counts", () => {
    expect(readersLensTitle({readers: 3, tests: 1, services: 2})).to.equal("read by 3 · tests 1 · services 2");
    expect(readersLensTitle(undefined)).to.equal("read by 0 · tests 0 · services 0");
  });

  it("Q3: the quick pick tags a reader that is a test, a service, both, or neither", () => {
    const readers = [
      {type: "CLAS", name: "ZCL_A", include: "ZCL_A", isTest: false, services: []},
      {type: "CLAS", name: "ZCL_B", include: "ZCL_B", isTest: true, services: []},
      {type: "CLAS", name: "ZCL_C", include: "ZCL_C", isTest: false, services: ["ZSTG_DEMO_SRV"]},
      {type: "CLAS", name: "ZCL_D", include: "ZCL_D", isTest: true, services: ["ZSTG_DEMO_SRV", "ZOSD_TEST_SRV"]},
    ];
    const items = readersQuickPickItems(readers);
    expect(items.map((i) => i.label)).to.deep.equal(["ZCL_A", "ZCL_B", "ZCL_C", "ZCL_D"]);
    expect(items[0].description).to.equal("CLAS");
    expect(items[1].description).to.equal("CLAS · Test");
    expect(items[2].description).to.equal("CLAS · Service (ZSTG_DEMO_SRV)");
    expect(items[3].description).to.equal("CLAS · Test · Service (ZSTG_DEMO_SRV, ZOSD_TEST_SRV)");
    expect(items.map((i) => i.reader)).to.deep.equal(readers);
    expect(readersQuickPickItems(undefined)).to.deep.equal([]);
  });

  it("Q3: a reader's file glob, namespace-to-# and all, undefined for a type with no known file shape", () => {
    expect(readerFilePattern({type: "CLAS", name: "ZCL_ZSTG_DEMO_MPC_EXT"})).to.equal("**/zcl_zstg_demo_mpc_ext.clas.abap");
    expect(readerFilePattern({type: "INTF", name: "ZIF_STG_CDS_SOURCE"})).to.equal("**/zif_stg_cds_source.intf.abap");
    expect(readerFilePattern({type: "PROG", name: "ZREPORT"})).to.equal("**/zreport.prog.abap");
    expect(readerFilePattern({type: "CLAS", name: "/NS/ZCL_X"})).to.equal("**/#ns#zcl_x.clas.abap");
    expect(readerFilePattern({type: "FUGR", name: "ZFG"})).to.equal(undefined);
    expect(readerFilePattern(undefined)).to.equal(undefined);
  });

  it("Q3: end to end against the demo's own sources -- what the lens shows is what tools/adt-facade.mjs's readers route answers", () => {
    const mpcSource = readFileSync("src/demo/zcl_zstg_demo_mpc_ext.clas.abap", "utf8");
    const object = adtObjectOf("zcl_zstg_demo_mpc_ext.clas.abap");
    const line = readersLensLine(mpcSource, object);
    expect(line).to.be.a("number");
    expect(mpcSource.split(/\r\n|\r|\n/)[line - 1]).to.match(/^CLASS\s+zcl_zstg_demo_mpc_ext\s+DEFINITION\b/i);
  });

  // ---- Q6a "Notebook SQL": the pure half of a *.osdnb notebook -- the
  // freestyle route's own column-oriented XML into rows, the rows into an
  // escaped HTML table, and a notebook file's JSON into cells and back.

  it("Q6a: the freestyle route's own XML shape (tools/adt-facade.mjs tableDataDocument) becomes columns and rows", () => {
    const xml = tableDataDocument({
      rows: [{TRAVEL_ID: "T0001", DESCRIPTION: "Berlin"}, {TRAVEL_ID: "T0002", DESCRIPTION: "Paris"}],
      columns: ["TRAVEL_ID", "DESCRIPTION"],
    });
    const {columns, rows} = freestyleRows(xml);
    expect(columns).to.deep.equal(["TRAVEL_ID", "DESCRIPTION"]);
    expect(rows).to.deep.equal([
      {TRAVEL_ID: "T0001", DESCRIPTION: "Berlin"},
      {TRAVEL_ID: "T0002", DESCRIPTION: "Paris"},
    ]);
  });

  it("Q6a: an empty result set is zero rows, not one row of nothing", () => {
    const xml = tableDataDocument({rows: [], columns: ["A", "B"]});
    expect(freestyleRows(xml)).to.deep.equal({columns: ["A", "B"], rows: []});
  });

  it("Q6a: a value the XML had to escape (& and <) round-trips through freestyleRows unescaped", () => {
    const xml = tableDataDocument({rows: [{NOTE: "Tom & Jerry <3"}], columns: ["NOTE"]});
    expect(freestyleRows(xml).rows).to.deep.equal([{NOTE: "Tom & Jerry <3"}]);
  });

  it("Q6a: htmlEscape stops a cell value with < or & from becoming markup", () => {
    expect(htmlEscape("<script>alert(1)</script>")).to.equal("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(htmlEscape("Fish & Chips")).to.equal("Fish &amp; Chips");
    expect(htmlEscape(undefined)).to.equal("");
  });

  it("Q6a: the cell output table escapes every cell, and the status line carries rows, ms and generation", () => {
    const html = freestyleTableHtml(["NAME"], [{NAME: "<b>&</b>"}], {ms: 12, generation: "abcdef1234567890"});
    expect(html).to.contain("<th>NAME</th>");
    expect(html).to.contain("<td>&lt;b&gt;&amp;&lt;/b&gt;</td>");
    expect(html).to.not.contain("<b>&</b>");
    expect(html).to.contain("1 row · 12 ms · abcdef12");
  });

  it("Q6a: the status line leaves the generation off when the answer did not carry one", () => {
    const html = freestyleTableHtml([], [], {ms: 3});
    expect(html).to.contain("0 rows · 3 ms</div>");
  });

  it("Q6a: a notebook's own JSON becomes cells, code defaulting to sql, markdown its own kind", () => {
    const cells = notebookFromJson(JSON.stringify({cells: [
      {kind: "markdown", value: "# Demo"},
      {kind: "code", value: "SELECT 1"},
      {kind: "code", language: "sql", value: "SELECT 2"},
    ]}));
    expect(cells).to.deep.equal([
      {kind: "markdown", language: "markdown", value: "# Demo"},
      {kind: "code", language: "sql", value: "SELECT 1"},
      {kind: "code", language: "sql", value: "SELECT 2"},
    ]);
  });

  it("Q6a: a bad or missing notebook JSON reads as no cells rather than throwing", () => {
    expect(notebookFromJson("not json")).to.deep.equal([]);
    expect(notebookFromJson(JSON.stringify({}))).to.deep.equal([]);
  });

  it("Q6a: notebookToJson and notebookFromJson round-trip a notebook", () => {
    const cells = [
      {kind: "code", language: "sql", value: "SELECT * FROM zstg_demo"},
      {kind: "markdown", language: "markdown", value: "a query"},
    ];
    const text = notebookToJson(cells);
    expect(text.endsWith("\n")).to.equal(true);
    expect(notebookFromJson(text)).to.deep.equal(cells);
  });

  // ---- Q4 "Hotspots": ZOSD_DUMP as heat, off the same freestyle SQL door
  // Q6a's notebook uses (HOTSPOTS_SQL, hotspotsFromRows); tableDataDocument
  // builds the real XML shape a server answers with, the same way Q6a's own
  // tests hold freestyleRows to the real document rather than a hand-typed one.

  it("Q4: HOTSPOTS_SQL is a SELECT, over zosd_dump, grouped by object/include/line", () => {
    expect(HOTSPOTS_SQL).to.match(/^SELECT\b/i);
    expect(HOTSPOTS_SQL).to.contain("FROM zosd_dump");
    expect(HOTSPOTS_SQL).to.contain("GROUP BY objname");
  });

  it("Q4: a server's own freestyle rows (real XML shape) become byLine and byFile counts", () => {
    const rows = [
      {objname: "ZCL_STG_DISPATCHER", include: "main", line: "119", n: "3", last_at: "1700000000000", last_message: "Division by zero"},
      {objname: "ZCL_STG_DISPATCHER", include: "main", line: "44", n: "1", last_at: "1700000001000", last_message: "no such field"},
      {objname: "ZCL_STG_ENTRY_PROVIDER", include: "testclasses", line: "7", n: "12", last_at: "1700000002000", last_message: "conversion"},
    ];
    const xml = tableDataDocument({columns: ["objname", "include", "line", "n", "last_at", "last_message"], rows});
    const {byLine, byFile} = hotspotsFromRows(freestyleRows(xml).rows);
    expect(byLine).to.have.length(3);
    const dispatcher119 = byLine.find((e) => e.objname === "ZCL_STG_DISPATCHER" && e.line === 119);
    expect(dispatcher119).to.deep.equal({objname: "ZCL_STG_DISPATCHER", include: "main", line: 119, count: 3, lastAt: 1700000000000, lastMessage: "Division by zero"});
    expect(byFile).to.deep.equal({ZCL_STG_DISPATCHER: 4, ZCL_STG_ENTRY_PROVIDER: 12});
  });

  it("Q4: a row with no object name or no usable line is dropped, not guessed at", () => {
    const {byLine, byFile} = hotspotsFromRows([
      {objname: "", include: "main", line: "5", n: "2"},
      {objname: "ZCL_A", include: "main", line: "", n: "1"},
      {objname: "ZCL_A", include: "main", line: "0", n: "1"},
    ]);
    expect(byLine).to.deep.equal([]);
    expect(byFile).to.deep.equal({});
    expect(hotspotsFromRows(undefined)).to.deep.equal({byLine: [], byFile: {}});
  });

  it("Q4: intensity buckets a fixed few steps rather than a scale fitted to the data", () => {
    expect([0, 1, 2, 4, 5, 9, 10, 999].map(hotspotBucket)).to.deep.equal([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("Q4: bucket colours are translucent and get heavier with the bucket", () => {
    const colors = [1, 2, 3, 4].map(hotspotColor);
    for (const c of colors) expect(c).to.match(/^rgba\(255, 0, 0, 0(\.\d+)?\)$/);
    const alpha = (c) => Number(/rgba\(255, 0, 0, (0(?:\.\d+)?)\)/.exec(c)[1]);
    expect(alpha(colors[0])).to.be.lessThan(alpha(colors[1]));
    expect(alpha(colors[1])).to.be.lessThan(alpha(colors[2]));
    expect(alpha(colors[2])).to.be.lessThan(alpha(colors[3]));
  });

  it("Q4: a badge is at most two characters (VS Code's own limit)", () => {
    expect(hotspotBadge(1)).to.equal("1");
    expect(hotspotBadge(9)).to.equal("9");
    expect(hotspotBadge(10)).to.equal("9+");
    expect(hotspotBadge(250)).to.equal("9+");
    for (const n of [1, 9, 10, 250]) expect(hotspotBadge(n)).to.have.length.at.most(2);
  });

  it("Q4: a line's hover names the count, the last time and the message", () => {
    const text = hotspotHoverText({count: 3, lastAt: Date.parse("2026-09-25T12:00:00Z"), lastMessage: "Division by zero"});
    expect(text).to.equal("3 dumps, last 2026-09-25T12:00:00.000Z: Division by zero");
    expect(hotspotHoverText({count: 1, lastAt: 0, lastMessage: ""})).to.equal("1 dump, last an unknown time: (no message)");
  });
});

describe("editors/vscode: Test Explorer grouping (Project / Packs / Workspace layers / System)", function () {
  const transpileConfig = JSON.parse(readFileSync(path.join(ROOT, "abap_transpile.json"), "utf8"));
  const layers = transpileLayers(transpileConfig);

  it("reads abap_transpile.json's own libs and input folders, not a hardcoded list", () => {
    expect(layers.inputFolders).to.deep.equal(["src", "test", "gen"]);
    const names = layers.libs.map((l) => l.name).sort();
    expect(names).to.deep.equal(
      ["abapgit", "ajson", "express-icf-shim", "open-abap-apc", "open-abap-core", "open-abap-gui", "open-abap-odata"].sort());
    expect(layers.libs.find((l) => l.name === "open-abap-core")).to.deep.equal(
      {name: "open-abap-core", folder: ".local/lars/open-abap-core"});
  });

  it("classifies a project file under src/ as Project, with no sub-node of its own", () => {
    const abs = path.join(ROOT, "src/webgui/zcl_osd_webgui.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, abs, layers)).to.deep.equal(
      {group: "project", subgroup: undefined, relInGroup: "src/webgui/zcl_osd_webgui.clas.testclasses.abap"});
  });

  it("classifies a project file under test/ the same way, gen/ included by the same rule though empty today", () => {
    const abs = path.join(ROOT, "test/unit/zcl_stg_gateway_test.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, abs, layers).group).to.equal("project");
    expect(classifyTestPath(ROOT, abs, layers).relInGroup).to.equal("test/unit/zcl_stg_gateway_test.clas.testclasses.abap");
  });

  it("classifies a packs/* file under Packs, one sub-node per pack", () => {
    const zvdb = path.join(ROOT, "packs/zvdb/src/zcl_vdb_100_anydb.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, zvdb, layers)).to.deep.equal(
      {group: "packs", subgroup: "zvdb", relInGroup: "src/zcl_vdb_100_anydb.clas.testclasses.abap"});
    const lsd = path.join(ROOT, "packs/lsd/src/zcl_lsd_media.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, lsd, layers).subgroup).to.equal("lsd");
  });

  it("classifies a .local/lars/<lib> file under System, named by the lib's own folder", () => {
    const core = path.join(ROOT, ".local/lars/open-abap-core/src/rtti/cl_abap_typedescr.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, core, layers)).to.deep.equal(
      {group: "system", subgroup: "open-abap-core", relInGroup: "src/rtti/cl_abap_typedescr.clas.testclasses.abap"});
    const json = path.join(ROOT, ".local/lars/open-abap-core/src/json/#ui2#cl_json.clas.testclasses.abap");
    expect(classifyTestPath(ROOT, json, layers).group).to.equal("system");
    expect(classifyTestPath(ROOT, json, layers).subgroup).to.equal("open-abap-core");
  });

  it("classifies under a running B0 workspace layer before System or Packs, even if it sits under .local", () => {
    const layerFolder = path.join(ROOT, ".local/lars/open-abap-core");
    const abs = path.join(layerFolder, "src/http/cl_http_server.clas.testclasses.abap");
    const workspaceLayers = [{folder: layerFolder}];
    expect(classifyTestPath(ROOT, abs, layers, workspaceLayers)).to.deep.equal(
      {group: "workspace", subgroup: "open-abap-core", relInGroup: "src/http/cl_http_server.clas.testclasses.abap"});
  });

  it("falls back to Project for a path outside every known root", () => {
    const abs = path.join(ROOT, "docs/vscode-extension.md");
    expect(classifyTestPath(ROOT, abs, layers).group).to.equal("project");
  });

  it("sub-groups by the directory under src/ or test/ once package.xml is not there to ask", () => {
    expect(packageOf("src/rtti/cl_abap_typedescr.clas.testclasses.abap")).to.equal("rtti");
    expect(packageOf("test/adbc/zcl_adbc_test.clas.testclasses.abap")).to.equal("adbc");
    expect(packageOf("src/json/#ui2#cl_json.clas.testclasses.abap")).to.equal("json");
    // a file sitting directly in a content root, no directory of its own
    expect(packageOf("test/cl_http_client.clas.testclasses.abap")).to.equal(undefined);
  });

  it("prefers the nearest package.xml directory over the src/ guess when one is known", () => {
    const dirs = packageDirsFrom(["package.xml", "a/package.xml", "a/b/package.xml"]);
    expect(dirs).to.deep.equal(["", "a", "a/b"]);
    expect(packageOf("a/b/c/zcl_x.clas.testclasses.abap", dirs)).to.equal("a/b");
    expect(packageOf("a/zcl_y.clas.testclasses.abap", dirs)).to.equal("a");
    // a root package.xml alone: everything below it is the root package, i.e. no sub-node
    expect(packageOf("zcl_z.clas.testclasses.abap", packageDirsFrom(["package.xml"]))).to.equal(undefined);
  });

  it("only splits a group into packages once it is bigger than the ~15 the task named", () => {
    expect(PACKAGE_SPLIT_THRESHOLD).to.equal(15);
    expect(needsPackageSplit(15)).to.equal(false);
    expect(needsPackageSplit(16)).to.equal(true);
    // measured in this tree: open-abap-core's own test classes clear it, a single pack does not
    const coreCount = 62;
    const packCount = 1;
    expect(needsPackageSplit(coreCount)).to.equal(true);
    expect(needsPackageSplit(packCount)).to.equal(false);
  });

  it("finds FOR TESTING in a real testclasses include, case-insensitively", () => {
    const real = readFileSync(path.join(ROOT, "test/unit/zcl_stg_gateway_test.clas.testclasses.abap"), "utf8");
    expect(hasTestMethods(real)).to.equal(true);
    expect(hasTestMethods("class ltcl_x definition for testing.\nendclass.")).to.equal(true);
  });

  it("skips a testclasses include with no FOR TESTING at all, the cheap filter done before any server round trip", () => {
    expect(hasTestMethods("CLASS ltcl_empty DEFINITION.\nENDCLASS.\n")).to.equal(false);
    expect(hasTestMethods("")).to.equal(false);
    expect(hasTestMethods(undefined)).to.equal(false);
  });
});
