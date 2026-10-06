import {expect} from "chai";
import express from "express";
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {box, answerOf} from "./helpers/destination.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {remoteForTest} from "./helpers/adt-remote.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {readRequestXML, attributeValue} from "../tools/adt-request-xml.mjs";

const NAME = "ZCL_INCLUDE_PARITY";
const base = "/sap/bc/adt/oo/classes/" + NAME.toLowerCase();
const ccau = NAME.padEnd(30, "=") + "CCAU";
const missingMessage = ccau + " does not have any inactive version";
const templates = {
  definitions: '*"* use this source file for any type of declarations (class\r\n*"* definitions, interfaces or type declarations) you need for\r\n*"* components in the private section\r\n',
  macros: '*"* use this source file for any macro definitions you need\r\n*"* in the implementation part of the class\r\n',
  implementations: '*"* use this source file for the definition and implementation of\r\n*"* local helper classes, interface definitions and type\r\n*"* declarations\r\n',
};
const roots = {
  "oo/classes": [NAME, "http://www.sap.com/adt/oo/classes", "abapClass"],
  "oo/interfaces": ["ZIF_INCLUDE_PARITY", "http://www.sap.com/adt/oo/interfaces", "abapInterface"],
  "programs/programs": ["ZINCLUDE_PARITY", "http://www.sap.com/adt/programs/programs", "abapProgram"],
  "programs/includes": ["ZINCLUDE_PART", "http://www.sap.com/adt/programs/includes", "abapInclude"],
  "ddic/ddl/sources": ["ZINCLUDE_DDL", "http://www.sap.com/adt/ddic/ddlsources", "ddlSource"],
  "ddic/srvd/sources": ["ZINCLUDE_SRVD", "http://www.sap.com/adt/ddic/srvd", "serviceDefinition"],
};
function exception(r, status, type, message, properties) {
  expect(r.status, r.body).to.equal(status);
  expect(r.type).to.equal("application/xml; charset=utf-8");
  const xml = readRequestXML(r.body).elements;
  const named = name => xml.find(e => e.local === name);
  expect(attributeValue(named("namespace"), "", "id")).to.equal("com.sap.adt");
  expect(attributeValue(named("type"), "", "id")).to.equal(type);
  expect(named("message").text).to.equal(message);
  expect(Object.fromEntries(xml.filter(e => e.local === "entry").map(e => [attributeValue(e, "", "key"), e.text]))).to.deep.equal(properties);
}
const t100 = {"T100KEY-ID": "ED", "T100KEY-NO": "170", "T100KEY-V1": ccau};

