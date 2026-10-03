import {expect} from "chai";
import {createRequire} from "node:module";
import {EventEmitter as NodeEmitter} from "node:events";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import express from "express";
import {adtRouter} from "../tools/adt-facade.mjs";
const {registerAbapFsBridge, startCredentials, EXTENSION_ID} = createRequire(import.meta.url)("../editors/vscode/abapfs-bridge.js");
class Emitter {
  bus = new NodeEmitter();
  event = (fn) => { this.bus.on("change", fn); return {dispose: () => this.bus.off("change", fn)}; };
  fire() { this.bus.emit("change"); }
  dispose() { this.bus.removeAllListeners(); }
}
function fixture(api, answer, saved = new Map()) {
  const events = new Emitter();
  const controller = {onDidChange: events.event};
  let remote = {other: {url: "http://localhost", username: "EXAMPLE"}};
  const messages = [], writes = [];
  const context = {subscriptions: [], globalState: {
    get: (key, fallback) => saved.get(key) ?? fallback,
    update: async (key, value) => saved.set(key, value),
  }};
  const vscode = {EventEmitter: Emitter, ConfigurationTarget: {Global: 1},
    extensions: {getExtension: (id) => { expect(id).to.equal(EXTENSION_ID); return {activate: async () => api}; }},
    window: {showInformationMessage: async (...args) => { messages.push(args); return answer; },
      showWarningMessage: (s) => messages.push(s)},
    workspace: {getConfiguration: (name) => { expect(name).to.equal("abapfs"); return {
      get: () => remote, update: async (key, value, scope) => {
        expect(key).to.equal("remote"); expect(scope).to.equal(1); remote = value; writes.push(value);
      },
    }; }},
  };
  return {controller, events, context, vscode, messages, writes, saved,
    start() { controller.launcher = {state: "running", port: 8080, adtCredentials: startCredentials({OSD_USER: "LOCAL_TEST", OSD_ADT_CLIENT: "002"})}; events.fire(); return controller.launcher.adtCredentials; },
    stop() { controller.launcher.state = "stopped"; events.fire(); },
  };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));
