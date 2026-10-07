import {expect} from "chai";
import express from "express";
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "../tools/osd-build.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {activationJournal} from "../tools/osd-activation-journal.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {requestElements, descendantsOf, attributeValue, namespaces} from "../tools/adt-request-xml.mjs";
import {unitValueText} from "../tools/osd-unit-value.mjs";
import {shipsTestPath} from "../scripts/build-vsix.mjs";
import {UnitRun} from "../tools/osd-unit.mjs";

const NAME = "ZCL_UNIT_FORMAT";
const fixture = fileURLToPath(new URL("./fixtures/aunit-types/", import.meta.url));
const box = (value = "") => ({get: () => value});
const outputBox = () => ({get() {return this.value;}, set(value) {this.value = value;}});
// Independent, verbatim protocol facts. Declaration order deliberately differs.
const canon = [
  ["C_TXT", "C_Txt", "-2", "-1"],
  ["DECF", "Decf", "2", "-1.5"],
  ["F_FLT", "F_Flt", "2.0000000000000000E+00", "-1.5000000000000000E+00"],
  ["INT8", "Int8", "7", "7-"],
  ["I_NEG", "I_Neg", "5", "1-"],
  ["I_POS", "I_Pos", "4-", "3"],
  ["I_ZERO", "I_Zero", "1", "0"],
  ["N_NUM", "N_Num", "0034", "0012"],
  ["P_DEC", "P_Dec", " 2.25 ", " 1.50-"],
  ["S_TXT", "S_Txt", "-2", "-1"],
];

