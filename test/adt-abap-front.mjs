// Slice 3, option B (docs/adt-abap-port/slice-3-front.md): every request
// under /sap/bc/adt enters ZCL_OSD_ADT_HANDLER first. The session is
// ZCL_OSD_ADT_SESSION's (through AbapSessions), the CSRF gate is the
// handler's, a HOST row reaches its Node route after the step with the
// session ABAP resolved, and a route may end in a continuation the host runs
// after the step. Mounted the way test/start.mjs mounts it inline.
import {expect} from "chai";
import express from "express";
import {createHash} from "node:crypto";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner, registerContinuation, continuationKinds} from "../tools/adt-abap-front.mjs";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";
import {adtEnqOwner} from "../tools/adt-enq-key.mjs";
import {endEnqSession} from "../tools/osd-enq-host.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {SESSION_COOKIE} from "../tools/adt-session.mjs";

const BASE = "/sap/bc/adt";
const output = (file) => import(new URL(`../output/${file}`, import.meta.url).href);
const LOCKED = "ZCL_OSD_FRONT";
const SOURCE = `CLASS zcl_osd_front DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_osd_front IMPLEMENTATION.
ENDCLASS.
`;

// the session row ABAP keeps, read in a step of its own: undefined for none
async function sessionRow(id) {
  return dialogStep(async () => {
    const obj = await new abap.Classes.ZCL_OSD_ADT_SESSION().constructor_({});
    const row = (await obj.peek({iv_id: new abap.types.String().set(id)})).get();
    return row.id.get().trim() === "" ? undefined : {id: row.id.get().trim(), user: row.username.get().trim(), token: row.token.get().trim()};
  }, "test: a session row");
}

const cookieId = (res) => /sap-contextid=([^;]+)/.exec(res.headers.getSetCookie().join("; "))?.[1];

