import {expect} from "chai";
import {createRequire} from "node:module";
import {EventEmitter as NodeEmitter} from "node:events";
import {mkdtempSync, readdirSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import express from "express";
import {spawnSync as probe} from "node:child_process";
import {spawnSync, execFileSync, spawn, execFile} from "../tools/osd-child-process.mjs";
import {UnitRun} from "../tools/osd-unit.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
const {registerAbapFsBridge, startCredentials, EXTENSION_ID} = createRequire(import.meta.url)("../editors/vscode/abapfs-bridge.js");
class Emitter {
  bus = new NodeEmitter();
  event = (fn) => { this.bus.on("change", fn); return {dispose: () => this.bus.off("change", fn)}; };
  fire() { this.bus.emit("change"); }
  dispose() { this.bus.removeAllListeners(); }
}
const storageDirs = new WeakMap();
const createdDirs = [];
function fixture(api, answer, saved = new Map(), workspaceSaved = new Map()) {
  if (!storageDirs.has(saved)) {
    const dir = mkdtempSync(join(tmpdir(), "osd-bridge-"));
    storageDirs.set(saved, dir); createdDirs.push(dir);
  }
  const events = new Emitter();
  const controller = {onDidChange: events.event};
  let remote = {other: {url: "http://localhost", username: "EXAMPLE"}};
  const messages = [], writes = [];
  const context = {globalStorageUri: {fsPath: storageDirs.get(saved)}, subscriptions: [], globalState: {
    get: (key, fallback) => saved.get(key) ?? fallback,
    update: async (key, value) => saved.set(key, value),
  }};
  context.workspaceState = {
    get: (key, fallback) => workspaceSaved.get(key) ?? fallback,
    update: async (key, value) => workspaceSaved.set(key, value),
  };
  const vscode = {EventEmitter: Emitter, ConfigurationTarget: {Global: 1},
    extensions: {getExtension: (id) => { expect(id).to.equal(EXTENSION_ID); return {activate: async () => api}; }},
    window: {showInformationMessage: async (...args) => { messages.push(args); return answer; },
      showWarningMessage: (s) => messages.push(s)},
    workspace: {getConfiguration: (name) => { expect(name).to.equal("abapfs"); return {
      get: () => remote, inspect: () => ({globalValue: remote}), update: async (key, value, scope) => {
        expect(key).to.equal("remote"); expect(scope).to.equal(1); remote = value; writes.push(value);
      },
    }; }},
  };
  return {controller, events, context, vscode, messages, writes, saved, workspaceSaved,
    start() { controller.launcher = {state: "running", port: 8080, adtCredentials: startCredentials({OSD_USER: "LOCAL_TEST", OSD_ADT_CLIENT: "002"})}; events.fire(); return controller.launcher.adtCredentials; },
    stop() { controller.launcher.state = "stopped"; events.fire(); },
  };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));
