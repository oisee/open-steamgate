import {expect} from "chai";
import express from "express";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {unitResultDocument, frameUri, activationFailureDocument} from "../tools/adt-documents.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {requestElements, attributeValue, namespaces} from "../tools/adt-request-xml.mjs";

// Protocol facts measured on 2026-10-06; synthetic names and runner data.
const NAME = "ZCL_UNIT_SAMPLE";
const BASE = "/sap/bc/adt/oo/classes/zcl_unit_sample";
const CLASS = "LTCL_ADD";
const METHOD = "ADD_2_3";
const source = "* synthetic test include\nCLASS ltcl_add DEFINITION FOR TESTING. ENDCLASS.\n";
const run = () => ({
  program: {name: NAME, type: "CLAS/OC", objectType: "CLAS"},
  testClasses: [{name: CLASS, include: "testclasses", line: 2, column: 1,
    durationCategory: "short", riskLevel: "harmless", alerts: [], testMethods: [
      {name: "ADD_OK", executionTime: "0.000", alerts: []},
      {name: METHOD, executionTime: "0.000", line: 15, column: 3, alerts: [{
        kind: "failedAssertion", severity: "critical", title: "ASSERT_EQUALS",
        details: ["Expected [5]", "Actual [-1]", "Raised in add_2_3"],
        stack: [{uri: "src/zcl_unit_sample.clas.testclasses.abap", name: "testclasses, line 18", line: 18, column: 7}],
      }]},
    ]}],
});
const elements = xml => requestElements(xml);
const find = (xml, local) => elements(xml).filter(e => e.local === local);
const attrs = e => Object.fromEntries(e.attributes.map(a => [a.uri === namespaces.adtcore ? `adtcore:${a.local}` : a.local, a.value]));
const methodNavigation = `${BASE}/includes/testclasses#type=CLAS%2FOLD;name=${CLASS}${"%20".repeat(30 - CLASS.length)}${METHOD}`;

