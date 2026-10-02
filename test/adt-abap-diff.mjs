// Migration gate 1 for the ADT façade in ABAP (ADR 0007, slice 1): every
// route ZCL_OSD_ADT_ROUTER serves answers what the Node façade answers --
// status, content type, length, entity tag and body, byte for byte -- and
// every route it does not serve still reaches the Node façade unchanged.
//
// Two adtRouters over one store: one plain, one with the ABAP front
// (tools/adt-abap-front.mjs) running the transpiled handler under
// dialogStep, the way test/start.mjs mounts it inline. The front reports
// who served each request, so a route that silently fell through to Node
// cannot pass as ported.
import {expect} from "chai";
import express from "express";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {exceptionDocument} from "../tools/adt-documents.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const output = (file) => import(new URL(`../output/${file}`, import.meta.url).href);

// what the ABAP serves today; the gate grows with every route that moves
const PORTED = [
  ["GET", "/sap/bc/adt/core/http/systeminformation"],
  ["HEAD", "/sap/bc/adt/core/http/systeminformation"],
  ["GET", "/sap/bc/adt/compatibility/graph"],
  ["HEAD", "/sap/bc/adt/compatibility/graph"],
  // Express routing is case-insensitive and non-strict, and so is the table
  ["GET", "/sap/bc/adt/core/http/systeminformation/"],
  ["GET", "/SAP/BC/ADT/Compatibility/Graph"],
];

// still the Node façade's: the front must hand them over untouched
const DELEGATED = [
  ["GET", "/sap/bc/adt/discovery"],
  ["HEAD", "/sap/bc/adt/core/discovery"],
  // refused by the CSRF gate, which is still the Node session middleware's
  // and runs before the front: ABAP is not asked at all (slice 2 moves it)
  ["POST", "/sap/bc/adt/core/http/systeminformation", "nobody"],
  ["GET", "/sap/bc/adt/debugger/listeners"],
  ["GET", "/sap/bc/adt/packages/settings"],
  ["GET", "/sap/bc/adt/no/such/resource"],
  ["GET", "/sap/bc/adt/core/http/systeminformation/extra"],
];

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function call(server, method, path) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {method});
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    length: response.headers.get("content-length"),
    etag: response.headers.get("etag"),
    body: Buffer.from(await response.arrayBuffer()).toString("utf8"),
  };
}

describe("ADT façade in ABAP: gate 1 against the Node façade", function () {
  this.timeout(60000);
  let root;
  let shim;
  const servers = [];
  const served = [];

  const mount = async (options) => {
    const app = express();
    app.use(adtRouter({data: {}, logMisses: false, watch: false, ...options}).router);
    const server = await listen(app);
    servers.push(server);
    return server;
  };
  const run = (args) => dialogStep(() => shim.run({
    ...args,
    base: new abap.types.String().set(args.base),
  }), `ADT diff ${args.req.method} ${args.req.path}`);
  const withAbap = (options) => ({...options, abap: run,
    abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl}`)});

  before(async () => {
    ({cl_express_icf_shim: shim} = await output("cl_express_icf_shim.clas.mjs"));
    root = mkdtempSync(join(tmpdir(), "osd-adt-abap-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
  });

  after(async () => {
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });

  it("a ported route answers byte-equal, and ABAP is what answered it", async () => {
    const store = new ObjectStore({root, libs: []});
    const node = await mount({store});
    const abap = await mount(withAbap({store}));
    for (const [method, path] of PORTED) {
      served.length = 0;
      const expected = await call(node, method, path);
      const actual = await call(abap, method, path);
      expect(actual, `${method} ${path}`).to.deep.equal(expected);
      expect(served, `${method} ${path}`).to.deep.equal([`ABAP ${method} ${path}`]);
    }
  });

  it("a route ABAP does not serve reaches the Node façade unchanged", async () => {
    const store = new ObjectStore({root, libs: []});
    const node = await mount({store});
    const abap = await mount(withAbap({store}));
    for (const [method, path, who = "HOST"] of DELEGATED) {
      served.length = 0;
      const expected = await call(node, method, path);
      const actual = await call(abap, method, path);
      // none of these carries a time or a session value, so the body compares
      // whole (a feed carries its time, which is why none is listed); the
      // catch-all's 404 names the path, and so do both
      expect(actual, `${method} ${path}`).to.deep.equal(expected);
      expect(served, `${method} ${path}`).to.deep.equal(who === "nobody" ? [] : [`${who} ${method} ${path}`]);
    }
  });

  it("each façade instance answers its own identity, also when requests interleave", async () => {
    const store = new ObjectStore({root, libs: []});
    const identities = [
      {systemID: "OSX", userFullName: "Ann \"Q\" \\ Lee"},
      {systemID: "OSY", userName: "TESTER", client: "002", language: "DE"},
    ];
    const pairs = [];
    for (const identity of identities) {
      pairs.push([await mount({store, ...identity}), await mount(withAbap({store, ...identity}))]);
    }
    const path = "/sap/bc/adt/core/http/systeminformation";
    const answers = await Promise.all([...Array(4)].flatMap(() =>
      pairs.map(([node, abap]) => Promise.all([call(node, "GET", path), call(abap, "GET", path)]))));
    for (const [expected, actual] of answers) {
      expect(actual).to.deep.equal(expected);
    }
    expect(JSON.parse(answers[0][1].body).userFullName).to.equal("Ann \"Q\" \\ Lee");
    expect(JSON.parse(answers[1][1].body).systemID).to.equal("OSY");
  });

  it("the exception document is byte-equal to the Node façade's", async () => {
    const {zcx_osd_adt: zcx} = await output("zcx_osd_adt.clas.mjs");
    const text = (value) => new abap.types.String().set(value);
    const documentOf = async (status, type, message, namespace, properties = []) => {
      const table = (await new zcx().constructor_({})).properties.clone();
      for (const [key, value] of properties) {
        const row = table.appendInitial();
        row.get().name.set(key);
        row.get().value.set(value);
      }
      const error = await new zcx().constructor_({
        iv_status: new abap.types.Integer().set(status), iv_type: text(type), iv_message: text(message),
        ...(namespace === undefined ? {} : {iv_namespace: text(namespace)}),
        it_properties: table,
      });
      return (await error.document()).get();
    };
    const cases = [
      [404, "ExceptionResourceNotFound", "CLAS ZCL_NONE does not exist"],
      [500, "ExceptionInternalError", "boom <&> \"quoted\"", "org.open-steamgate.osd"],
      [403, "ExceptionResourceNoAccess", "User DEVELOPER is currently editing ZCL_X", undefined, [
        ["LONGTEXT", "ZCL_X is locked by another editing session of user DEVELOPER."],
        ["T100KEY-ID", "EU"], ["T100KEY-NO", "510"], ["T100KEY-V1", "DEVELOPER"], ["T100KEY-V2", "<ZCL_X & co>"],
      ]],
      [409, "ExceptionResourceIsModified", "änderung – geändert"],
    ];
    for (const [status, type, message, namespace, properties] of cases) {
      const expected = exceptionDocument(type, message, {
        ...(namespace === undefined ? {} : {namespace}),
        ...(properties === undefined ? {} : {properties}),
      });
      expect(await documentOf(status, type, message, namespace, properties), type).to.equal(expected);
    }
  });
});
