import {expect} from "chai";
import express from "express";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "../tools/osd-build.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {activationJournal} from "../tools/osd-activation-journal.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {requestElements, descendantsOf, attributeValue, namespaces} from "../tools/adt-request-xml.mjs";
import {shipsTestPath} from "../scripts/build-vsix.mjs";

const fixture = fileURLToPath(new URL("./fixtures/aunit-x2/", import.meta.url));
const NAME = "ZCL_OSD_X2_DEMO";
const BASE = `/sap/bc/adt/oo/classes/${NAME.toLowerCase()}`;
const MAIN = `${NAME.toLowerCase()}.clas.abap`;
const TESTS = `${NAME.toLowerCase()}.clas.testclasses.abap`;
const expected = JSON.parse(readFileSync(join(fixture, "expected.json"), "utf8"));
const box = (value = "") => ({get: () => value, set: next => {value = next;}});

// Both adapters return only the agreed fields. Values remain verbatim; in
// particular, neither adapter reformats the negative sign or repairs a line.
function storeNormative(result) {
  return {state: result.state, counts: result.counts, classes: result.classes.map(c => ({
    name: c.name, state: c.state, methods: c.methods.map(m => ({name: m.name, verdict: m.verdict,
      alerts: m.alerts.map(a => ({kind: a.kind, expected: a.expected, actual: a.actual,
        line: a.stack.find(s => s.type === "CLAS" && s.name === NAME && s.include === "testclasses")?.line})),
    })),
  }))};
}

function xmlNormative(xml) {
  const elements = requestElements(xml).map((e, index) => ({...e, id: index + 1}));
  const below = (e, local) => descendantsOf(elements, e.id).filter(child => child.uri === "" && child.local === local);
  const attr = (e, local, uri = "") => attributeValue(e, uri, local);
  expect(elements[0].uri).to.equal(namespaces.aunit);
  expect(elements[0].local).to.equal("runResult");
  const classes = elements.filter(e => e.uri === "" && e.local === "testClass").map(c => ({
    name: attr(c, "name", namespaces.adtcore),
    state: elements.some(e => e.local === "alerts" && e.parent === c.id && below(e, "alert").length) ? "error" : "ok",
    methods: below(c, "testMethod").map(m => {
      const alerts = below(m, "alert").map(a => {
        const comparison = below(a, "detail").map(d => attr(d, "text"))
          .map(text => /^Expected \[([\s\S]*)\] Actual \[([\s\S]*)\]$/.exec(text)).find(Boolean);
        const stack = below(a, "stackEntry").find(s => attr(s, "type", namespaces.adtcore) === "CLAS/OCN/testclasses"
          && attr(s, "name", namespaces.adtcore) === NAME);
        const line = stack && /Line: <(\d+)>/.exec(attr(stack, "description", namespaces.adtcore));
        return {kind: attr(a, "kind"), expected: comparison?.[1], actual: comparison?.[2],
          line: line ? Number(line[1]) : undefined};
      });
      return {name: attr(m, "name", namespaces.adtcore),
        verdict: !alerts.length ? "pass" : alerts.some(a => a.kind !== "failedAssertion") ? "error" : "fail", alerts};
    }),
  }));
  const methods = classes.flatMap(c => c.methods);
  return {state: "ran", counts: {classes: classes.length, methods: methods.length,
    ...Object.fromEntries(["pass", "fail", "error", "skipped"].map(v => [v, methods.filter(m => m.verdict === v).length]))}, classes};
}