describe("ADT front in ABAP: every request enters the handler (slice 3, option B)", function () {
  this.timeout(60000);
  let root;
  let server;
  let url;
  let handler;
  const entered = [];
  const served = [];
  // a runner that dumps after the handler answered, inside the step, when asked
  let dumpNext = false;

  before(async () => {
    ({zcl_osd_adt_handler: handler} = await output("zcl_osd_adt_handler.clas.mjs"));
    root = mkdtempSync(join(tmpdir(), "osd-adt-front-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "zcl_osd_front.clas.abap"), SOURCE);
    const runner = abapRunner({handler, step: dialogStep});
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store: new ObjectStore({root, libs: []}), data: {}, watch: false, logMisses: false,
      transpileOnActivate: false,
      abap: {...runner, answer: async (view, session) => {
        entered.push(`${view.method} ${view.path}`);
        const record = await runner.answer(view, session);
        if (dumpNext) {
          dumpNext = false;
          throw new Error("a dump after the handler answered");
        }
        return record;
      }},
      abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl.split("?")[0]}`)}).router);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    url = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(() => {
    entered.length = 0;
    served.length = 0;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });

  const logon = async (headers = {}) => {
    const res = await fetch(`${url}${BASE}/core/discovery`, {method: "HEAD",
      headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful", ...headers}});
    return {id: cookieId(res), token: res.headers.get("x-csrf-token"), res};
  };
  const as = (client, method, path, extra = {}) => fetch(`${url}${BASE}${path}`, {method, body: extra.body,
    headers: {cookie: `sap-contextid=${client.id}`, "x-csrf-token": client.token, "x-sap-adt-sessiontype": "stateful",
      ...extra.headers}});

  it("every ADT request enters the handler once, whoever serves it", async () => {
    const one = await logon();
    const paths = [
      ["GET", "/core/discovery"], ["GET", "/core/http/systeminformation"], ["GET", "/debugger/listeners"],
      ["GET", `/oo/classes/${LOCKED}/source/main`], ["GET", "/no/such/resource"],
      ["POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`],
    ];
    entered.length = 0;
    served.length = 0;
    for (const [method, path] of paths) await as(one, method, path);
    expect(entered).to.deep.equal(paths.map(([method, path]) => `${method} ${BASE}${path.split("?")[0]}`));
    expect(served).to.deep.equal([
      `HOST GET ${BASE}/core/discovery`, `ABAP GET ${BASE}/core/http/systeminformation`,
      `HOST GET ${BASE}/debugger/listeners`, `HOST GET ${BASE}/oo/classes/${LOCKED}/source/main`,
      `HOST GET ${BASE}/no/such/resource`, `ABAP POST ${BASE}/oo/classes/${LOCKED}`]);
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
  });

  it("a fresh fetch gets both cookies and the token of a session ABAP keeps", async () => {
    const res = await fetch(`${url}${BASE}/core/discovery`, {headers: {"x-csrf-token": "fetch"}});
    expect(res.status).to.equal(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies, "both Set-Cookie lines").to.have.length(2);
    const id = cookieId(res);
    expect(cookies[0]).to.equal(`sap-contextid=${id}; Path=/sap/bc/adt; HttpOnly; SameSite=Strict`);
    expect(cookies[1]).to.equal(`${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict`);
    const row = await sessionRow(id);
    expect(row, "the session is a row of ZOSD_ADT_SESS").to.not.equal(undefined);
    expect(res.headers.get("x-csrf-token")).to.equal(row.token);
    expect(served).to.deep.equal([`HOST GET ${BASE}/core/discovery`]);
  });

  it("a HOST route serves under the session ABAP resolved", async () => {
    const one = await logon({authorization: "Basic " + Buffer.from("front:x").toString("base64")});
    const row = await sessionRow(one.id);
    expect(row.user).to.equal("FRONT");
    // the security sessions resource names req.adt.session.id, hashed
    const res = await as(one, "GET", "/core/http/sessions", {headers: {"x-sap-adt-sessiontype": "stateless"}});
    expect(res.status).to.equal(200);
    const body = await res.text();
    const expected = createHash("sha256").update(one.id).digest("hex").slice(0, 32).toUpperCase();
    expect(body).to.contain(`/core/http/sessions/${expected}`);
    // a stateful session's cookies go on every answer, as Node's did, and the token is the row's
    expect(res.headers.getSetCookie()).to.have.length(2);
    expect(res.headers.get("x-csrf-token")).to.equal(row.token);
    expect(served).to.include(`HOST GET ${BASE}/core/http/sessions`);
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
  });

  it("a write with another session's token is refused by ABAP, with or without a cookie", async () => {
    const one = await logon();
    const two = await logon();
    for (const headers of [{"x-csrf-token": one.token}, {"x-csrf-token": one.token, cookie: `sap-contextid=${two.id}`}]) {
      served.length = 0;
      const res = await fetch(`${url}${BASE}/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`, {method: "POST",
        headers: {"x-sap-adt-sessiontype": "stateless", ...headers}});
      expect([res.status, res.headers.get("x-csrf-token"), await res.text()], JSON.stringify(headers))
        .to.deep.equal([403, "Required", "CSRF token validation failed"]);
      expect(served, JSON.stringify(headers)).to.deep.equal([`ABAP POST ${BASE}/oo/classes/${LOCKED}`]);
    }
    for (const client of [one, two]) await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${client.id}`}});
  });

  it("logoff, a dump, an ended ENQ session: each next request gets a fresh session", async () => {
    // logoff: the row goes, and the old cookie names nothing
    const one = await logon();
    expect((await as(one, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`)).status).to.equal(200);
    expect((await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `${SESSION_COOKIE}=${one.id}`}})).status).to.equal(200);
    expect(await sessionRow(one.id)).to.equal(undefined);
    // a dump: the step that would open a new session for the old cookie rolls
    // back, so no row is left and the client got no cookie
    dumpNext = true;
    const dumped = await fetch(`${url}${BASE}/core/discovery`, {headers: {cookie: `sap-contextid=${one.id}`}});
    expect(dumped.status).to.equal(500);
    expect(dumped.headers.getSetCookie()).to.deep.equal([]);
    // the next request with the old cookie opens a fresh session
    const fresh = await fetch(`${url}${BASE}/core/discovery`, {headers: {cookie: `sap-contextid=${one.id}`,
      "x-sap-adt-sessiontype": "stateful"}});
    expect(fresh.status).to.equal(200);
    const id = cookieId(fresh);
    expect(id).to.match(/^[0-9a-f]{24}$/);
    expect(id).to.not.equal(one.id);
    expect(await sessionRow(id)).to.not.equal(undefined);
    // the lock went with the logoff: the fresh session takes it
    const client = {id, token: fresh.headers.get("x-csrf-token")};
    expect((await as(client, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`)).status).to.equal(200);
    // its ENQ session ended behind its back (the lock server): the next
    // request is the refusal a client logs on after, committed inside the
    // step, and the one after it a fresh session
    endEnqSession(adtEnqOwner.key(id));
    const ended = await as(client, "GET", "/core/discovery");
    expect([ended.status, ended.headers.get("x-csrf-token"), await ended.text()])
      .to.deep.equal([403, "Required", "CSRF token validation failed"]);
    expect(await sessionRow(id), "the refusal's deletion committed").to.equal(undefined);
    const again = await as(client, "GET", "/core/discovery");
    expect(again.status).to.equal(200);
    const next = cookieId(again);
    expect(next).to.match(/^[0-9a-f]{24}$/);
    expect(next).to.not.equal(id);
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${next}`}});
  });

  describe("a continuation runs after the step", () => {
    const ECHO = `${BASE}/osd/test/continuation`;
    before(async () => {
      // the real table with the test route in front of it
      await dialogStep(async () => {
        const {zcl_osd_adt_router: router} = await output("zcl_osd_adt_router.clas.mjs");
        const table = await router.routes();
        const rows = table.clone();
        rows.clear();
        const row = rows.appendInitial().get();
        row.method.set("*");
        row.pattern.set(ECHO);
        row.handler.set("ZCL_OSD_ADT_ROUTE_ECHO");
        row.served_by.set("ABAP");
        for (const line of table.array()) rows.append(line);
        // the class slot the front calls, which a warm load may have replaced
        await abap.Classes.ZCL_OSD_ADT_HANDLER.use_routes({it_routes: rows});
      }, "test: the continuation route");
    });
    after(() => dialogStep(() => abap.Classes.ZCL_OSD_ADT_HANDLER.use_routes({}), "test: the real route table"));

    it("the built-in echo answers for ABAP's verdict, with the ABAP session", async () => {
      expect(continuationKinds()).to.include.members(["", "echo"]);
      const one = await logon();
      served.length = 0;
      entered.length = 0;
      const res = await as(one, "POST", ECHO.slice(BASE.length));
      expect(res.status).to.equal(200);
      expect(await res.json()).to.deep.equal({kind: "echo", payload: {method: "POST", path: ECHO},
        session: {id: one.id, user: "OSD", stateful: true}, abap: {status: 202, body: "decided in ABAP"}});
      expect(res.headers.get("x-csrf-token")).to.equal(one.token);
      expect(served).to.deep.equal([`HOST POST ${ECHO}`]);
      expect(entered).to.deep.equal([`POST ${ECHO}`]);
      await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
    });

    it("a registered kind runs outside the work process, and may extend the ABAP answer", async () => {
      const seen = [];
      const unregister = registerContinuation("test-extend", async ({payload, session, replay}) => {
        seen.push({held: workProcess().held, payload, session: session.id});
        // a step of its own is possible: no nested step
        seen.push(await dialogStep(async () => "a step after the step", "test: a continuation's step"));
        replay();
      });
      try {
        expect(() => registerContinuation("test-extend", () => {})).to.throw(/registered already/);
        const fresh = await fetch(`${url}${ECHO}?kind=test-extend`, {headers: {"x-csrf-token": "fetch"}});
        expect([fresh.status, fresh.headers.get("content-type"), await fresh.text()])
          .to.deep.equal([202, "text/plain; charset=utf-8", "decided in ABAP"]);
        // the cookies of a fresh session reach the client through a continuation too
        expect(fresh.headers.getSetCookie()).to.have.length(2);
        const id = cookieId(fresh);
        expect(seen).to.deep.equal([{held: false, payload: {method: "GET", path: ECHO}, session: id},
          "a step after the step"]);
        const unknown = await fetch(`${url}${ECHO}?kind=nobody-registered`);
        expect(unknown.status).to.equal(500);
        expect(await unknown.text()).to.contain("no continuation &quot;nobody-registered&quot; is registered");
      } finally {
        unregister();
      }
      expect(continuationKinds()).to.not.include("test-extend");
    });
  });
});