describe("ADT ABAP Unit result: SAP class URI contract", () => {
  it("declares adtcore on the semantic program and orders semantic methods alphabetically", () => {
    const input = run();
    const xml = unitResultDocument(input);
    expect(xml).to.contain('<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">');
    expect(xml).to.match(/<program\b[^>]*xmlns:adtcore="http:\/\/www.sap.com\/adt\/core"/);
    expect(attrs(find(xml, "program")[0])).to.deep.equal({
      "adtcore:name": NAME, "adtcore:type": "CLAS/OC", "adtcore:uri": BASE, uriType: "semantic",
    });
    expect(find(xml, "testMethod").map(e => attributeValue(e, namespaces.adtcore, "name")))
      .to.deep.equal([METHOD, "ADD_OK"]);
    expect(input.testClasses[0].testMethods.map(m => m.name)).to.deep.equal(["ADD_OK", METHOD]);
    expect(xml).not.to.contain("/source/main");
  });

  it("uses local class and padded method selectors, with SAP types", () => {
    const xml = unitResultDocument(run());
    expect(attrs(find(xml, "testClass")[0])).to.deep.equal({
      "adtcore:name": CLASS, "adtcore:uri": `${BASE}#testclass=${CLASS}`, "adtcore:type": "CLAS/OL",
      uriType: "semantic", navigationUri: `${BASE}/includes/testclasses#type=CLAS%2FOCL;name=${CLASS}`,
      durationCategory: "short", riskLevel: "harmless",
    });
    expect(attrs(find(xml, "testMethod").find(e => attributeValue(e, namespaces.adtcore, "name") === METHOD))).to.deep.equal({
      "adtcore:name": METHOD, "adtcore:uri": `${BASE}#testclass=${CLASS};testmethod=${METHOD}`, "adtcore:type": "CLAS/OLI",
      executionTime: "0", uriType: "semantic", navigationUri: methodNavigation, unit: "s",
    });
    const pass = xml.match(/<testMethod\b[^>]*adtcore:name="ADD_OK"[^>]*\/>/);
    expect(pass, "passing methods are self-closing, without alerts").not.to.equal(null);
  });

  it("nests comparison details, formats negative numbers, and names the test and class pool", () => {
    const xml = unitResultDocument(run());
    expect(attrs(find(xml, "alert")[0])).to.deep.equal({kind: "failedAssertion", severity: "critical"});
    expect(find(xml, "title")[0].text).to.equal("Critical Assertion Error: 'Add_2_3: ASSERT_EQUALS'");
    expect(xml).to.match(/<detail text="Different values">\s*<details>\s*<detail text="Expected \[5\] Actual \[1-\]"\/>\s*<\/details>\s*<\/detail>/);
    expect(find(xml, "detail").map(e => attributeValue(e, "", "text")))
      .to.deep.equal(["Different values", "Expected [5] Actual [1-]", `Test '${CLASS}->${METHOD}' in Main Program '${NAME.padEnd(30, "=")}CP'`]);
  });

  it("keeps custom assertion messages, other details, class alerts and unknown frames", () => {
    const input = run();
    const alert = input.testClasses[0].testMethods[1].alerts[0];
    alert.title = "custom <message> & value";
    alert.details.unshift("comparison context");
    alert.stack.push({uri: "helper.mjs", name: "unmapped", line: 9});
    input.testClasses[0].alerts.push({kind: "exception", title: "class teardown failed", details: ["original detail"], stack: []});
    const xml = unitResultDocument(input);
    expect(find(xml, "title").map(e => e.text)).to.include("Critical Assertion Error: 'Add_2_3: custom <message> & value'");
    expect(find(xml, "detail").map(e => attributeValue(e, "", "text"))).to.include.members(["comparison context", "original detail"]);
    expect(find(xml, "title").map(e => e.text)).to.include("class teardown failed");
    expect(attrs(find(xml, "stackEntry").at(-1))).to.include({"adtcore:uri": "helper.mjs", "adtcore:name": "unmapped"});
  });

  it("maps the runner's default comparison title and preserves fractional timing and string values", () => {
    const input = run();
    const method = input.testClasses[0].testMethods[1];
    method.executionTime = "0.125";
    method.alerts[0].title = "Unit test assertion failed";
    method.alerts[0].details = ["Expected [-2.5]", "Actual [value-with-hyphens]", "Raised in add_2_3"];
    const xml = unitResultDocument(input);
    expect(find(xml, "title")[0].text).to.equal("Critical Assertion Error: 'Add_2_3: ASSERT_EQUALS'");
    expect(attributeValue(find(xml, "testMethod")[0], "", "executionTime")).to.equal("0.125");
    expect(find(xml, "detail").map(e => attributeValue(e, "", "text")))
      .to.include("Expected [2.5-] Actual [value-with-hyphens]");
  });

  it("uses only a stack line fragment and describes the test include", () => {
    const xml = unitResultDocument(run());
    expect(attrs(find(xml, "stackEntry")[0])).to.deep.equal({
      "adtcore:uri": `${BASE}/includes/testclasses#start=18,0`, "adtcore:type": "CLAS/OCN/testclasses",
      "adtcore:name": NAME, "adtcore:description": `Include: <${NAME.padEnd(30, "=")}CCAU> Line: <18> (${METHOD})`,
    });
    expect(xml).to.contain(`Include: &lt;${NAME.padEnd(30, "=")}CCAU&gt; Line: &lt;18&gt; (${METHOD})`);
  });

  it("removes class/method navigation and types together, retaining program and stack types", () => {
    const xml = unitResultDocument(run(), {withNavigationUri: false});
    for (const e of [...find(xml, "testClass"), ...find(xml, "testMethod")]) {
      expect(attributeValue(e, "", "navigationUri")).to.equal(undefined);
      expect(attributeValue(e, namespaces.adtcore, "type")).to.equal(undefined);
      expect(attributeValue(e, "", "uriType")).to.equal("semantic");
    }
    expect(attributeValue(find(xml, "program")[0], namespaces.adtcore, "type")).to.equal("CLAS/OC");
    expect(attributeValue(find(xml, "stackEntry")[0], namespaces.adtcore, "type")).to.equal("CLAS/OCN/testclasses");
  });

  it("maps every class include frame to its base resource, keeping program frame paths", () => {
    for (const [suffix, include] of Object.entries({locals_def: "definitions", locals_imp: "implementations", macros: "macros", testclasses: "testclasses"})) {
      expect(frameUri(`src/zcl_unit_sample.clas.${suffix}.abap`, 18, 0)).to.equal(`${BASE}/includes/${include}#start=18,0`);
    }
    expect(frameUri("zcl_unit_sample.clas.abap", 3, 0)).to.equal(`${BASE}#start=3,0`);
    expect(frameUri("zunit_sample.prog.abap", 3, 2)).to.equal("/sap/bc/adt/programs/programs/zunit_sample/source/main#start=3,2");
    expect(activationFailureDocument([{type: "CLAS", name: NAME, issues: [{message: "bad", file: "zcl_unit_sample.clas.testclasses.abap", line: 3, column: 0}]}]))
      .to.contain(`href="${BASE}/includes/testclasses/source/main#start=3,0"`);
  });

  it("retains program result rendering and honours its navigation switch", () => {
    const input = run();
    input.program = {name: "ZUNIT_SAMPLE", type: "PROG/P", objectType: "PROG"};
    const xml = unitResultDocument(input);
    expect(attributeValue(find(xml, "program")[0], namespaces.adtcore, "uri")).to.equal("/sap/bc/adt/programs/programs/zunit_sample");
    expect(attributeValue(find(xml, "testMethod")[0], "", "navigationUri")).to.contain("/source/main#start=");
    expect(find(xml, "testMethod")[0].attributes.some(a => a.local === "uriType")).to.equal(false);
    expect(unitResultDocument(input, {withNavigationUri: false})).not.to.contain("navigationUri=");
  });
});