describe("ABAP-FS local bridge", () => {
  it("publishes one connection only while running, rotates credentials, and disposes", async () => {
    let provider, changes = 0;
    const f = fixture({version: 2, registerConnectionProvider: (p) => {
      provider = p; expect(p.getConnections()).to.deep.equal([]);
      return p.onDidChange(() => changes++);
    }});
    await registerAbapFsBridge(f.vscode, f.context, f.controller);
    const first = f.start();
    const connection = provider.getConnections()[0];
    expect(provider.getConnections()).to.have.length(1);
    expect(connection).to.include({name: "OSD (local)", autoConnect: true, client: "002", user: "LOCAL_TEST"});
    expect(connection.auth.kind).to.equal("provider");
    expect(await connection.auth.getHeaders()).to.deep.equal({Authorization: `Bearer ${first.token}`});
    f.events.fire(); expect(changes).to.equal(1);
    f.stop(); expect(provider.getConnections()).to.deep.equal([]);
    expect(await connection.auth.getHeaders()).to.deep.equal({});
    const second = f.start(); expect(second.token).not.to.equal(first.token);
    expect(second.token).to.match(/^[A-Za-z0-9_-]{43}$/);
    expect(await provider.getConnections()[0].auth.getHeaders()).to.deep.equal({Authorization: `Bearer ${second.token}`});
    expect(changes).to.equal(3);
    expect(JSON.stringify([f.messages, f.writes, [...f.saved]])).not.to.contain(first.token).and.not.to.contain(second.token);
    for (const disposable of f.context.subscriptions) disposable.dispose();
    expect(provider.getConnections()).to.deep.equal([]);
  });
  it("publishes an already running system in the registration's initial snapshot", async () => {
    const f = fixture({version: 2, registerConnectionProvider: (p) => {
      expect(p.getConnections()).to.have.length(1); return {dispose() {}};
    }});
    f.start(); await registerAbapFsBridge(f.vscode, f.context, f.controller);
  });
  for (const answer of ["Add", "Not now", undefined]) {
    it(`remembers the legacy offer (${answer}) across starts and activation; never writes passwords`, async () => {
      const f = fixture({version: 1}, answer);
      await registerAbapFsBridge(f.vscode, f.context, f.controller);
      const token = f.start().token; await settled();
      f.stop(); f.start(); await settled();
      expect(f.messages).to.have.length(1);
      expect(f.messages[0]).to.deep.equal(['Add "OSD (local)" to ABAP-FS? Any password works locally.', "Add", "Not now"]);
      expect(f.writes).to.have.length(answer === "Add" ? 1 : 0);
      if (answer === "Add") {
        expect(f.writes[0]["OSD (local)"]).to.deep.equal({url: "http://127.0.0.1:8080", client: "002", username: "LOCAL_TEST", language: "EN"});
        expect(f.writes[0]).to.have.property("other");
      }
      expect(JSON.stringify([f.writes, f.messages, [...f.saved]])).not.to.contain(token).and.not.to.contain('"password"');
      const again = fixture({}, "Add", f.saved); again.start();
      await registerAbapFsBridge(again.vscode, again.context, again.controller); await settled();
      expect(again.messages).to.deep.equal([]);
    });
  }
  it("ignores missing or failed optional ABAP-FS installations", async () => {
    const f = fixture({});
    f.vscode.extensions.getExtension = () => undefined;
    await registerAbapFsBridge(f.vscode, f.context, f.controller);
    f.vscode.extensions.getExtension = () => ({activate: async () => { throw Error("private"); }});
    await registerAbapFsBridge(f.vscode, f.context, f.controller);
    expect(f.context.subscriptions).to.deep.equal([]); expect(f.messages).to.deep.equal([]);
  });
  it("accepts loopback bearer as configured user; rejects wrong/old tokens even with a session cookie; captures contain no token", async () => {
    const root = mkdtempSync(join(tmpdir(), "osd-bearer-"));
    const dump = join(root, "capture.ndjson");
    let server;
    const first = startCredentials({});
    const second = startCredentials({});
    try {
      const made = adtRouter({root, watch: false, data: {}, localToken: second.token, dump, userName: "LOCAL_TEST"});
      const app = express(); app.use(made.router);
      server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      const url = `http://127.0.0.1:${server.address().port}/sap/bc/adt/discovery`;
      const accepted = await fetch(url, {headers: {Authorization: `Bearer ${second.token}`}});
      expect(accepted.status).to.equal(200); await accepted.text();
      expect([...made.sessions.byId.values()][0].user).to.equal("LOCAL_TEST");
      const cookie = accepted.headers.get("set-cookie");
      for (const token of [first.token, "wrong", ""]) {
        const refused = await fetch(url, {headers: {Authorization: `Bearer ${token}`, Cookie: cookie}});
        expect(refused.status).to.equal(401);
        expect(await refused.text()).not.to.contain(token || second.token);
      }
      const basic = await fetch(url, {headers: {Authorization: `Basic ${Buffer.from("EXAMPLE:anything").toString("base64")}`}});
      expect(basic.status).to.equal(200); await basic.text(); await settled();
      expect(readFileSync(dump, "utf8")).not.to.contain(second.token).and.not.to.contain(first.token);
      const gate = made.middleware.find((m) => m.id === "local-logon").fn;
      let status, next = false;
      gate({headers: {authorization: `Bearer ${second.token}`}, socket: {remoteAddress: "192.0.2.1"}}, {
        status(s) { status = s; return this; }, set() { return this; }, send() {},
      }, () => { next = true; });
      expect(status).to.equal(401); expect(next).to.equal(false);
    } finally { if (server) await new Promise((resolve) => server.close(resolve)); rmSync(root, {recursive: true, force: true}); }
  });
});
