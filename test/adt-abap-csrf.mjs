// Gate 1 for the CSRF gate in ABAP (ADR 0007, slice 3, part A): the
// handler's gate (ZCL_OSD_ADT_CSRF in ZCL_OSD_ADT_HANDLER) answers what the
// Node session middleware answers (tools/adt-session.mjs) -- the token on
// every answer, fetch answered, a write without the session's token refused
// with the same status, type, length, entity tag, body and x-csrf-token.
//
// Two servers: the Node façade as it is, and ZCL_OSD_ADT_HANDLER alone
// behind cl_express_icf_shim under dialogStep, with a session bound through
// USE_SESSION. Until stoker's ZIF_OSD_ADT_SESSION implementation lands the
// session is ZCL_OSD_ADT_SESSION_MEM (test/unit), a double with the Node
// session's lookup rules; so the token itself is compared by shape, never by
// value, and the session's own contract is the implementation's test, not
// this one. What is compared byte for byte is the gate's answer.
import {remoteForTest} from "./helpers/adt-remote.mjs";
import {RemoteSessions} from "../tools/adt-remote-sessions.mjs";
import {abapFront, abapRunner} from "../tools/adt-abap-front.mjs";
import {expect} from "chai";
import express from "express";
import {request as httpRequest} from "node:http";
import "./start.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {bodyOf, HANDLER, SERVED_BY} from "../tools/adt-abap-front.mjs";
import {withSystem} from "../tools/osd-store-destination.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const output = (file) => import(new URL(`../output/${file}`, import.meta.url).href);

const BASE = "/sap/bc/adt";
const SYSINFO = `${BASE}/core/http/systeminformation`;
const GRAPH = `${BASE}/compatibility/graph`;
// a token a client can use: never empty, never the word fetch
const TOKEN = /^[A-Za-z0-9_-]{24}$/;

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function call(server, method, path, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {method, headers});
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    length: response.headers.get("content-length"),
    etag: response.headers.get("etag"),
    token: response.headers.get("x-csrf-token"),
    servedBy: response.headers.get(SERVED_BY),
    cookies: response.headers.getSetCookie(),
    all: [...response.headers].map(([name, value]) => `${name}: ${value}`).join("\n"),
    body: Buffer.from(await response.arrayBuffer()).toString("utf8"),
  };
}

// a request fetch will not send as asked: a method in mixed case (fetch
// upper-cases POST), a HEAD with a body
function raw(server, method, path, headers = {}, body = undefined) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({host: "127.0.0.1", port: server.address().port, path, method,
      headers: body === undefined ? headers : {...headers, "content-length": Buffer.byteLength(body)}}, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({status: res.statusCode, token: res.headers["x-csrf-token"] ?? null,
        all: JSON.stringify(res.headers), body: Buffer.concat(chunks).toString("utf8")}));
    });
    req.on("error", reject);
    req.end(body);
  });
}

// what the gate is answerable for: the session values are random on both
// sides, the generation header and the HOST marker are not the gate's
const gate = ({status, type, length, etag, token, body}) => ({status, type, length, etag, token, body});

// the Cookie header a client sends back after an answer
const cookieOf = (answer) => answer.cookies.map((line) => line.split(";")[0]).join("; ");

