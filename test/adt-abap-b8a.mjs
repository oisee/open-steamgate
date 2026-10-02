// B8a gate: real Node and ABAP fronts over one store, with ETags disabled
// as in production. A route falling back to Node must fail this gate.
import {expect} from "chai";
import express from "express";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const TYPES = "/sap/bc/adt/repository/typestructure";
const PARSER = "/sap/bc/adt/ddic/tables/parser/info";
const accepts = [undefined, "*/*", "application/vnd.sap.as+xml", "dataname=com.sap.adt.RepositoryTypeList",
  "dataname=Custom_09.Name", "dataname=.Leading", "dataname=123", "dataname=first; dataname=second",
  "dataname=one-two", "dataname=one/two", "dataname=one two", 'dataname="quoted"', "dataname=",
  "DATANAME=Upper", "dataname = spaced", "dataname=\u00e9", "xdataname=embedded", "dataname=one\u00e9two"];
const at = (side) => `http://127.0.0.1:${side.server.address().port}`;

async function wire(side, path, options = {}) {
  const res = await fetch(at(side) + path, options);
  const headers = Object.fromEntries(["content-type", "content-length", "etag", "location"].map((h) => [h, res.headers.get(h)]));
  // Each facade mints its own session; compare cookie order/attributes after
  // checking the random identifier's format and the two cookies' agreement.
  const cookies = res.headers.getSetCookie();
  const ids = cookies.map((c) => /^[^=]+=([0-9a-f]{24});/.exec(c)?.[1]);
  if (cookies.length) {
    expect(ids.every((id) => id !== undefined)).to.equal(true);
    expect(new Set(ids).size).to.equal(1);
  }
  headers["set-cookie"] = cookies.map((c) => c.replace(/=([0-9a-f]{24});/, "=<session>;"));
  expect(res.headers.get("x-osd-miss")).to.equal(null);
  return {status: res.status, headers, body: Buffer.from(await res.arrayBuffer())};
}

describe("ADT B8a: typestructure and parser/info Node diff", function () {
  this.timeout(60000);
  let root, node, ported;
  const served = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-b8a-"));
    const store = new ObjectStore({root, libs: []});
    const mount = async (isAbap) => {
      const app = express();
      app.set("etag", false);
      app.use(express.raw({type: "*/*"}));
      const facade = adtRouter({store, data: {}, watch: false, logMisses: false,
        ...(isAbap ? {abap: abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep}),
          abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl}`)} : {})});
      app.use(facade.router);
      const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      const warm = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/b8a/warmup`, {headers: {"x-csrf-token": "fetch"}});
      await warm.arrayBuffer();
      return {server, facade, auth: {cookie: warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
        "x-csrf-token": warm.headers.get("x-csrf-token")}};
    };
    node = await mount(false);
    ported = await mount(true);
  });
  after(async () => {
    for (const side of [node, ported]) if (side) await new Promise((resolve) => side.server.close(resolve));
    if (root) rmSync(root, {recursive: true, force: true});
  });
  for (const accept of accepts) {
    it(`typestructure dataname ${JSON.stringify(accept)} is byte-equal and served by ABAP`, async () => {
      const ask = (side) => ({method: "POST", headers: {...side.auth, "content-type": "text/plain", ...(accept === undefined ? {} : {accept})}, body: "ignored body"});
      const expected = await wire(node, TYPES, ask(node));
      served.length = 0;
      expect(await wire(ported, TYPES, ask(ported))).to.deep.equal(expected);
      expect(expected.status).to.equal(200);
      expect(served).to.deep.equal([`ABAP POST ${TYPES}`]);
      expect(expected.body.toString().match(/<SEU_ADT_OBJECT_TYPE_DESCRIPTOR>/g)).to.have.length(15);
    });
  }
  it("typestructure case/trailing slash and CSRF refusal match Node", async () => {
    const path = TYPES.toUpperCase() + "/";
    for (const valid of [true, false]) {
      const ask = (side) => ({method: "POST", headers: valid ? side.auth : {}});
      served.length = 0;
      const actual = await wire(ported, path, ask(ported));
      expect(actual).to.deep.equal(await wire(node, path, ask(node)));
      expect(actual.status).to.equal(valid ? 200 : 403);
      expect(served).to.deep.equal([`ABAP POST ${path}`]);
    }
  });
  for (const method of ["GET", "HEAD"]) for (const path of [PARSER, PARSER.toUpperCase() + "/"]) {
    it(`parser/info ${method} ${path} matches status, bytes and resource miss record`, async () => {
      const accept = "application/xml";
      const url = path + "?repeat=1&repeat=2&nested[x]=y";
      const key = `resource ${method} ${path}`;
      node.facade.missed.delete(key); ported.facade.missed.delete(key);
      for (let count = 1; count <= 2; count++) {
        served.length = 0;
        const actual = await wire(ported, url, {method, headers: {accept}});
        expect(actual).to.deep.equal(await wire(node, url, {method, headers: {accept}}));
        expect(actual.status).to.equal(404);
        expect(served).to.deep.equal([`ABAP ${method} ${url}`]);
        const stripTime = (record) => {
          expect(record, "resource miss exists").to.be.an("object");
          expect(record.first).to.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
          const {first, ...rest} = record;
          return rest;
        };
        expect(stripTime(ported.facade.missed.get(key))).to.deep.equal(stripTime(node.facade.missed.get(key)));
        expect(ported.facade.missed.get(key).count).to.equal(count);
      }
    });
  }
});
