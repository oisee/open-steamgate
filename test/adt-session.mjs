import {expect} from "chai";
import express from "express";
import {Sessions, REQUIRED, CONTEXT_COOKIE, SESSION_COOKIE} from "../tools/adt-session.mjs";

// The session layer on its own, without the façade around it: these are the
// rules an ADT client checks on every single answer, so they are worth
// failing loudly and in isolation.
describe("tools/adt-session: the token dance", () => {
  let server;
  let port;

  before(async () => {
    const app = express();
    const sessions = new Sessions();
    app.use(sessions.middleware());
    app.get("/sap/bc/adt/core/discovery", (req, res) => res.type("application/atomsvc+xml").send("<service/>"));
    app.post("/sap/bc/adt/write", (req, res) => res.status(200).type("text/plain").send("written"));
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    port = server.address().port;
  });

  after(() => server.close());

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

  it("nothing here ever redirects, because a client reads a redirect as a logout", async () => {
    for (const path of ["/sap/bc/adt/core/discovery", "/sap/bc/adt/write"]) {
      const res = await call(path, {method: path.endsWith("write") ? "POST" : "GET", redirect: "manual"});
      expect([301, 302, 303, 307, 308], path).to.not.include(res.status);
    }
  });

  it("a session nobody touched expires, and the next request gets a new one", async () => {
    const sessions = new Sessions({ttlMs: -1});
    const open = sessions.open("OSD");
    expect(sessions.get(open.id)).to.equal(undefined);
  });
});
