import {expect} from "chai";
import "./start.mjs";
import {answerOf} from "../tools/adt-abap-front.mjs";
import {withSystem} from "../tools/osd-store-destination.mjs";
import {identity} from "./helpers/adt-session-unit.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";

const API = "zif_osd_adt_session$";
const args = (input) => Object.fromEntries(Object.entries(input).map(([k, v]) => [k, new abap.types.String().set(v)]));
const BASE = "/sap/bc/adt";
const PATTERN = BASE + "/f1/:name";
let handler;
let sessions;
const ids = new Set();

async function answer(mode, {path = BASE + "/f1/example", method = "GET", headers = {}} = {}) {
  const url = `${path}?f1=${mode}&value=a%20b`;
  const record = await withSystem((kind) => kind === "IDENTITY" ? identity : undefined, () => dialogStep(() => answerOf(handler, {path, url, method, body: Buffer.alloc(0),
    headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful", ...headers}}, sessions), "F1 request"));
  const id = /sap-contextid=([^;]+)/.exec(record.headers.map(([k, v]) => `${k}=${v}`).join(";"))?.[1];
  if (id) ids.add(id);
  return {record, id, url};
}
async function row(id) {
  return dialogStep(async () => (await sessions.peek(args({iv_id: id}))).get().id.get().trimEnd(), "F1 session row");
}
async function handles(id) {
  return dialogStep(async () => (await sessions.handles(args({iv_id: id}))).array(), "F1 route handles");
}

describe("ADT F1: route context and transaction fence", function () {
  this.timeout(60000);
  before(async () => {
    handler = abap.Classes.ZCL_OSD_ADT_HANDLER;
    sessions = await new abap.Classes.ZCL_OSD_ADT_SESSION().constructor_({});
    const routes = abap.Classes.ZCL_OSD_ADT_ROUTER.METHODS.DISPATCH.parameters.IT_ROUTES.type();
    for (const pattern of [PATTERN, "/sap/public/bc/icf/logoff", "/sap/bc/adt-other/:name"]) {
      const r = routes.appendInitial().get();
      r.method.set("GET"); r.pattern.set(pattern); r.handler.set("ZCL_OSD_ADT_ROUTE_ECHO"); r.served_by.set("ABAP");
    }
    await handler.use_routes({it_routes: routes});
  });
  afterEach(async () => {
    for (const id of ids) await dialogStep(() => sessions[API + "end"](args({iv_id: id})), "F1 cleanup");
    ids.clear();
  });
  after(async () => { await handler.use_routes({}); });

  it("a route reads the resolved session, matched pattern and original URI", async () => {
    const {record, id, url} = await answer("context", {path: BASE + "/F1/example/"});
    expect(record.status).to.equal(200);
    expect(id).to.match(/^[0-9a-f]{24}$/);
    expect(record.body.toString()).to.equal(`${id};${identity.userName};X;${PATTERN};${url}`);
    expect(await row(id)).to.equal(id);
  });

  it("the ICF handler passes ~request_uri including its query", async () => {
    const path = BASE + "/f1/example";
    const url = path + "?f1=context&value=a%20b";
    const captured = {};
    const res = {append() {}, status(code) { captured.status = code; return this; },
      send(body) { captured.body = body.toString(); }};
    await dialogStep(() => abap.Classes.CL_EXPRESS_ICF_SHIM.run({
      req: {method: "GET", path, url, headers: {}, body: Buffer.alloc(0)}, res,
      class: "ZCL_OSD_ADT_HANDLER", base: new abap.types.String().set(BASE),
    }), "F1 ICF request");
    expect(captured).to.deep.equal({status: 200, body: `;;;${PATTERN};${url}`});
  });

  for (const [mode, status] of [["adt", 404], ["root", 500]]) {
    it(`FENCE rolls back ${mode} exception work and persists session rows`, async () => {
      const {record, id} = await answer(mode);
      expect(record.status).to.equal(status);
      expect(await row(id)).to.equal(id);
      expect(await handles(id)).to.have.length(0);
    });
  }

  it("FENCE preserves route work on a returned 400", async () => {
    const {record, id} = await answer("status");
    expect(record.status).to.equal(400);
    expect(await handles(id)).to.have.length(1);
    expect(await row(id)).to.equal(id);
  });

  it("a non-ADT path skips RESOLVE, CSRF and session stamping", async () => {
    let resolved = 0;
    const resolve = sessions[API + "resolve"];
    sessions[API + "resolve"] = async (...input) => { resolved++; return resolve(...input); };
    try {
      for (const path of ["/sap/public/bc/icf/logoff", "/sap/bc/adt-other/example"]) {
        const {record, url} = await answer("context", {path, method: "HEAD"});
        expect(record.status).to.equal(200);
        expect(record.headers.filter(([k]) => ["set-cookie", "x-csrf-token"].includes(k.toLowerCase()))).to.deep.equal([]);
        expect(record.body.toString()).to.equal(`;;;${path.includes("adt-other") ? "/sap/bc/adt-other/:name" : path};${url}`);
      }
      // A write outside BASE reaches dispatch rather than the CSRF refusal.
      const {record} = await answer("context", {path: "/sap/public/bc/icf/logoff", method: "POST"});
      expect(record.status).to.equal(404);
      expect(resolved).to.equal(0);
    } finally { sessions[API + "resolve"] = resolve; }
  });

  for (const name of ["ZCL_OSD_ADT_SESSION", "ZCL_OSD_ADT_SESSION_MEM"]) {
    it(`RELEASE_OBJECT drops only the matching handle in ${name}`, async () => {
      const obj = await new abap.Classes[name]().constructor_({});
      const fields = handler.METHODS.ANSWER.parameters.IS_REQUEST.type().get().headers;
      let one, two;
      await withSystem((kind) => kind === "IDENTITY" ? identity : undefined, () => dialogStep(async () => {
        one = (await obj[API + "resolve"]({it_headers: fields, it_cookies: fields})).get().id.get();
        two = (await obj[API + "resolve"]({it_headers: fields, it_cookies: fields})).get().id.get();
        const adopt = async (id, type, object) => (await obj[API + "adopt_handle"](args({iv_id: id, iv_type: type, iv_name: object}))).get();
        const released = await adopt(one, "CLAS", "ZF1_ONE");
        const kept = await adopt(one, "PROG", "ZF1_TWO");
        const other = await adopt(two, "CLAS", "ZF1_ONE");
        await obj[API + "release_object"](args({iv_id: one, iv_type: "clas", iv_name: "zf1_one"}));
        await obj[API + "release_object"](args({iv_id: one, iv_type: "CLAS", iv_name: "ZF1_MISSING"}));
        for (const [id, handle, type, object, expected] of [[one, released, "CLAS", "ZF1_ONE", " "],
          [one, kept, "PROG", "ZF1_TWO", "X"], [two, other, "CLAS", "ZF1_ONE", "X"]]) {
          expect((await obj[API + "holds"](args({iv_id: id, iv_handle: handle, iv_type: type, iv_name: object}))).get()).to.equal(expected);
        }
        expect((await obj[API + "alive"](args({iv_id: one}))).get()).to.equal("X");
      }, "F1 release object"));
      for (const id of [one, two]) await dialogStep(() => obj[API + "end"](args({iv_id: id})), "F1 release cleanup");
    });
  }
});
