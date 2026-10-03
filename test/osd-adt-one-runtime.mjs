import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EventEmitter} from "node:events";
import {adtRouter} from "../tools/adt-facade.mjs";
import {RemoteSessions} from "../tools/adt-remote-sessions.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {StoreIPCClient} from "../tools/osd-store-ipc.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {Data} from "../tools/osd-data.mjs";

const BASE = "/sap/bc/adt";
const listen = (app) => new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const until = async (work) => {
  for (let i = 0; i < 200; i++) { if (work()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error("condition did not settle");
};

describe("ADT one runtime B1/B2: remote wire and STORE IPC", function () {
  this.timeout(60000);
  let root, runtime, store, servers, remote, node;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-one-runtime-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    writeFileSync(join(root, "src", "zosd_remote.prog.abap"), "REPORT zosd_remote.\n");
    store = new ObjectStore({root, libs: []});
    runtime = new ServingRuntime({root: process.cwd(), env: {OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
    runtime.storeDestination = new StoreDestination({store});
    await runtime.start();
    servers = [];
    for (const runner of [undefined, abapRunner({remote: runtime})]) {
      const app = express();
      app.use(express.raw({type: "*/*"}));
      app.use(adtRouter({store, data: {}, watch: false, logMisses: false, transpileOnActivate: false, abap: runner}).router);
      servers.push(await listen(app));
    }
    [node, remote] = servers.map(s => `http://127.0.0.1:${s.address().port}`);
  });
  after(async () => {
    for (const server of servers ?? []) await new Promise(r => server.close(r));
    await runtime?.stop();
    if (root) rmSync(root, {recursive: true, force: true});
  });
  const request = async (url, method, path, headers = {}, body) => {
    const res = await fetch(url + path, {method, headers, body});
    return {status: res.status, type: res.headers.get("content-type"), body: await res.text(), token: res.headers.get("x-csrf-token"),
      cookies: res.headers.getSetCookie(), served: res.headers.get("x-osd-served-by")};
  };
  const gate = ({status, type, body}) => ({status, type, body});

  it("static, sysinfo, versions, misses and CSRF refusals equal the Node facade", async () => {
    for (const [method, path] of [
      ["GET", "/core/http/systeminformation"], ["GET", "/compatibility/graph"],
      ["GET", "/repository/informationsystem/objecttypes"], ["GET", "/repository/informationsystem/virtualfolders/facets"],
      ["GET", "/programs/programs/zosd_remote/source/main/versions"],
      ["GET", "/programs/programs/absent/source/main/versions"], ["GET", "/one-runtime-missing"],
      ["POST", "/programs/programs/zosd_remote?_action=LOCK"], ["PUT", "/programs/programs/zosd_remote/source/main"],
    ]) {
      const expected = await request(node, method, BASE + path);
      const actual = await request(remote, method, BASE + path);
      expect(gate(actual), `${method} ${path}`).to.deep.equal(gate(expected));
      if (actual.status === 200) expect(actual.token).to.have.length(24);
    }
  });

  it("LOCK shares the child's ENQ table and its data preview; HOST write uses the same handle", async () => {
    const login = await request(remote, "HEAD", BASE + "/core/discovery", {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"});
    const cookie = login.cookies.map(c => c.split(";")[0]).join("; ");
    const headers = {cookie, "x-csrf-token": login.token, "x-sap-adt-sessiontype": "stateful"};
    const object = BASE + "/programs/programs/zosd_remote";
    const locked = await request(remote, "POST", object + "?_action=LOCK&accessMode=MODIFY", headers);
    expect(locked.status, locked.body).to.equal(200);
    const handle = /<LOCK_HANDLE>([^<]+)/.exec(locked.body)[1];
    const db = new Data({runtime});
    const rows = await db.query("SELECT id FROM zosd_adt_sess");
    expect(rows.rows.length).to.be.greaterThan(0);
    expect((await db.query("SELECT handle FROM zosd_adt_shdl")).rows.map(r => r.handle.trim())).to.include(handle);
    const probe = await fetch(runtime.url + "/osd/classrun", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_ENQ_PROBE"})});
    expect((await probe.json()).text.trim()).to.equal("1");
    const written = await request(remote, "PUT", object + `/source/main?lockHandle=${handle}`, {...headers, "content-type": "text/plain"}, "REPORT zosd_remote.\n* remote write\n");
    expect(written.status, written.body).to.equal(200);
    expect(store.read("PROG", "ZOSD_REMOTE").source).to.contain("remote write");
    const off = await request(remote, "GET", "/sap/public/bc/icf/logoff", headers);
    expect(off.status, off.body).to.equal(200);
    expect((await db.query("SELECT handle FROM zosd_adt_shdl")).rows).to.deep.equal([]);
  });

  it("a remote logoff queued before LOCK ends the session in its verdict step", async () => {
    const login = await request(remote, "HEAD", BASE + "/core/discovery", {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"});
    const cookie = login.cookies.map(c => c.split(";")[0]).join("; ");
    const headers = {cookie, "x-csrf-token": login.token, "x-sap-adt-sessiontype": "stateful"};
    const object = BASE + "/programs/programs/zosd_remote";
    const locked = await request(remote, "POST", object + "?_action=LOCK&accessMode=MODIFY", headers);
    const handle = /<LOCK_HANDLE>([^<]+)/.exec(locked.body)[1];
    const sessions = new RemoteSessions(runtime, {});
    const session = await sessions.get(/sap-contextid=([^;]+)/.exec(cookie)[1]);
    let release, entered;
    const started = new Promise(r => { entered = r; });
    const go = new Promise(r => { release = r; });
    const held = sessions.whileHeld(session, handle, "PROG", "ZOSD_REMOTE", async () => { entered(); await go; });
    try {
      await started;
      const logoff = request(remote, "GET", "/sap/public/bc/icf/logoff", headers);
      await new Promise(r => setTimeout(r, 50));
      const queued = request(remote, "POST", object + "?_action=LOCK&accessMode=MODIFY", headers);
      await new Promise(r => setTimeout(r, 50));
      release();
      expect(await held).to.equal(true);
      expect((await logoff).status).to.equal(200);
      expect((await queued).status).to.equal(403);
      expect(await sessions.get(session.id)).to.equal(undefined);
    } finally { release(); await held; }
  });

  it("ACTIVATE says live after the step and cannot publish while the child is held", async () => {
    let release, entered, publishes = 0;
    const held = new Promise(r => { entered = r; });
    const go = new Promise(r => { release = r; });
    const previous = runtime.storeDestination;
    runtime.storeDestination = new StoreDestination({store: {root,
      activate: () => ({active: true, issues: []}), completeActivation: () => true,
      publish: async () => { publishes++; return {ok: true, recycled: true}; }}});
    runtime.systemAnswers = async kind => { if (kind === "BUILD") { entered(); await go; return {ok: true}; } };
    try {
      const pending = fetch(runtime.url + "/osd/classrun", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_STORE_PROBE"})});
      await held;
      expect(publishes, "publish has not started inside the held child step").to.equal(0);
      release();
      const answer = await (await pending).json();
      expect(answer.ok, JSON.stringify(answer)).to.equal(true);
      expect(answer.text).to.contain("live after the step");
      expect(answer.text).to.contain('"sql":"SELECT id FROM zosd_adt_sess');
      expect(answer.text).to.contain('"columns":["name"]');
      await until(() => publishes === 1);
    } finally { release(); runtime.storeDestination = previous; runtime.systemAnswers = undefined; }
  });

  it("the G.8 editor activates through the parent and recycles only after its step", async () => {
    const before = runtime.child.pid;
    const overrides = {activate: store.activate, publish: store.publish, completeActivation: store.completeActivation};
    let publishes = 0;
    store.activate = () => ({active: true, issues: []});
    store.completeActivation = () => true;
    store.publish = async () => { publishes++; await runtime.recycle(); return {ok: true, recycled: true}; };
    try {
      const response = await fetch(runtime.url + "/sap/bc/osd/edit/", {method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams({type: "PROG", name: "ZOSD_REMOTE", change: "x", do: "activate", src: "REPORT zosd_remote.\n* G8\n"})});
      expect(response.status).to.equal(200);
      expect(await response.text()).to.contain("live after the step");
      await until(() => publishes === 1);
      await runtime.ensure();
      expect(runtime.child.pid).to.not.equal(before);
      expect(store.read("PROG", "ZOSD_REMOTE").source).to.contain("G8");
    } finally { Object.assign(store, overrides); }
  });

  it("an ADT read waits across a child crash instead of using its departed port", async () => {
    runtime.child.kill("SIGKILL");
    const response = await request(remote, "GET", BASE + "/core/http/systeminformation");
    expect(response.status, response.body).to.equal(200);
  });

  it("the internal door rejects invalid views and byte hex", async () => {
    for (const input of [{}, {view: {}}, {view: {method: "GET", path: BASE, url: BASE, headers: {}}, bodyHex: "f"}]) {
      const response = await fetch(runtime.url + "/osd/adt-step", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(input)});
      expect(response.status).to.equal(400);
    }
  });
});

describe("STORE IPC lifecycle", () => {
  it("correlates concurrent JSON replies and refuses pending calls on disconnect", async () => {
    const channel = new EventEmitter();
    channel.connected = true;
    const sent = [];
    channel.send = (message) => sent.push(message);
    const client = new StoreIPCClient(channel);
    try {
      const one = client.request({IV_COMMAND: "READ", IV_SOURCE: "a\n"});
      const two = client.request({IV_COMMAND: "LIST"});
      channel.emit("message", {type: "store-response", id: sent[1].id, values: {EV_COUNT: "2"}});
      channel.emit("message", {type: "store-response", id: sent[0].id, values: {EV_SOURCE: "a\n"}});
      expect(await one).to.deep.equal({EV_SOURCE: "a\n"});
      expect(await two).to.deep.equal({EV_COUNT: "2"});
      const pending = client.request({IV_COMMAND: "CHECK"}).then(() => "resolved", e => e.message);
      channel.emit("disconnect");
      expect(await pending).to.contain("disconnected");
      expect(client.pending.size).to.equal(0);
    } finally { client.close(); }
  });
});