describe("ADT façade in ABAP: the CSRF gate against the Node middleware", function () {
  this.timeout(60000);
  let root;
  let node;
  let abap;
  let handler;
  let identity;
  let double;
  let remoteRuntime;
  let remoteSessions;
  const servers = [];

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-adt-csrf-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    const nodeApp = express();
    nodeApp.use(adtRouter({data: {}, logMisses: false, watch: false, store: new ObjectStore({root, libs: []})}).router);
    node = await listen(nodeApp);
    servers.push(node);
    // the ABAP side answers the identity the Node side answers, so the
    // systeminformation bodies compare whole
    identity = JSON.parse((await call(node, "GET", SYSINFO)).body);

    const {cl_express_icf_shim: shim} = await output("cl_express_icf_shim.clas.mjs");
    ({zcl_osd_adt_handler: handler} = await output("zcl_osd_adt_handler.clas.mjs"));
    const {zcl_osd_adt_session_mem: mem} = await output("zcl_osd_adt_session_mem.clas.mjs");
    await mem.reset();
    double = await new mem().constructor_();
    await handler.use_session({io_session: double});
    const abapApp = express();
    if (process.env.OSD_ADT_ONE_RUNTIME === "1") {
      remoteRuntime = await remoteForTest();
      remoteSessions = new RemoteSessions(remoteRuntime, {});
      abapApp.use(BASE, abapFront({...abapRunner({remote: remoteRuntime}), sessions: remoteSessions,
        system: kind => kind === "IDENTITY" ? identity : undefined,
        refuse: (res, status, type, message) => res.status(status).send(message)}));
    } else abapApp.use(BASE, async (req, res) => {
      const url = req.originalUrl;
      const view = {method: req.method, headers: req.headers, url, path: url.split("?")[0], body: await bodyOf(req)};
      await withSystem((kind) => (kind === "IDENTITY" ? identity : undefined),
        () => dialogStep(() => shim.run({req: view, res, class: HANDLER,
          base: new globalThis.abap.types.String().set(BASE)}), `ADT ${req.method} ${url}`));
    });
    abap = await listen(abapApp);
    servers.push(abap);
  });

  after(async () => {
    // the handler's session is process-wide: the suites after this one run
    // the mixed phase, where the Node middleware gates
    await handler?.use_session({});
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    await remoteRuntime?.stop();
    rmSync(root, {recursive: true, force: true});
  });

  it("every answer carries the session's token, and fetch is answered with it", async () => {
    for (const [method, path, headers] of [
      ["GET", SYSINFO, {"x-csrf-token": "fetch"}],
      ["GET", SYSINFO, {"x-csrf-token": "Fetch"}],
      ["HEAD", SYSINFO, {"x-csrf-token": "fetch"}],
      ["GET", GRAPH, {}],
      // not HEAD of the graph: its empty answer is ended or sent by the
      // front's replay (tools/adt-abap-front.mjs), which this bare mount has
      // not got; adt-abap-diff.mjs compares it through the front
    ]) {
      const expected = await call(node, method, path, headers);
      const actual = await call(abap, method, path, headers);
      const what = `${method} ${path} ${JSON.stringify(headers)}`;
      expect(gate(actual), what).to.deep.equal({...gate(expected), token: actual.token});
      expect(expected.token, what).to.match(TOKEN);
      expect(actual.token, what).to.match(TOKEN);
      expect(actual.status, what).to.equal(200);
    }
  });

  it("a session keeps its token, and a new session gets another", async () => {
    for (const server of [node, abap]) {
      const first = await call(server, "GET", SYSINFO, {"x-csrf-token": "fetch"});
      const again = await call(server, "GET", SYSINFO, {"x-csrf-token": "fetch", cookie: cookieOf(first)});
      const other = await call(server, "GET", SYSINFO, {"x-csrf-token": "fetch"});
      expect(again.token).to.equal(first.token);
      expect(other.token).to.not.equal(first.token);
      // a fresh session is answered with its cookies; a known stateless one is not
      expect(first.cookies.length).to.be.greaterThan(0);
      expect(again.cookies).to.deep.equal([]);
    }
  });

  it("a write without the session's token is refused byte for byte as Node refuses it", async () => {
    const sessionOn = async (server) => {
      const logon = await call(server, "GET", SYSINFO, {"x-csrf-token": "fetch"});
      return {cookie: cookieOf(logon), token: logon.token};
    };
    const nodeSession = await sessionOn(node);
    const abapSession = await sessionOn(abap);
    const cases = [];
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "MERGE"]) {
      for (const path of [SYSINFO, GRAPH, `${BASE}/oo/classes/zcl_x/source/main`]) {
        cases.push([method, path, () => ({})]);
        cases.push([method, path, () => ({"x-csrf-token": "fetch"})]);
        cases.push([method, path, () => ({"x-csrf-token": "not-the-token"})]);
        // the session's cookie with no token, and with the token in the wrong case
        cases.push([method, path, (s) => ({cookie: s.cookie})]);
        cases.push([method, path, (s) => ({cookie: s.cookie, "x-csrf-token": s.token.toUpperCase() === s.token
          ? s.token.toLowerCase() : s.token.toUpperCase()})]);
      }
    }
    // another session's token is not this session's
    cases.push(["POST", SYSINFO, (s, other) => ({cookie: s.cookie, "x-csrf-token": other.token})]);
    for (const [method, path, headersOf] of cases) {
      const expected = await call(node, method, path, headersOf(nodeSession, await sessionOn(node)));
      const actual = await call(abap, method, path, headersOf(abapSession, await sessionOn(abap)));
      const what = `${method} ${path} ${headersOf.toString()}`;
      expect(gate(actual), what).to.deep.equal(gate(expected));
      expect(actual.status, what).to.equal(403);
      expect(actual.token, what).to.equal("Required");
      expect(actual.type, what).to.equal("text/plain; charset=utf-8");
      expect(actual.body, what).to.equal("CSRF token validation failed");
    }
  });

  it("a write with the session's token passes the gate and reaches the router", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const logon = await call(abap, "GET", SYSINFO, {"x-csrf-token": "fetch"});
      const actual = await call(abap, method, `${BASE}/oo/classes/zcl_x/source/main`,
        {cookie: cookieOf(logon), "x-csrf-token": logon.token});
      // no ABAP row serves it: past the gate, the router hands it to the host,
      // and the answer still carries the token
      expect(actual.status, method).to.equal(404);
      expect(actual.servedBy, method).to.equal("HOST");
      expect(actual.token, method).to.equal(logon.token);
      const nodeLogon = await call(node, "GET", SYSINFO, {"x-csrf-token": "fetch"});
      const reference = await call(node, method, `${BASE}/oo/classes/zcl_x/source/main`,
        {cookie: cookieOf(nodeLogon), "x-csrf-token": nodeLogon.token});
      expect(reference.status, method).to.not.equal(403);
    }
  });

  it("the attacks a critic named: each refused or harmless on both sides, and no refusal shows a token", async () => {
    const logon = async (server) => {
      const answer = await call(server, "GET", SYSINFO, {"x-csrf-token": "fetch"});
      return {cookie: cookieOf(answer), token: answer.token};
    };
    const sides = {node, abap};
    const refused = (answer, what, tokens) => {
      expect(answer.status, what).to.equal(403);
      expect(answer.token, what).to.equal("Required");
      expect(answer.body, what).to.equal("CSRF token validation failed");
      for (const token of tokens) {
        expect(answer.all, `${what}: a token in the headers`).to.not.contain(token);
        expect(answer.body, `${what}: a token in the body`).to.not.contain(token);
      }
    };
    for (const [side, server] of Object.entries(sides)) {
      const mine = await logon(server);
      const other = await logon(server);
      const tokens = [mine.token, other.token];
      // an explicit empty token
      refused(await call(server, "POST", SYSINFO, {cookie: mine.cookie, "x-csrf-token": ""}), `${side} empty`, tokens);
      // a cookie-free request carrying another session's token: a fresh
      // session opens, and its token is not answered on the refusal either
      const clone = await call(server, "POST", SYSINFO, {"x-csrf-token": other.token});
      refused(clone, `${side} clone`, tokens);
      // a method override does not turn a refused write into a read
      refused(await call(server, "POST", SYSINFO, {cookie: mine.cookie, "x-http-method-override": "GET"}),
        `${side} override`, tokens);
      // and does not make a read a write either: the GET answers as a GET
      const read = await call(server, "GET", SYSINFO, {cookie: mine.cookie, "x-http-method-override": "POST"});
      expect(read.status, `${side} override on GET`).to.equal(200);
      expect(read.token, `${side} override on GET`).to.equal(mine.token);
      // OPTIONS is safe: not refused, and it carries the session's token
      const options = await call(server, "OPTIONS", SYSINFO, {cookie: mine.cookie});
      expect(options.status, `${side} OPTIONS`).to.not.equal(403);
      expect(options.token, `${side} OPTIONS`).to.equal(mine.token);
      // a method in mixed case never reaches a route as a write: the HTTP
      // parser refuses it before either side runs (ABAP Unit covers the
      // handler's own upper-casing, a_mixed_case_method)
      const mixed = await raw(server, "Post", SYSINFO, {cookie: mine.cookie});
      expect(mixed.status, `${side} Post`).to.be.within(400, 499);
      for (const token of tokens) expect(mixed.all + mixed.body, `${side} Post`).to.not.contain(token);
      // a HEAD with a body is a HEAD: answered as the GET, no write route
      const head = await raw(server, "HEAD", SYSINFO, {cookie: mine.cookie, "content-type": "text/plain"}, "payload");
      expect(head.status, `${side} HEAD with a body`).to.equal(200);
      expect(head.token, `${side} HEAD with a body`).to.equal(mine.token);
      expect(head.body, `${side} HEAD with a body`).to.equal("");
      // a session that ended, with its old cookie and token
      if (side === "node") {
        await call(server, "GET", "/sap/public/bc/icf/logoff", {cookie: mine.cookie});
      } else if (remoteSessions !== undefined) {
        await remoteSessions.end(mine.cookie.split("=")[1].split(";")[0]);
      } else {
        await double["zif_osd_adt_session$end"]({iv_id: mine.cookie.split("=")[1].split(";")[0]});
      }
      refused(await call(server, "POST", SYSINFO, {cookie: mine.cookie, "x-csrf-token": mine.token}),
        `${side} ended session`, tokens);
    }
  });

  it("the Set-Cookie lines: Node sends two, the open-abap response entity keeps one per name", async () => {
    // Port-map risk 5, measured: cl_http_entity's set_header_field replaces a
    // header of the same name and set_cookie is a todo stub, so the second
    // Set-Cookie line of the handler's record does not survive the shim. The
    // one that survives names the session, which is why the cases above can
    // log on; docs/adt-abap-port/slice-3-front.md lists it as the first thing
    // the front needs before it moves up. When it is fixed this case flips.
    const expected = await call(node, "GET", SYSINFO, {"x-csrf-token": "fetch"});
    const actual = await call(abap, "GET", SYSINFO, {"x-csrf-token": "fetch"});
    expect(expected.cookies).to.have.length(2);
    expect(actual.cookies).to.have.length(remoteRuntime === undefined ? 1 : 2);
    expect(actual.cookies.find(c => c.startsWith("SAP_SESSIONID_"))).to.match(/^SAP_SESSIONID_OSD_001=[0-9a-f]{24}; Path=\/; HttpOnly; SameSite=Strict$/);
  });
});
