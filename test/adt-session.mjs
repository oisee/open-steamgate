import {remoteForTest} from "./helpers/adt-remote.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {expect} from "chai";
import express from "express";
import {spawnSync} from "node:child_process";
import {Sessions, REQUIRED, CONTEXT_COOKIE, SESSION_COOKIE} from "../tools/adt-session.mjs";
import {identity} from "../tools/osd-identity.mjs";

// The session layer on its own, without the façade around it: these are the
// rules an ADT client checks on every single answer, so they are worth
// failing loudly and in isolation.
describe("tools/adt-session: the token dance", function () {
  this.timeout(60000);
  let server;
  let port;
  let runtime;

  before(async () => {
    const app = express();
    const sessions = new Sessions();
    if (process.env.OSD_ADT_ONE_RUNTIME === "1") {
      runtime = await remoteForTest();
      // Let the continuation reach the two token-dance endpoints below.
      const {abapFront} = await import("../tools/adt-abap-front.mjs");
      const {RemoteSessions} = await import("../tools/adt-remote-sessions.mjs");
      const remoteSessions = new RemoteSessions(runtime, {});
      app.use(abapFront({...abapRunner({remote: runtime}), sessions: remoteSessions,
        system: kind => kind === "IDENTITY" ? remoteSessions.identity : undefined,
        refuse: (res, status, type, message) => res.status(status).send(message)}));
    } else app.use(sessions.middleware());
    app.get("/sap/bc/adt/core/discovery", (req, res) => res.type("application/atomsvc+xml").send("<service/>"));
    app.post("/sap/bc/adt/write", (req, res) => res.status(200).type("text/plain").send("written"));
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    port = server.address().port;
  });

  after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await runtime?.stop(); });

  const call = (path, options = {}) => fetch(`http://localhost:${port}${path}`, options);

  const cookiesOf = (res) => (res.headers.getSetCookie?.() ?? []).join("; ");

  it("a fetch answers with a token, and it is never the word that means there is none", async () => {
    const res = await call("/sap/bc/adt/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    expect(res.status).to.equal(200);
    const token = res.headers.get("x-csrf-token");
    expect(token).to.be.a("string").with.length.greaterThan(8);
    expect(token).to.not.equal(REQUIRED);
  });

  it("the session arrives as two cookies, the context and the session id", async () => {
    const res = await call("/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    const cookies = cookiesOf(res);
    expect(cookies).to.contain(CONTEXT_COOKIE + "=");
    expect(cookies).to.contain(SESSION_COOKIE + "=");
  });

  // the cookie of a real system is named after its id and its client, and
  // so is this one: the one id (tools/osd-identity.mjs), not a constant
  it("names the session cookie after the system id and the ADT client", () => {
    const who = identity();
    expect(SESSION_COOKIE).to.equal(`SAP_SESSIONID_${who.sid}_${who.adt.client}`);
    const nameUnder = (env) => {
      const clean = {...process.env};
      delete clean.OSD_SID;
      delete clean.STG_ADT_SID;
      const run = spawnSync(process.execPath, ["--input-type=module", "-e",
        "const m = await import(process.argv[1]); console.log(m.SESSION_COOKIE);",
        new URL("../tools/adt-session.mjs", import.meta.url).href], {env: {...clean, ...env}, encoding: "utf8"});
      expect(run.status, run.stderr).to.equal(0);
      return run.stdout.trim();
    };
    expect(nameUnder({}), "the default").to.equal("SAP_SESSIONID_OSD_001");
    expect(nameUnder({OSD_SID: "qrs"}), "the setting").to.equal("SAP_SESSIONID_QRS_001");
    expect(nameUnder({STG_ADT_SID: "osx"}), "its alias").to.equal("SAP_SESSIONID_OSX_001");
  });

  it("every answer carries a token, not only the one that asked for it", async () => {
    const res = await call("/sap/bc/adt/core/discovery");
    expect(res.headers.get("x-csrf-token")).to.be.a("string").with.length.greaterThan(8);
  });

  it("the context cookie keeps the same session, and so the same token", async () => {
    const first = await call("/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    const context = cookiesOf(first).match(new RegExp(CONTEXT_COOKIE + "=([^;]+)"))[1];
    const again = await call("/sap/bc/adt/core/discovery", {headers: {cookie: `${CONTEXT_COOKIE}=${context}`}});
    expect(again.headers.get("x-csrf-token")).to.equal(first.headers.get("x-csrf-token"));
  });

  it("an empty context cookie is a heal attempt and opens a fresh one", async () => {
    const first = await call("/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    const healed = await call("/sap/bc/adt/core/discovery", {headers: {cookie: CONTEXT_COOKIE + "="}});
    expect(healed.status).to.equal(200);
    expect(healed.headers.get("x-csrf-token")).to.not.equal(first.headers.get("x-csrf-token"));
    expect(cookiesOf(healed)).to.contain(CONTEXT_COOKIE + "=");
  });

  it("a write without a token is refused, and told which word to read", async () => {
    const res = await call("/sap/bc/adt/write", {method: "POST"});
    expect(res.status).to.equal(403);
    expect(res.headers.get("x-csrf-token")).to.equal(REQUIRED);
  });

  it("a write with the session's token goes through", async () => {
    const first = await call("/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    const context = cookiesOf(first).match(new RegExp(CONTEXT_COOKIE + "=([^;]+)"))[1];
    const res = await call("/sap/bc/adt/write", {
      method: "POST",
      headers: {cookie: `${CONTEXT_COOKIE}=${context}`, "x-csrf-token": first.headers.get("x-csrf-token")},
    });
    expect(res.status).to.equal(200);
  });

  it("a write with somebody else's token is refused", async () => {
    const res = await call("/sap/bc/adt/write", {method: "POST", headers: {"x-csrf-token": "not-the-token"}});
    expect(res.status).to.equal(403);
  });

  it("a stateful session keeps the same context across its requests", async () => {
    const first = await call("/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
    const context = cookiesOf(first).match(new RegExp(CONTEXT_COOKIE + "=([^;]+)"))[1];
    const again = await call("/sap/bc/adt/core/discovery", {
      headers: {cookie: `${CONTEXT_COOKIE}=${context}`, "x-sap-adt-sessiontype": "stateful"},
    });
    expect(cookiesOf(again)).to.contain(CONTEXT_COOKIE + "=" + context);
  });

  // The bug this pins cost a live session against Eclipse, and the client was
  // blameless throughout: an ABAP Cloud Project returns SAP_SESSIONID_* and
  // sap-usercontext and never sap-contextid, because it never asks for a
  // stateful session and the context cookie is what statefulness is kept in.
  // Reading only the context cookie made every request a new session with a
  // new token, so the token just handed out always belonged to a session that
  // no longer existed and every write was refused. Re-fetching could not help:
  // the fetch made a new session too.
  it("keeps one session for a client that returns only the session cookie", async () => {
    const first = await call("/sap/bc/adt/core/discovery", {headers: process.env.OSD_ADT_ONE_RUNTIME === "1" ? {"x-csrf-token": "fetch"} : {}});
    const cookie = cookiesOf(first).match(new RegExp(SESSION_COOKIE + "=([^;]+)"))[1];
    const token = first.headers.get("x-csrf-token");

    // the way a cloud project comes back: session cookie, no context cookie
    const carrying = {cookie: `${SESSION_COOKIE}=${cookie}`, "x-csrf-token": token};

    const again = await call("/sap/bc/adt/core/discovery", {headers: carrying});
    expect(again.headers.get("x-csrf-token"), "the token must survive the hop").to.equal(token);

    const wrote = await call("/sap/bc/adt/write", {method: "POST", headers: carrying});
    expect(wrote.status, "a write with that token must not be refused").to.not.equal(403);
  });

  it("nothing here ever redirects, because a client reads a redirect as a logout", async () => {
    for (const path of ["/sap/bc/adt/core/discovery", "/sap/bc/adt/write"]) {
      const res = await call(path, {method: path.endsWith("write") ? "POST" : "GET", redirect: "manual"});
      expect([301, 302, 303, 307, 308], path).to.not.include(res.status);
    }
  });

  // vsp's integration suite: LOCK (stateful), a stateless GET, then the PUT
  // with the handle was a 409 here and works on A4H. A stateless request is
  // one request without affinity, not the end of the session's locks.
  it("a stateless request keeps the session's locks and its statefulness", async () => {
    const app = express();
    const sessions = new Sessions();
    app.use(sessions.middleware());
    app.get("/sap/bc/adt/core/discovery", (req, res) => res.json({stateful: req.adt.session.stateful, locks: req.adt.session.locks.size}));
    const local = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      const url = `http://localhost:${local.address().port}/sap/bc/adt/core/discovery`;
      const first = await fetch(url, {headers: {"x-sap-adt-sessiontype": "stateful"}});
      const id = cookiesOf(first).match(new RegExp(CONTEXT_COOKIE + "=([^;]+)"))[1];
      const session = sessions.get(id);
      sessions.lock(session, "CLAS", "ZCL_X", () => "H1");
      const after = await (await fetch(url, {headers: {cookie: `${CONTEXT_COOKIE}=${id}`, "x-sap-adt-sessiontype": "stateless"}})).json();
      expect(after).to.deep.equal({stateful: true, locks: 1});
      expect(sessions.holderOf("CLAS", "ZCL_X")?.session).to.equal(session);
    } finally {
      await new Promise((resolve) => local.close(resolve));
    }
  });

  describe("the lock table: one holder per object across sessions", () => {
    it("both another session and the holder's second LOCK are refused", () => {
      const sessions = new Sessions();
      const alice = sessions.open("ALICE");
      const bob = sessions.open("BOB");
      const first = sessions.lock(alice, "CLAS", "ZCL_X", () => "H1");
      expect(first).to.deep.equal({handle: "H1"});
      expect(sessions.lock(alice, "CLAS", "zcl_x", () => "H2")).to.deep.equal({heldBy: alice});
      expect(sessions.holds(alice, "H1", "CLAS", "ZCL_X")).to.equal(true);
      const refused = sessions.lock(bob, "CLAS", "ZCL_X", () => "H3");
      expect(refused.handle).to.equal(undefined);
      expect(refused.heldBy.user).to.equal("ALICE");
      expect(bob.locks.size).to.equal(0);
    });

    it("UNLOCK releases the object for another session", () => {
      const sessions = new Sessions();
      const alice = sessions.open("ALICE");
      const bob = sessions.open("BOB");
      sessions.lock(alice, "CLAS", "ZCL_X", () => "H1");
      // somebody else's handle releases nothing
      sessions.unlock(bob, "H1");
      expect(sessions.lock(bob, "CLAS", "ZCL_X", () => "H2").heldBy).to.equal(alice);
      sessions.unlock(alice, "H1");
      expect(sessions.lock(bob, "CLAS", "ZCL_X", () => "H2")).to.deep.equal({handle: "H2"});
    });

    it("ending a session releases what it held", () => {
      const sessions = new Sessions();
      const alice = sessions.open("ALICE");
      const bob = sessions.open("BOB");
      sessions.lock(alice, "CLAS", "ZCL_X", () => "H1");
      sessions.end(alice.id);
      expect(sessions.get(alice.id)).to.equal(undefined);
      expect(sessions.lock(bob, "CLAS", "ZCL_X", () => "H2")).to.deep.equal({handle: "H2"});
    });

    it("an expired holder holds nothing, and asking does not keep it alive", () => {
      const sessions = new Sessions({ttlMs: 60000});
      const alice = sessions.open("ALICE");
      const bob = sessions.open("BOB");
      sessions.lock(alice, "CLAS", "ZCL_X", () => "H1");
      expect(sessions.holderOf("CLAS", "ZCL_X").session).to.equal(alice);
      alice.touched = Date.now() - 120000;
      expect(sessions.lock(bob, "CLAS", "ZCL_X", () => "H2")).to.deep.equal({handle: "H2"});
      expect(alice.locks.size).to.equal(0);
    });
  });

  it("a session nobody touched expires, and the next request gets a new one", async () => {
    const sessions = new Sessions({ttlMs: -1});
    const open = sessions.open("OSD");
    expect(sessions.get(open.id)).to.equal(undefined);
  });
});