describe("ABAP Unit per-type SAP comparison canon", function () {
  this.timeout(180000);
  let root, store, server, origin, token, cookie, generation;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "aunit-types-"));
    cpSync(fixture, join(root, "src"), {recursive: true});
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
    generation = (await build({root, generators: false})).hash;
    store = new ObjectStore({root, build: {generators: false}});
    activationJournal(store).recordGeneration(generation);
    const app = express();
    app.use(adtRouter({store, data: {}, watch: false, logMisses: false}).router);
    server = await new Promise(resolve => {const s = app.listen(0, "127.0.0.1", () => resolve(s));});
    origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/sap/bc/adt/core/discovery`, {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = response.headers.get("x-csrf-token");
    cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  });
  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (root) rmSync(root, {recursive: true, force: true});
  });

  it("preserves unknown text, textual minus and zeros; keeps the fixture out of shipped seeds", () => {
    for (const value of ["-1", "-0", "-1.50", "0012", "text  ", ""]) {
      expect(unitValueText(value)).to.equal(value);
      expect(unitValueText(value, {typeKind: "?", value: "42"})).to.equal(value);
    }
    expect(unitValueText("-1", {typeKind: "C"})).to.equal("-1");
    expect(unitValueText("-0", {typeKind: "g"})).to.equal("-0");
    expect(unitValueText("-9007199254740993", {typeKind: "8"})).to.equal("9007199254740993-");
    expect(unitValueText("-1.5", {typeKind: "P", decimals: 2})).to.equal(" 1.50-");
    expect(unitValueText("2.25", {typeKind: "P", decimals: 2})).to.equal(" 2.25 ");
    expect(unitValueText("-9999999999999.99", {typeKind: "P", decimals: 2}))
      .to.equal(" 9999999999999.99-");
    expect(unitValueText("2.00", {typeKind: "e", value: "2"})).to.equal("2");
    for (const suffix of ["abap", "testclasses.abap"]) {
      expect(shipsTestPath(`fixtures/aunit-types/zcl_unit_format.clas.${suffix}`)).to.equal(false);
    }
  });

  it("the detached runner retains each operand's RTTI and packed decimals before projection", async () => {
    const run = await new UnitRun(store).runDetached("CLAS", NAME);
    const kinds = {I_NEG: "I", I_ZERO: "I", I_POS: "I", P_DEC: "P", F_FLT: "F",
      DECF: "e", C_TXT: "C", S_TXT: "g", N_NUM: "N", INT8: "8"};
    for (const method of run.testClasses[0].testMethods) {
      const alert = method.alerts[0];
      expect(alert.kind, method.name).to.equal("failedAssertion");
      expect(alert.assertion.method, method.name).to.equal("ASSERT_EQUALS");
      for (const side of ["expected", "actual"]) {
        expect(alert.assertion[side], `${method.name} ${side}`).to.include({
          typeKind: kinds[method.name], decimals: method.name === "P_DEC" ? 2 : 0,
        });
      }
    }
    expect(run.testClasses[0].testMethods.find(m => m.name === "I_NEG").alerts[0].actual).to.equal("-1");
  });

  it("STORE RUN_TESTS carries exact expected/actual and comparison details for all ten methods", async () => {
    const signature = {exporting: {IV_COMMAND: box("RUN_TESTS"), IV_JSON: box(JSON.stringify({
      targets: [{type: "CLAS", name: NAME}], expected_generation: generation,
    }))}, importing: {EV_JSON: outputBox(), EV_ERROR: outputBox()}};
    await new StoreDestination({store}).call("ZOSD_STORE", signature);
    expect(signature.importing.EV_ERROR.get()).to.equal("");
    const result = JSON.parse(signature.importing.EV_JSON.get());
    expect(result.state).to.equal("ran");
    expect(result.generation_id).to.equal(generation);
    expect(result.counts).to.deep.equal({classes: 1, methods: 10, pass: 0, fail: 10, error: 0, skipped: 0});
    const methods = result.classes[0].methods;
    expect(methods.map(m => m.name).sort()).to.deep.equal(canon.map(c => c[0]));
    for (const [name, , expected, actual] of canon) {
      const method = methods.find(m => m.name === name);
      expect(method.verdict, name).to.equal("fail");
      expect(method.alerts, name).to.have.length(1);
      expect(method.alerts[0], name).to.include({kind: "failedAssertion", expected, actual});
      expect(method.alerts[0].details.slice(0, 2), name).to.deep.equal([`Expected [${expected}]`, `Actual [${actual}]`]);
    }
  });

  it("ADT XML has exact nested details, float siblings, cased titles and byte-order methods", async () => {
    const response = await fetch(`${origin}/sap/bc/adt/abapunit/testruns`, {method: "POST",
      headers: {cookie, "x-csrf-token": token, "content-type": "application/vnd.sap.adt.abapunit.testruns.config.v4+xml",
        accept: "application/vnd.sap.adt.abapunit.testruns.result.v2+xml"},
      body: `<aunit:runConfiguration xmlns:aunit="${namespaces.aunit}" xmlns:adtcore="${namespaces.adtcore}">
        <options><uriType value="semantic"/><withNavigationUri enabled="true"/></options>
        <adtcore:objectReferences><adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/${NAME.toLowerCase()}"/></adtcore:objectReferences>
      </aunit:runConfiguration>`});
    expect(response.status).to.equal(200);
    const elements = requestElements(await response.text()).map((e, index) => ({...e, id: index + 1}));
    const below = (e, local) => descendantsOf(elements, e.id).filter(child => child.uri === "" && child.local === local);
    const attr = (e, name, uri = "") => attributeValue(e, uri, name);
    const methods = elements.filter(e => e.local === "testMethod");
    expect(methods.map(m => attr(m, "name", namespaces.adtcore))).to.deep.equal(canon.map(c => c[0]));
    for (const [index, [name, cased, expected, actual]] of canon.entries()) {
      const alerts = below(methods[index], "alert");
      expect(alerts, name).to.have.length(1);
      const alert = alerts[0];
      expect(below(alert, "title")[0].text, name).to.equal(`Critical Assertion Error: '${cased}: ASSERT_EQUALS'`);
      const details = below(alert, "detail");
      const values = name === "F_FLT" ? [`Expected [${expected}]`, `Actual [${actual}]`]
        : [`Expected [${expected}] Actual [${actual}]`];
      expect(details.map(d => attr(d, "text")), name).to.deep.equal(["Different values", ...values,
        `Test 'LTCL_VALUES->${name}' in Main Program '${NAME.padEnd(30, "=")}CP'`]);
      const nested = below(details[0], "detail");
      expect(nested.map(d => attr(d, "text")), name).to.deep.equal(values);
      expect(new Set(nested.map(d => d.parent)).size, "value details are siblings").to.equal(1);
    }
  });
});
