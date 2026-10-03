// Slice 3, option B (docs/adt-abap-port/slice-3-front.md): every request
// under /sap/bc/adt enters ZCL_OSD_ADT_HANDLER first. The session is
// ZCL_OSD_ADT_SESSION's (through AbapSessions), the CSRF gate is the
// handler's, a HOST row reaches its Node route after the step with the
// session ABAP resolved, and a route may end in a continuation the host runs
// after the step. Mounted the way test/start.mjs mounts it inline.
import {expect} from "chai";
import express from "express";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner, abapServes, registerContinuation, continuationKinds} from "../tools/adt-abap-front.mjs";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";
import {adtEnqOwner} from "../tools/adt-enq-key.mjs";
import {AbapSessions} from "../tools/adt-abap-sessions.mjs";
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

  it("logoff and a dump: each next request gets a fresh session", async () => {
    // logoff: the row goes, and the old cookie names nothing
    const one = await logon();
    expect((await as(one, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`)).status).to.equal(200);
    expect((await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `${SESSION_COOKIE}=${one.id}`}})).status).to.equal(200);
    expect(await sessionRow(one.id)).to.equal(undefined);
    // a dump: the step that would open a new session for the old cookie rolls
    // back, so no row is left and the client got no cookie
    dumpNext = true;
    const dumped = await fetch(`${url}${BASE}/core/discovery`, {headers: {cookie: `sap-contextid=${one.id}`,
      "x-sap-adt-sessiontype": "stateful"}});
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
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${id}`}});
  });

  it("B0 carry excludes a dead handle and rebuild keeps its write at 409", async () => {
    const one = await logon();
    const locked = await as(one, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`);
    const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(await locked.text())?.[1];
    expect(handle).to.match(/^[0-9a-f-]{36}$/);
    endEnqSession(adtEnqOwner.key(one.id));
    const db = abap.context.databaseConnections.DEFAULT;
    const {snapshotAdtRows, restoreAdtRows, rebuildAdtLocks} = await import("../tools/adt-runtime-state.mjs");
    const state = await snapshotAdtRows(db);
    expect(state.zosd_adt_shdl.some((row) => row.handle === handle)).to.equal(false);
    await dialogStep(() => restoreAdtRows(db, state, {replace: true}), "B0 filtered carry");
    await rebuildAdtLocks(db);
    const put = await as(one, "PUT", `/oo/classes/${LOCKED}/source/main?lockHandle=${handle}`,
      {headers: {"content-type": "text/plain"}, body: SOURCE});
    expect(put.status, await put.clone().text()).to.equal(409);
    expect(put.headers.get("x-csrf-token")).to.equal(one.token);
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
  });

  // The acceptance test of this branch and of #471 together: an ENQ context
  // the lock server ended is not a session that ended. The session and its
  // token stay; the dead handle writes nothing (409, as on main), and a read
  // just works. It needs #471 (BIND revives an ended key, ZCL_OSD_ENQ_KERNEL=>REVIVE)
  // and is pending until that is in the tree.
  it("an ENQ context ended behind the session: the old handle is 409, a GET is 200, a relock a new handle", async function () {
    if (readFileSync(new URL("../output/zcl_osd_enq_kernel.clas.mjs", import.meta.url), "utf8").includes("async revive(") === false) {
      this.skip();
    }
    const one = await logon();
    const locked = await as(one, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`);
    const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(await locked.text())?.[1];
    expect(handle).to.match(/^[0-9a-f-]{36}$/);
    endEnqSession(adtEnqOwner.key(one.id));
    const put = await as(one, "PUT", `/oo/classes/${LOCKED}/source/main?lockHandle=${handle}`,
      {headers: {"content-type": "text/plain"}, body: SOURCE + "* not written\n"});
    expect(put.status).to.equal(409);
    expect(await put.text()).to.contain("ExceptionResourceNotLocked");
    const get = await as(one, "GET", `/oo/classes/${LOCKED}/source/main`);
    expect(get.status).to.equal(200);
    expect(await get.text()).to.not.contain("not written");
    expect(get.headers.get("x-csrf-token"), "the same session and token").to.equal(one.token);
    expect((await sessionRow(one.id))?.token).to.equal(one.token);
    // the client locks again and gets a new handle; the old one stays dead
    const relocked = await as(one, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`);
    expect(relocked.status).to.equal(200);
    const fresh = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(await relocked.text())?.[1];
    expect(fresh).to.match(/^[0-9a-f-]{36}$/);
    expect(fresh, "a relock returns a new handle").to.not.equal(handle);
    const late = await as(one, "PUT", `/oo/classes/${LOCKED}/source/main?lockHandle=${handle}`,
      {headers: {"content-type": "text/plain"}, body: SOURCE + "* not written\n"});
    expect(late.status, "the old handle is still 409").to.equal(409);
    expect((await as(one, "POST", `/oo/classes/${LOCKED}?_action=UNLOCK&lockHandle=${fresh}`)).status).to.equal(200);
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
  });

  it("a DELETE whose session logs off behind the verdict deletes nothing", async () => {
    // codex's interleaving: the DELETE's step answers HOST, its own logoff
    // runs before the Node route, and a session that is gone may not delete
    writeFileSync(join(root, "src", "zcl_osd_doomed.clas.abap"), SOURCE.replaceAll("zcl_osd_front", "zcl_osd_doomed"));
    const one = await logon();
    let free;
    let started;
    const running = new Promise((resolve) => { started = resolve; });
    const held = dialogStep(() => new Promise((resolve) => { free = resolve; started(); }), "test: the work process is busy");
    await running;
    const deleted = as(one, "DELETE", "/oo/classes/zcl_osd_doomed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const off = fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
    await new Promise((resolve) => setTimeout(resolve, 50));
    free();
    await held;
    const answer = await deleted;
    expect((await off).status).to.equal(200);
    expect([answer.status, answer.headers.get("x-csrf-token")]).to.deep.equal([403, "Required"]);
    expect(existsSync(join(root, "src", "zcl_osd_doomed.clas.abap")), "the object is still there").to.equal(true);
  });

  it("a LOCK queued behind its own session's logoff is refused and takes no lock (#432)", async () => {
    // the other order of the race above: the logoff has the work process
    // first, ends the session and its ENQ key, and the LOCK that waited
    // behind it must not bring the session back. RESOLVE finds no row for
    // the old cookie, opens a fresh session, and the old token is not its.
    const one = await logon();
    let free;
    let started;
    const running = new Promise((resolve) => { started = resolve; });
    const held = dialogStep(() => new Promise((resolve) => { free = resolve; started(); }), "test: the work process is busy");
    await running;
    const off = fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
    await new Promise((resolve) => setTimeout(resolve, 50));
    const queued = as(one, "POST", `/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    free();
    await held;
    expect((await off).status).to.equal(200);
    const answer = await queued;
    expect([answer.status, answer.headers.get("x-csrf-token")], "the LOCK found its session gone").to.deep.equal([403, "Required"]);
    expect(await sessionRow(one.id), "the old session stays gone").to.equal(undefined);
    const {locks} = await import("../tools/osd-enq.mjs");
    expect(locks().read({table: "ZOSD_ADT_LOCK"}).filter((r) => r.arg.includes(LOCKED)), "no lock taken").to.deep.equal([]);
  });

  it("a probe and a refused write keep no session row; a fetch does", async () => {
    const probe = await fetch(`${url}${BASE}/core/discovery`);
    expect(probe.status).to.equal(200);
    expect(probe.headers.get("x-csrf-token"), "the answer still carries a token").to.match(/^[A-Za-z0-9_-]{24}$/);
    expect(await sessionRow(cookieId(probe)), "a probe").to.equal(undefined);
    const refused = await fetch(`${url}${BASE}/oo/classes/${LOCKED}?_action=LOCK`, {method: "POST"});
    expect(refused.status).to.equal(403);
    expect(await sessionRow(cookieId(refused)), "a refused write").to.equal(undefined);
    const fetched = await fetch(`${url}${BASE}/core/discovery`, {headers: {"x-csrf-token": "fetch"}});
    expect(await sessionRow(cookieId(fetched)), "a fetch").to.not.equal(undefined);
  });

  it("a step whose ENQ session ended while it waited is the refusal, not a dump", async () => {
    // The real path, with the logoff's moment chosen: the session is resolved
    // and bound, then its ENQ key is ended (what a logoff running during a
    // WAIT does), and the LOCK's ENQUEUE in the same step meets the lock
    // server's EnqSessionEnded. No route of the tree WAITs before its
    // ENQUEUE today, so the end is put there by the session's RESOLVE.
    class EndingSessions extends AbapSessions {
      async sessionFor(req) {
        const obj = await super.sessionFor(req);
        const resolve = obj["zif_osd_adt_session$resolve"];
        obj["zif_osd_adt_session$resolve"] = async (input) => {
          const resolved = await resolve(input);
          if (req.method === "POST") endEnqSession(adtEnqOwner.key(resolved.get().id.get().trimEnd()));
          return resolved;
        };
        return obj;
      }
    }
    const app = express();
    app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store: new ObjectStore({root, libs: []}), data: {}, watch: false, logMisses: false,
      transpileOnActivate: false, sessions: new EndingSessions(), abap: abapRunner({handler, step: dialogStep})}).router);
    const other = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      const at = `http://127.0.0.1:${other.address().port}${BASE}`;
      const hello = await fetch(`${at}/core/discovery`, {method: "HEAD",
        headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
      const answer = await fetch(`${at}/oo/classes/${LOCKED}?_action=LOCK&accessMode=MODIFY`, {method: "POST",
        headers: {cookie: `sap-contextid=${cookieId(hello)}`, "x-csrf-token": hello.headers.get("x-csrf-token"),
          "x-sap-adt-sessiontype": "stateful"}});
      expect([answer.status, answer.headers.get("x-csrf-token"), await answer.text()])
        .to.deep.equal([403, "Required", "CSRF token validation failed"]);
      const {locks} = await import("../tools/osd-enq.mjs");
      expect(locks().read({table: "ZOSD_ADT_LOCK"}).filter((r) => r.arg.includes(LOCKED)), "no lock taken").to.deep.equal([]);
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it("the body goes to ABAP only for a row ABAP serves, and the answer names who served it", async () => {
    const asks = [["PUT", `${BASE}/oo/classes/zcl_x/source/main`, false], ["POST", `${BASE}/oo/classes/ZCL_X`, true],
      ["GET", `${BASE}/core/http/systeminformation`, true], ["GET", `${BASE}/core/discovery`, false]];
    for (const [method, path, expected] of asks) {
      expect(await dialogStep(() => abapServes(method, path), "test: the router's match"), `${method} ${path}`).to.equal(expected);
    }
    const one = await logon();
    expect((await as(one, "GET", "/core/http/systeminformation")).headers.get("x-osd-served-by")).to.equal("ABAP");
    expect((await as(one, "GET", "/core/discovery")).headers.get("x-osd-served-by")).to.equal("HOST");
    await fetch(`${url}/sap/public/bc/icf/logoff`, {headers: {cookie: `sap-contextid=${one.id}`}});
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
        // a continuation that throws is said on the console, and answered
        const errors = [];
        const error = console.error;
        const off = registerContinuation("test-throws", () => { throw new Error("the continuation fell over"); });
        console.error = (...args) => errors.push(args.join(" "));
        try {
          expect((await fetch(`${url}${ECHO}?kind=test-throws`)).status).to.equal(500);
        } finally {
          console.error = error;
          off();
        }
        expect(errors.join("\n")).to.contain("the continuation fell over");
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

// The local tests above intentionally inject faults into the local class
// slots. This checks the same front seam over the real serving-child door.
describe("ADT front: remote continuation stays in the parent", function () {
  this.timeout(60000);
  let runtime, server;
  before(async () => {
    const {remoteForTest} = await import("./helpers/adt-remote.mjs");
    runtime = await remoteForTest();
    const response = await fetch(runtime.url + "/osd/classrun", {method: "POST",
      headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_FRONT_PROBE"})});
    expect((await response.json()).ok).to.equal(true);
    const app = express();
    app.use(adtRouter({store: new ObjectStore({root: process.cwd()}), data: {}, watch: false, logMisses: false,
      abap: abapRunner({remote: runtime})}).router);
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  });
  after(async () => { if (server) await new Promise(r => server.close(r)); await runtime?.stop(); });
  it("replays both cookies and runs the HOST echo continuation after the child step", async () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(url + BASE + "/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const response = await fetch(url + BASE + "/osd/test/continuation", {method: "POST",
      headers: {cookie, "x-csrf-token": login.headers.get("x-csrf-token")}});
    expect(response.status).to.equal(200);
    expect((await response.json()).kind).to.equal("echo");
    expect(response.headers.get("x-osd-served-by")).to.equal("HOST");
    // A new child step can run: the continuation did not keep the FIFO.
    const probe = await fetch(runtime.url + "/osd/classrun", {method: "POST",
      headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_ENQ_PROBE"})});
    expect((await probe.json()).ok).to.equal(true);
    expect(login.headers.getSetCookie()).to.have.length(2);
  });
});