describe("ADT measured include and object POST parity", function () {
  this.timeout(120000);
  for (const mode of ["Node", "ABAP"]) describe(mode, function () {
    let root, store, server, token, cookie, remote;
    before(async () => {
      if (mode === "ABAP" && process.env.OSD_ADT_ONE_RUNTIME === "1") remote = await remoteForTest();
    });
    after(async () => { await remote?.stop(); });
    const file = () => join(root, "src/" + NAME.toLowerCase() + ".clas.testclasses.abap");
    const call = async (path, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {...options,
        headers: {cookie, "x-csrf-token": token, "x-sap-adt-sessiontype": "stateful", ...options.headers}});
      return {status: response.status, type: response.headers.get("content-type"), location: response.headers.get("location"), body: await response.text()};
    };
    const lock = async () => {
      const r = await call(base + "?_action=LOCK", {method: "POST"});
      expect(r.status, r.body).to.equal(200);
      return r.body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)[1];
    };
    beforeEach(async () => {
      root = mkdtempSync(join(tmpdir(), "osd-include-parity-"));
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
      writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}}));
      const fixtures = {
        [NAME.toLowerCase() + ".clas.abap"]: `CLASS ${NAME} DEFINITION. ENDCLASS. CLASS ${NAME} IMPLEMENTATION. ENDCLASS.`,
        "zif_include_parity.intf.abap": "INTERFACE zif_include_parity. ENDINTERFACE.",
        "zinclude_parity.prog.abap": "REPORT zinclude_parity.",
        "zinclude_part.prog.abap": "DATA value TYPE i.",
        "zinclude_ddl.ddls.asddls": "define view zinclude_ddl as select from dummy { key value }",
        "zinclude_srvd.srvd.srvdsrv": "define service zinclude_srvd { expose zinclude_ddl; }",
      };
      for (const [name, source] of Object.entries(fixtures)) writeFileSync(join(root, "src", name), source);
      store = new ObjectStore({root, libs: []});
      const app = express();
      app.set("etag", false);
      app.use(express.raw({type: "*/*"}));
      app.use(adtRouter({store, data: {}, watch: false, logMisses: false, transpileOnActivate: false,
        abap: mode === "ABAP" ? (remote ? abapRunner({remote}) : await adtAbap()) : undefined}).router);
      server = await new Promise(resolve => {const s = app.listen(0, "127.0.0.1", () => resolve(s));});
      const response = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/core/discovery`,
        {method: "HEAD", headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
      token = response.headers.get("x-csrf-token");
      cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    });
    afterEach(async () => {
      await call("/sap/public/bc/icf/logoff");
      await new Promise(resolve => server.close(resolve));
      rmSync(root, {recursive: true, force: true});
    });
    it("missing testclasses GET carries ED/170, while source/main is a plain resource miss", async () => {
      exception(await call(base + "/includes/testclasses"), 404, "ExceptionResourceNotFound", missingMessage, t100);
      expect(await call(base + "/includes/testclasses/source/main")).to.include({status: 404,
        type: "text/plain; charset=utf-8", body: "No suitable resource found"});
    });
    it("missing testclasses PUT fails without creating a file; POST creates it before SAVE", async () => {
      const handle = await lock();
      const target = base + "/includes/testclasses?lockHandle=" + handle;
      exception(await call(target, {method: "PUT", body: "* tests\n"}), 500, "ExceptionResourceSaveFailure", missingMessage, t100);
      expect(existsSync(file())).to.equal(false);
      const create = await call(base + "/includes?lockHandle=" + handle, {method: "POST",
        headers: {"content-type": "application/vnd.sap.adt.oo.classincludes+xml"},
        body: '<class:abapClassInclude xmlns:class="http://www.sap.com/adt/oo/classes" class:includeType="testclasses"/>'});
      expect(create).to.deep.equal({status: 201, type: null, body: "", location: base + "/includes/testclasses"});
      expect(await call(target, {method: "PUT", body: "* tests\n"})).to.include({status: 200, type: null, body: ""});
      expect(await call(base + "/includes/testclasses")).to.include({status: 200, type: "text/plain; charset=utf-8", body: "* tests\n"});
      expect(await call(base + "/includes/testclasses/source/main")).to.include({status: 200, body: "* tests\n"});
    });
    it("standard includes return exact generated comments, and still accept writes", async () => {
      const handle = await lock();
      for (const [include, template] of Object.entries(templates)) {
        expect(await call(base + "/includes/" + include)).to.include({status: 200, type: "text/plain; charset=utf-8", body: template});
        expect(await call(base + "/includes/" + include + "?lockHandle=" + handle, {method: "PUT", headers: {"if-match": (await import("../tools/adt-entity.mjs")).entityTag(template)}, body: "* changed\n"})).to.include({status: 200, body: ""});
        expect(await call(base + "/includes/" + include)).to.include({status: 200, body: "* changed\n"});
      }
    });
    it("query-less object POST validates the object XML and takes no lock", async () => {
      for (const [collection, [name, uri, element]] of Object.entries(roots)) {
        for (const [body, headers, xmlPath, offset] of [[undefined, {}, "", "0 "], ["", {"content-type": "application/xml"}, "", "0 "], ["<x/>", {"content-type": "application/xml"}, "x(1)", "4 "]]) {
          const message = `System expected the element '{${uri}}${element}'`;
          exception(await call(`/sap/bc/adt/${collection}/${name.toLowerCase()}`, {method: "POST", body, headers}),
            400, "ExceptionInvalidData", message, {XML_PATH: xmlPath, XML_OFFSET: offset,
              "T100KEY-ID": "00", "T100KEY-NO": "001", "T100KEY-V1": message.slice(0, 48), "T100KEY-V2": message.slice(48)});
        }
      }
      const response = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/core/discovery`,
        {method: "HEAD", headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
      const secondCookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
      expect(await call(base + "?_action=LOCK", {method: "POST", headers: {cookie: secondCookie, "x-csrf-token": response.headers.get("x-csrf-token")}})).to.include({status: 200});
      await call("/sap/public/bc/icf/logoff", {headers: {cookie: secondCookie}});
    });
    it("the non-ADT store still creates testclasses implicitly", async () => {
      expect(existsSync(file())).to.equal(false);
      const signature = {exporting: Object.fromEntries(Object.entries({IV_COMMAND: "WRITE", IV_TYPE: "CLAS", IV_NAME: NAME,
        IV_INCLUDE: "testclasses", IV_SOURCE: "* dev API tests\n"}).map(([key, value]) => [key, box(value)])),
        importing: {EV_ERROR: box(""), EV_FILE: box(""), EV_SOURCE: box("")}, tables: {}};
      await new StoreDestination({store}).call("ZOSD_STORE", signature);
      expect(answerOf(signature).EV_ERROR).to.equal("");
      expect(existsSync(file())).to.equal(true);
      expect(await call(base + "/includes/testclasses")).to.include({status: 200, body: "* dev API tests\n"});
    });
  });
});
