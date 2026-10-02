import {expect} from "chai";
import express from "express";
import {spawn} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startServer} from "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {AbapSessions} from "../tools/adt-abap-sessions.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep, workProcess} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const BASE = "/sap/bc/adt";
const FIXTURE = `${BASE}/f2/fixture`;
const LOGOFF = "/sap/public/bc/icf/logoff";
const cookies = ["one=1; Path=/", "two=2; Path=/", "three=3; Path=/"];
const listen = (app) => new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const close = (server) => new Promise((resolve) => server.close(resolve));
const at = (server) => `http://127.0.0.1:${server.address().port}`;

describe("ADT F2: front wire replay and host readiness", function () {
  this.timeout(60000);
  let root, server, node, facade;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-f2-"));
    const routes = abap.Classes.ZCL_OSD_ADT_ROUTER.METHODS.DISPATCH.parameters.IT_ROUTES.type();
    for (const pattern of [FIXTURE, LOGOFF]) {
      const r = routes.appendInitial().get();
      r.method.set("GET"); r.pattern.set(pattern); r.handler.set("ZCL_OSD_ADT_ROUTE_F2"); r.served_by.set("ABAP");
    }
    await abap.Classes.ZCL_OSD_ADT_HANDLER.use_routes({it_routes: routes});
    const app = express();
    app.use(express.raw({type: "*/*"}));
    // Real ANSWER and dialog step; no session so fixture cookies are exact.
    const sessions = new AbapSessions();
    sessions.sessionFor = async () => undefined;
    facade = adtRouter({store: new ObjectStore({root, libs: []}), data: {}, watch: false, logMisses: false,
      abap: abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep}),
      sessions});
    app.use(facade.router);
    server = await listen(app);
    const oracle = express();
    oracle.get(FIXTURE, (req, res) => {
      res.status(Number(req.query.mode)).set("Content-Type", "text/plain; charset=utf-8")
        .set("Location", "/fixture/target").set("Set-Cookie", cookies).set("Content-Length", "13")
        .end(req.method === "HEAD" ? undefined : "fixture bytes");
    });
    node = await listen(oracle);
  });
  after(async () => {
    await abap.Classes.ZCL_OSD_ADT_HANDLER.use_routes({});
    if (server) await close(server);
    if (node) await close(node);
    if (root) rmSync(root, {recursive: true, force: true});
  });

  for (const status of [307, 201]) for (const method of ["GET", "HEAD"]) {
    it(`${status} ${method} replays byte-equal to Node without an ETag`, async () => {
      const ask = {method, redirect: "manual"};
      const actual = await fetch(`${at(server)}${FIXTURE}?mode=${status}`, ask);
      const expected = await fetch(`${at(node)}${FIXTURE}?mode=${status}`, ask);
      expect(actual.status).to.equal(expected.status);
      for (const name of ["content-type", "content-length", "etag", "location"]) {
        expect(actual.headers.get(name), name).to.equal(expected.headers.get(name));
      }
      expect(Buffer.from(await actual.arrayBuffer())).to.deep.equal(Buffer.from(await expected.arrayBuffer()));
    });
  }
  it("appends all three Set-Cookie lines in order", async () => {
    const res = await fetch(`${at(server)}${FIXTURE}?mode=307`, {redirect: "manual"});
    expect(res.headers.getSetCookie()).to.deep.equal(cookies);
  });
  it("mounts logoff outside ADT and enters ANSWER without session headers", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await fetch(`${at(server)}${LOGOFF}`, {method});
      expect(res.status).to.equal(200);
      expect(res.headers.get("x-osd-served-by")).to.equal("ABAP");
      expect(await res.text()).to.equal(method === "HEAD" ? "" : "fixture logoff");
      for (const name of ["set-cookie", "x-csrf-token", "x-osd-generation"]) expect(res.headers.get(name)).to.equal(null);
    }
  });
  it("passes Express qs values including repeated, bracketed and malformed escapes", async () => {
    const res = await fetch(`${at(server)}${FIXTURE}?mode=query&value=a+b&repeat=1&repeat=2&nested[x]=y&stray=%&bad=%zz`);
    expect(res.status).to.equal(200);
    expect(await res.text()).to.equal("mode=query;value=a b;repeat=1,2;nested=[object Object];stray=%;bad=%zz;");
  });
  it("strips ABAP's miss marker and records each kind and count in facade.missed", async () => {
    for (const kind of ["resource", "object"]) {
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${at(server)}${FIXTURE}?mode=miss&kind=${kind}`);
        expect(res.status).to.equal(404);
        expect(res.headers.get("x-osd-miss")).to.equal(null);
      }
      expect(facade.missed.get(`${kind} GET ${FIXTURE}`)).to.include({kind, method: "GET", path: FIXTURE, count: 2});
    }
    const none = await fetch(`${at(server)}${FIXTURE}?mode=miss&kind=none`);
    expect(none.headers.get("x-osd-miss")).to.equal(null);
    expect(facade.missed.size).to.equal(2);
  });
  it("osd ready answers while a gated step holds the work process", async () => {
    const host = startServer(true);
    let release, started;
    const running = new Promise((resolve) => { started = resolve; });
    const held = dialogStep(() => new Promise((resolve) => { release = resolve; started(); }), "F2 readiness gate");
    try {
      await running;
      expect(workProcess().held).to.equal(true);
      const res = await fetch(`http://127.0.0.1:${process.env.STG_PORT}/osd/ready`, {signal: AbortSignal.timeout(1500)});
      expect(res.status).to.equal(200);
      expect(await res.json()).to.deep.equal({ready: true});
      const exit = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["bin/osd.mjs", "ready"], {env: process.env, stdio: "ignore"});
        child.on("error", reject); child.on("exit", resolve);
      });
      expect(exit).to.equal(0);
      expect(workProcess().held).to.equal(true);
      expect(workProcess().waiting, "readiness queued no dialog step").to.equal(0);
    } finally {
      release?.(); await held;
      await host.close();
    }
  });
});