describe("X2: published ABAP Unit conformance against synthetic SAP results", function () {
  this.timeout(180000);
  let root, server, origin, token, cookie, store, destination;
  const main = readFileSync(join(fixture, MAIN), "utf8");
  before(() => {
    root = mkdtempSync(join(tmpdir(), "aunit-x2-"));
    mkdirSync(join(root, "src"));
    cpSync(join(fixture, TESTS), join(root, "src", TESTS));
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "junction");
    mkdirSync(join(root, ".local/lars"), {recursive: true});
    symlinkSync(resolve(".local/lars/open-abap-core"), join(root, ".local/lars/open-abap-core"), "junction");
    mkdirSync(join(root, "test"));
    writeFileSync(join(root, "test/setup.mjs"), `import {SQLiteDatabaseClient} from '@abaplint/database-sqlite';
export async function setup(abap, schemas, insert) {
  const db = new SQLiteDatabaseClient(); abap.context.databaseConnections.DEFAULT = db;
  await db.connect(); await db.execute(schemas.sqlite); await db.execute(insert);
}`);
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({global: {files: "/src/**/*.*"}, syntax: {version: "OpenABAP"}, rules: {}}));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"], output_folder: "output",
      libs: [{folder: "/.local/lars/open-abap-core", exclude_filter: ["/src/tcp/"]}], write_source_map: true,
      options: {ignoreSyntaxCheck: false, addCommonJS: true, unknownTypes: "compileError",
        setup: {filename: "../test/setup.mjs", preFunction: "setup"}}}));
  });
  afterEach(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    server = undefined;
  });
  after(() => {if (root) rmSync(root, {recursive: true, force: true});});

  it("keeps the assertion at include line 7 and the fixture out of shipped seeds", () => {
    const tests = readFileSync(join(fixture, TESTS), "utf8");
    expect(tests.split("\n")).to.have.length(10);
    expect(tests.split("\n")[6]).to.equal(`    cl_abap_unit_assert=>assert_equals( act = ${NAME.toLowerCase()}=>add( a = 2 b = 3 ) exp = 5 msg = 'add' ).`);
    for (const file of [MAIN, TESTS, "sap-red.xml", "sap-green.xml"]) {
      expect(shipsTestPath(`fixtures/aunit-x2/${file}`)).to.equal(false);
    }
  });

  for (const state of ["red", "green"]) it(`${state}: STORE, synthetic SAP XML and OSG ADT XML agree`, async () => {
    writeFileSync(join(root, "src", MAIN), state === "red" ? main : main.replace("rv_ = a - b.", "rv_ = a + b."));
    const built = await build({root, generators: false});
    store = new ObjectStore({root, build: {generators: false}});
    activationJournal(store).recordGeneration(built.hash);
    destination = new StoreDestination({store});
    const signature = {exporting: {IV_COMMAND: box("RUN_TESTS"), IV_JSON: box(JSON.stringify({
      targets: [{type: "CLAS", name: NAME}], expected_generation: built.hash,
    }))}, importing: {EV_JSON: box(), EV_ERROR: box()}};
    await destination.call("ZOSD_STORE", signature);
    expect(signature.importing.EV_ERROR.get()).to.equal("");
    const answer = JSON.parse(signature.importing.EV_JSON.get());
    expect(answer.generation_id).to.equal(built.hash);
    const osgStore = storeNormative(answer);
    const sapXML = xmlNormative(readFileSync(join(fixture, `sap-${state}.xml`), "utf8"));

    // Real ADT route and runner, without replacing store.unit or its result.
    const app = express();
    app.use(adtRouter({store, data: {}, watch: false, logMisses: false}).router);
    server = await new Promise(resolve => {const s = app.listen(0, "127.0.0.1", () => resolve(s));});
    origin = `http://127.0.0.1:${server.address().port}`;
    const discovery = await fetch(`${origin}/sap/bc/adt/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = discovery.headers.get("x-csrf-token");
    cookie = discovery.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const response = await fetch(`${origin}/sap/bc/adt/abapunit/testruns`, {method: "POST",
      headers: {cookie, "x-csrf-token": token, "content-type": "application/vnd.sap.adt.abapunit.testruns.config.v4+xml",
        accept: "application/vnd.sap.adt.abapunit.testruns.result.v2+xml, application/xml"},
      body: `<aunit:runConfiguration xmlns:aunit="${namespaces.aunit}" xmlns:adtcore="${namespaces.adtcore}">
        <options><uriType value="semantic"/><withNavigationUri enabled="true"/>
          <testDeterminationStrategy sameProgram="true" assignedTests="false"/>
          <testRiskLevels harmless="true" dangerous="true" critical="true"/>
          <testDurations short="true" medium="true" long="true"/><withCoverage enabled="false"/></options>
        <adtcore:objectReferences><adtcore:objectReference adtcore:uri="${BASE}"/></adtcore:objectReferences>
      </aunit:runConfiguration>`});
    expect(response.status).to.equal(200);
    expect(response.headers.get("content-type")).to.equal("application/vnd.sap.adt.abapunit.testruns.result.v2+xml; charset=utf-8");
    const osgXML = xmlNormative(await response.text());
    console.log(`      X2 ${state} STORE: ${JSON.stringify(osgStore)}; ADT: ${JSON.stringify(osgXML)}`);
    expect(osgStore, "OSG STORE").to.deep.equal(expected[state]);
    expect(sapXML, "synthetic SAP XML").to.deep.equal(expected[state]);
    expect(osgXML, "OSG ADT XML").to.deep.equal(expected[state]);
  });
});