describe("ADT ABAP Unit result: HTTP options and navigation source", () => {
  let root, server, origin, token, cookie;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "e2-unit-result-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    writeFileSync(join(root, "src/zcl_unit_sample.clas.abap"), "CLASS zcl_unit_sample DEFINITION. ENDCLASS.\nCLASS zcl_unit_sample IMPLEMENTATION. ENDCLASS.\n");
    writeFileSync(join(root, "src/zcl_unit_sample.clas.testclasses.abap"), source);
    const store = new ObjectStore({root, libs: []});
    // The runner tree is fixed; requests still traverse the real XML/options
    // reader, result renderer, object mapping and source store.
    store.unit = async () => ({classes: () => ({object: {type: "CLAS", name: NAME}, classes: []}), runDetached: async () => run()});
    const app = express();
    app.use(adtRouter({store, data: {}, watch: false, logMisses: false}).router);
    server = await new Promise(resolve => {const listening = app.listen(0, "127.0.0.1", () => resolve(listening));});
    origin = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${origin}/sap/bc/adt/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = res.headers.get("x-csrf-token");
    cookie = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });
  const post = (path, options) => fetch(`${origin}/sap/bc/adt/abapunit/testruns${path}`, {
    method: "POST", headers: {cookie, "x-csrf-token": token, "content-type": "application/xml"},
    body: `<u:runConfiguration xmlns:u="${namespaces.aunit}" xmlns:c="${namespaces.adtcore}">
      <options><uriType value="technical"/>${options}</options>
      <c:objectReferences><c:objectReference c:uri="${BASE}"/></c:objectReferences></u:runConfiguration>`,
  });
  for (const path of ["", "/evaluation"]) {
    for (const enabled of [true, false]) it(`${path || "run"} honours withNavigationUri=${enabled} and ignores requested technical URIs`, async () => {
      const res = await post(path, `<withNavigationUri enabled="${enabled}"/>`);
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.equal(`application/vnd.sap.adt.abapunit.testruns.${path ? "evaluation.result" : "result"}.v2+xml; charset=utf-8`);
      const xml = await res.text();
      for (const e of [...find(xml, "testClass"), ...find(xml, "testMethod")]) {
        expect(attributeValue(e, "", "uriType")).to.equal("semantic");
        expect(attributeValue(e, "", "navigationUri") !== undefined).to.equal(enabled);
        expect(attributeValue(e, namespaces.adtcore, "type") !== undefined).to.equal(enabled);
      }
      expect(attributeValue(find(xml, "stackEntry")[0], namespaces.adtcore, "type")).to.equal("CLAS/OCN/testclasses");
    });
  }
  it("defaults navigation on and ignores a similarly named foreign option", async () => {
    const res = await post("", '<foreign:withNavigationUri xmlns:foreign="urn:foreign" enabled="false"/>');
    expect(res.status).to.equal(200);
    expect(attributeValue(find(await res.text(), "testMethod")[0], "", "navigationUri")).to.equal(methodNavigation);
  });
  it("GET of each result navigation target reads the actual test include, including client-side fragments", async () => {
    const xml = await (await post("", '<withNavigationUri enabled="true"/>')).text();
    const uris = [BASE + "/includes/testclasses", ...find(xml, "testClass").map(e => attributeValue(e, "", "navigationUri")),
      ...find(xml, "testMethod").map(e => attributeValue(e, "", "navigationUri")),
      ...find(xml, "stackEntry").map(e => attributeValue(e, namespaces.adtcore, "uri"))];
    for (const uri of uris) {
      expect(new URL(uri, origin).pathname).to.equal(BASE + "/includes/testclasses");
      const res = await fetch(new URL(uri, origin), {headers: {accept: "text/plain"}});
      expect(res.status).to.equal(200);
      expect(res.headers.get("content-type")).to.equal("text/plain; charset=utf-8");
      expect(await res.text()).to.equal(source);
    }
  });
});