describe("ABAP-FS local bridge", () => {
  after(() => { for (const dir of createdDirs) rmSync(dir, {recursive: true, force: true}); });
  it("limits the scrubbed child-process helper to deliberate serving-runtime uses", () => {
    const allowed = [
      "adt-facade.mjs", // HTTP boundary and its Git children.
      "osd-git-history.mjs", // Git children of ADT version/history requests.
      "osd-runtime.mjs", // Serving supervisor's runtime children.
      "osd-unit.mjs", // Unit/debug children launched by the serving runtime.
      "osd-warm.mjs", // Warm verification children launched by the serving runtime.
    ];
    const users = [];
    function scan(dir, prefix = "") {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) scan(join(dir, entry.name), name + "/");
        else if (/\.(?:mjs|cjs|js)$/.test(entry.name)
          && /\b(?:import|export)\b[^;]*["'][^"']*osd-child-process\.mjs["']|\brequire\s*\(\s*["'][^"']*osd-child-process\.mjs["']/.test(readFileSync(join(dir, entry.name), "utf8"))) {
          users.push(name);
        }
      }
    }
    scan(fileURLToPath(new URL("../tools/", import.meta.url)));
    expect(users.sort(), "new helper imports need an explicit allow-list entry and reason").to.deep.equal(allowed);
  });
  it("consumes the boundary credential once and retains it for subsequent routers", () => {
    const result = probe(process.execPath, ["--input-type=module", "-e", `
      import {adtRouter} from "./tools/adt-facade.mjs";
      if (process.env.OSD_ADT_TOKEN !== undefined) throw Error("credential retained in environment");
      for (let i = 0; i < 2; i++) {
        const made = adtRouter({watch: false, data: {}});
        const req = {headers: {authorization: "Bearer fixture-token"}, rawHeaders: [], socket: {remoteAddress: "127.0.0.1"}};
        let passed = false;
        made.middleware.find(m => m.id === "local-logon").fn(req, {
          status() { throw Error("credential lost"); }
        }, () => { passed = true; });
        if (!passed || !req.headers.authorization.startsWith("Basic ")) throw Error("credential lost");
      }
    `], {env: {...process.env, OSD_ADT_TOKEN: "fixture-token"}, encoding: "utf8"});
    expect(result.status, result.stderr).to.equal(0);
  });
  it("scrubs inherited and explicit child environments for synchronous and asynchronous launches", async () => {
    const previous = process.env.OSD_ADT_TOKEN;
    process.env.OSD_ADT_TOKEN = "fixture-token";
    const script = 'process.stdout.write(String(process.env.OSD_ADT_TOKEN))';
    try {
      for (const options of [{}, {env: {...process.env}}]) {
        expect(spawnSync(process.execPath, ["-e", script], {...options, encoding: "utf8"}).stdout).to.equal("undefined");
        expect(execFileSync(process.execPath, ["-e", script], {...options, encoding: "utf8"})).to.equal("undefined");
        const child = spawn(process.execPath, ["-e", script], options);
        let out = ""; child.stdout.on("data", d => { out += d; });
        await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
        expect(out).to.equal("undefined");
        const output = await new Promise((resolve, reject) => execFile(process.execPath, ["-e", script], options,
          (error, stdout) => error ? reject(error) : resolve(stdout)));
        expect(output).to.equal("undefined");
      }
      // Exercise the real detached Unit/debug launch with a probe as its host.
      const self = process.env.OSD_SELF;
      process.env.OSD_SELF = JSON.stringify([process.execPath, "-e", 'process.stdout.write(JSON.stringify({token: process.env.OSD_ADT_TOKEN ?? null}))']);
      try {
        const runner = new UnitRun({root: process.cwd()});
        expect(await runner.runDetached("CLAS", "EXAMPLE", {plan: {classes: []}, inspectPort: 0 + 32000 + Number(process.env.INSTANCE ?? 80)})).to.deep.equal({token: null});
      } finally { if (self === undefined) delete process.env.OSD_SELF; else process.env.OSD_SELF = self; }
      expect(process.env.OSD_ADT_TOKEN).to.equal("fixture-token");
    } finally { if (previous === undefined) delete process.env.OSD_ADT_TOKEN; else process.env.OSD_ADT_TOKEN = previous; }
  });
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
    expect(connection).to.include({id: "osd-local", name: "OSD (local)", autoConnect: true, client: "002", user: "LOCAL_TEST"});
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
  for (const answer of ["Not now", undefined]) {
    it(`offers a single-folder mount once and remembers ${answer} across activation`, async () => {
      let provider, connects = 0;
      const api = {version: 2, registerConnectionProvider: p => { provider = p; return {dispose() {}}; },
        connect: async () => connects++};
      const f = fixture(api, answer);
      f.vscode.workspace.workspaceFolders = [{name: "demo"}];
      await registerAbapFsBridge(f.vscode, f.context, f.controller);
      f.start(); await settled();
      expect(provider.getConnections()[0].autoConnect).to.equal(false);
      expect(f.messages).to.have.length(1);
      expect(f.messages[0][0]).to.contain("reload").and.contain("restart automatically");
      expect(f.messages[0].slice(1)).to.deep.equal(["Open OSD (local) in ABAP-FS", "Not now"]);
      f.stop(); f.start(); await settled();
      expect(f.messages).to.have.length(1); expect(connects).to.equal(0);
      for (const disposable of f.context.subscriptions) disposable.dispose();
      const again = fixture(api, "Open OSD (local) in ABAP-FS", f.saved, f.workspaceSaved);
      again.vscode.workspace.workspaceFolders = [{name: "demo"}];
      again.start(); await registerAbapFsBridge(again.vscode, again.context, again.controller); await settled();
      expect(again.messages).to.deep.equal([]); expect(connects).to.equal(0);
      expect(f.workspaceSaved.get("osd.abapfs.local.wasRunning")).not.to.equal(true);
    });
  }
  for (const [kind, folders, workspaceFile] of [
    ["empty", [], undefined], ["multi-root", [{}, {}], undefined],
    ["saved single-folder workspace", [{}], {path: "demo.code-workspace"}],
    ["untitled workspace", [{}], {scheme: "untitled"}],
  ]) {
    it(`auto-connects in a ${kind} window without an offer`, async () => {
      let provider;
      const f = fixture({version: 2, registerConnectionProvider: p => { provider = p; return {dispose() {}}; }});
      Object.assign(f.vscode.workspace, {workspaceFolders: folders, workspaceFile});
      f.start(); await registerAbapFsBridge(f.vscode, f.context, f.controller); await settled();
      expect(provider.getConnections()[0].autoConnect).to.equal(true);
      expect(f.messages).to.deep.equal([]);
    });
  }
  it("persists running intent before explicit mounting and restarts once after reload", async () => {
    let connects = 0, restarts = 0, provider;
    const f = fixture({version: 2, registerConnectionProvider: p => { provider = p; return {dispose() {}}; },
      connect: async id => {
        expect(id).to.equal("osd-local");
        expect(f.workspaceSaved.get("osd.abapfs.local.wasRunning")).to.equal(true);
        expect(provider.getConnections()[0].autoConnect).to.equal(false);
        connects++;
      }}, "Open OSD (local) in ABAP-FS");
    f.vscode.workspace.workspaceFolders = [{}];
    await registerAbapFsBridge(f.vscode, f.context, f.controller); f.start(); await settled();
    expect(connects).to.equal(1);
    for (const disposable of f.context.subscriptions) disposable.dispose();
    const again = fixture({version: 2, registerConnectionProvider: p => {
      expect(restarts).to.equal(1);
      expect(p.getConnections()[0]).to.include({id: "osd-local", autoConnect: true});
      return {dispose() {}};
    }}, undefined, f.saved, f.workspaceSaved);
    again.vscode.workspace.workspaceFolders = [{}, {}];
    again.vscode.workspace.workspaceFile = {scheme: "untitled"};
    again.controller.start = async () => { restarts++; again.start(); };
    await registerAbapFsBridge(again.vscode, again.context, again.controller);
    expect(f.workspaceSaved.get("osd.abapfs.local.wasRunning")).to.equal(undefined);
    expect(again.messages).to.deep.equal([]);
    const later = fixture({}, undefined, f.saved, f.workspaceSaved);
    later.controller.start = async () => restarts++;
    await registerAbapFsBridge(later.vscode, later.context, later.controller);
    expect(restarts).to.equal(1);
  });
  it("clears restart intent when explicit mounting fails", async () => {
    const f = fixture({version: 2, registerConnectionProvider: () => ({dispose() {}}),
      connect: async () => { throw Error("private provider error"); }}, "Open OSD (local) in ABAP-FS");
    f.vscode.workspace.workspaceFolders = [{}];
    await registerAbapFsBridge(f.vscode, f.context, f.controller); f.start(); await settled();
    expect(f.workspaceSaved.get("osd.abapfs.local.wasRunning")).to.equal(undefined);
    expect(f.messages[1]).to.equal("osd: Could not open the local ABAP-FS connection.");
  });
  it("does not mount a system stopped while the offer is open", async () => {
    let answer, connects = 0;
    const f = fixture({version: 2, registerConnectionProvider: () => ({dispose() {}}),
      connect: async () => connects++});
    f.vscode.workspace.workspaceFolders = [{}];
    f.vscode.window.showInformationMessage = () => new Promise(resolve => { answer = resolve; });
    await registerAbapFsBridge(f.vscode, f.context, f.controller); f.start(); await settled();
    f.stop(); answer("Open OSD (local) in ABAP-FS"); await settled();
    expect(connects).to.equal(0);
    expect(f.workspaceSaved.get("osd.abapfs.local.wasRunning")).not.to.equal(true);
  });
  it("recovers after reload even if ABAP-FS was removed, and consumes failed recovery", async () => {
    const f = fixture({});
    f.workspaceSaved.set("osd.abapfs.local.wasRunning", true);
    f.vscode.extensions.getExtension = () => undefined;
    let starts = 0;
    f.controller.start = async () => { starts++; throw Error("start failed"); };
    try { await registerAbapFsBridge(f.vscode, f.context, f.controller); }
    catch (error) { expect(error.message).to.equal("start failed"); }
    expect(starts).to.equal(1);
    await registerAbapFsBridge(f.vscode, f.context, f.controller);
    expect(starts).to.equal(1);
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
  it("rechecks dismissal for windows registered before either starts", async () => {
    const saved = new Map();
    const first = fixture({}, "Not now", saved), second = fixture({}, "Add", saved);
    await registerAbapFsBridge(first.vscode, first.context, first.controller);
    await registerAbapFsBridge(second.vscode, second.context, second.controller);
    first.start(); await settled();
    second.start(); await settled();
    expect(first.messages).to.have.length(1);
    expect(second.messages).to.deep.equal([]); expect(second.writes).to.deep.equal([]);
  });
  it("claims concurrent offers across windows with stale independent globalState caches before awaiting the answer", async () => {
    const first = fixture({}, "Not now"), second = fixture({}, "Add");
    second.context.globalStorageUri = first.context.globalStorageUri;
    let persist, answer;
    first.context.globalState.update = () => new Promise(resolve => { persist = resolve; });
    first.vscode.window.showInformationMessage = async (...args) => {
      first.messages.push(args); return new Promise(resolve => { answer = resolve; });
    };
    await registerAbapFsBridge(first.vscode, first.context, first.controller);
    await registerAbapFsBridge(second.vscode, second.context, second.controller);
    first.start(); second.start(); await settled();
    expect(second.messages).to.deep.equal([]);
    persist(); await settled();
    expect(first.messages).to.have.length(1); expect(second.messages).to.deep.equal([]);
    answer("Not now"); await settled();
    // A fresh activation with another stale cache also respects the claim.
    const third = fixture({}, "Add"); third.context.globalStorageUri = first.context.globalStorageUri;
    await registerAbapFsBridge(third.vscode, third.context, third.controller); third.start(); await settled();
    expect(third.messages).to.deep.equal([]);
  });
  it("merges the legacy connection only with user settings, preserving workspace secrets and overrides", async () => {
    const f = fixture({}, "Add");
    const globalValue = {shared: {url: "http://user.example", username: "USER"}};
    const workspaceValue = {shared: {url: "http://workspace.example", password: "workspace-secret"},
      workspaceOnly: {url: "http://workspace.example", password: "other-secret"}};
    f.vscode.workspace.getConfiguration = () => ({
      get: () => workspaceValue,
      inspect: key => { expect(key).to.equal("remote"); return {globalValue, workspaceValue}; },
      update: async (key, value, scope) => {
        expect(key).to.equal("remote"); expect(scope).to.equal(f.vscode.ConfigurationTarget.Global);
        f.writes.push(value);
      },
    });
    await registerAbapFsBridge(f.vscode, f.context, f.controller); f.start(); await settled();
    expect(f.writes).to.have.length(1);
    expect(f.writes[0].shared).to.deep.equal(globalValue.shared);
    expect(f.writes[0]).not.to.have.property("workspaceOnly");
    expect(JSON.stringify(f.writes)).not.to.contain("secret");
    expect(workspaceValue.shared.password).to.equal("workspace-secret");
    expect(globalValue).not.to.have.property("OSD (local)");
  });
  it("adds the legacy connection when there are no user remote settings", async () => {
    const f = fixture({}, "Add");
    f.vscode.workspace.getConfiguration = () => ({inspect: () => ({}),
      update: async (_key, value) => f.writes.push(value)});
    await registerAbapFsBridge(f.vscode, f.context, f.controller); f.start(); await settled();
    expect(Object.keys(f.writes[0])).to.deep.equal(["OSD (local)"]);
  });
  it("ignores missing or failed optional ABAP-FS installations", async () => {
    const f = fixture({});
    f.vscode.extensions.getExtension = () => undefined;
    await registerAbapFsBridge(f.vscode, f.context, f.controller);
    f.vscode.extensions.getExtension = () => ({activate: async () => { throw Error("private"); }});
    await registerAbapFsBridge(f.vscode, f.context, f.controller);
    expect(f.context.subscriptions).to.deep.equal([]); expect(f.messages).to.deep.equal([]);
  });
  it("validates logoff bearers and replaces the credential before the ABAP front", async () => {
    const root = mkdtempSync(join(tmpdir(), "osd-logoff-"));
    const seen = [];
    let server;
    try {
      const made = adtRouter({root, watch: false, data: {}, localToken: "fixture-token", userName: "LOCAL_TEST",
        abap: {execute: async (view, req) => {
          seen.push({authorization: view.headers.authorization, raw: [...req.rawHeaders]});
          return {servedBy: "ABAP", status: 200, contentType: "text/plain", headers: [], body: "logged off"};
        }}});
      const app = express(); app.use(made.router);
      server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      const url = `http://127.0.0.1:${server.address().port}/sap/public/bc/icf/logoff`;
      for (const token of ["wrong", "", "old-token"]) {
        const response = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
        expect(response.status).to.equal(401); await response.text();
      }
      expect(seen).to.deep.equal([]);
      const response = await fetch(url, {headers: {Authorization: "Bearer fixture-token"}});
      expect(response.status).to.equal(200); await response.text();
      expect(seen).to.have.length(1);
      expect(seen[0].authorization).to.equal(`Basic ${Buffer.from("LOCAL_TEST:").toString("base64")}`);
      expect(JSON.stringify(seen)).not.to.contain("fixture-token");
      const gate = made.middleware.find(m => m.id === "local-logon");
      expect(gate.path).to.include("/sap/public/bc/icf/logoff");
      let status, passed = false;
      gate.fn({headers: {authorization: "Bearer fixture-token"}, socket: {remoteAddress: "192.0.2.1"}}, {
        status(s) { status = s; return this; }, set() { return this; }, send() {},
      }, () => { passed = true; });
      expect(status).to.equal(401); expect(passed).to.equal(false);
    } finally {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      rmSync(root, {recursive: true, force: true});
    }
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
