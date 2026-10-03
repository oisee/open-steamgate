import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EventEmitter, once} from "node:events";
import {adtRouter} from "../tools/adt-facade.mjs";
import {RemoteSessions} from "../tools/adt-remote-sessions.mjs";
import {abapFront, abapRunner} from "../tools/adt-abap-front.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {StoreDestination, withSystem} from "../tools/osd-store-destination.mjs";
import {attachStoreIPC, StoreIPCClient, withStoreIPC, PARENT_SYSTEM_KINDS, CHILD_SYSTEM_KINDS} from "../tools/osd-store-ipc.mjs";
import {stepJSON} from "../tools/adt-remote-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {Data} from "../tools/osd-data.mjs";

const BASE = "/sap/bc/adt";
const listen = (app) => new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
const until = async (work) => {
  for (let i = 0; i < 200; i++) { if (await work()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error("condition did not settle");
};

describe("ADT one runtime B1/B2: remote wire and STORE IPC", function () {
  this.timeout(60000);
  let root, runtime, store, servers, remote, node, nodeSessions;
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
      const facade = adtRouter({store, data: {}, watch: false, logMisses: false, transpileOnActivate: false, abap: runner});
      if (runner !== undefined) nodeSessions = facade.sessions;
      app.use(facade.router);
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
    await runtime.ensure();
    const url = runtime.url;
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
    const probe = await fetch(url + "/osd/classrun", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_ENQ_PROBE"})});
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

  const logon = async () => {
    const login = await request(remote, "HEAD", BASE + "/core/discovery", {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"});
    const cookie = login.cookies.map(c => c.split(";")[0]).join("; ");
    return {session: await nodeSessions.get(/sap-contextid=([^;]+)/.exec(cookie)[1]),
      headers: {cookie, "x-csrf-token": login.token, "x-sap-adt-sessiontype": "stateful"}};
  };

  it("B3: child ABAP LOCK and Node holderOf see each other in both directions", async () => {
    const {session, headers} = await logon();
    const object = BASE + "/programs/programs/zosd_remote";
    try {
      const locked = await request(remote, "POST", object + "?_action=LOCK&accessMode=MODIFY", headers);
      expect(locked.served).to.equal("ABAP");
      const handle = /<LOCK_HANDLE>([^<]+)/.exec(locked.body)[1];
      expect((await nodeSessions.holderOf("PROG", "ZOSD_REMOTE")).handle).to.equal(handle);
      await nodeSessions.unlock(session, handle);
      const taken = await nodeSessions.lock(session, "PROG", "ZOSD_REMOTE");
      const again = await request(remote, "POST", object + "?_action=LOCK&accessMode=MODIFY", headers);
      expect(again.served).to.equal("ABAP");
      expect(/<LOCK_HANDLE>([^<]+)/.exec(again.body)[1]).to.equal(taken.handle);
      await nodeSessions.release("PROG", "ZOSD_REMOTE");
      expect(await nodeSessions.holderOf("PROG", "ZOSD_REMOTE")).to.equal(undefined);
    } finally { await nodeSessions.end(session.id); }
  });

  it("B3: logoff-first stale write snapshot cannot run the parent callback", async () => {
    const {session} = await logon();
    const {handle} = await nodeSessions.lock(session, "PROG", "ZOSD_REMOTE");
    // The snapshot still says it holds; the authoritative child has ended it.
    await nodeSessions.end(session.id);
    let writes = 0;
    expect(await nodeSessions.whileHeld(session, handle, "PROG", "ZOSD_REMOTE", () => { writes++; })).to.equal(false);
    expect(writes).to.equal(0);
  });

  it("B3: PUT behind logoff refuses its stale HOST snapshot without writing", async () => {
    const {session, headers} = await logon();
    const object = BASE + "/programs/programs/zosd_remote";
    const locked = await request(remote, "POST", object + "?_action=LOCK&accessMode=MODIFY", headers);
    const handle = /<LOCK_HANDLE>([^<]+)/.exec(locked.body)[1];
    const original = nodeSessions.whileHeld;
    const source = store.read("PROG", "ZOSD_REMOTE").source;
    nodeSessions.whileHeld = async (...args) => {
      await nodeSessions.end(session.id);
      return original.apply(nodeSessions, args);
    };
    try {
      const answer = await request(remote, "PUT", object + `/source/main?lockHandle=${handle}`,
        {...headers, "content-type": "text/plain"}, "REPORT zosd_remote.\n* must not write\n");
      expect(answer.status, answer.body).to.equal(409);
      expect(store.read("PROG", "ZOSD_REMOTE").source).to.equal(source);
    } finally { nodeSessions.whileHeld = original; }
  });

  it("B3: DELETE behind logoff refuses after its HOST verdict and leaves the object", async () => {
    const {session, headers} = await logon();
    const original = nodeSessions.deleteObject;
    let called = false;
    nodeSessions.deleteObject = async (...args) => {
      called = true;
      await nodeSessions.end(session.id);
      return original.apply(nodeSessions, args);
    };
    try {
      const answer = await request(remote, "DELETE", BASE + "/programs/programs/zosd_remote", headers);
      expect(called).to.equal(true);
      expect(answer.status, answer.body).to.equal(403);
      expect(store.find("PROG", "ZOSD_REMOTE")).to.not.equal(undefined);
    } finally { nodeSessions.deleteObject = original; }
  });

  it("B3: delete callback holds the FIFO through parent deletion and releases its handle", async () => {
    await runtime.ensure();
    const url = runtime.url;
    const {session} = await logon();
    const taken = await nodeSessions.lock(session, "PROG", "ZOSD_DELETE");
    let enter, release;
    const events = [];
    const entered = new Promise(r => { enter = r; });
    const go = new Promise(r => { release = r; });
    const deleting = nodeSessions.deleteObject(session, "PROG", "ZOSD_DELETE", {
      find: () => ({name: "ZOSD_DELETE"}),
      delete: async () => { enter(); await go; events.push("deleteDone"); return {type: "PROG", name: "ZOSD_DELETE"}; },
    });
    let off;
    try {
      await entered;
      off = nodeSessions.end(session.id).then(() => { events.push("ended"); });
      // The only other step is logoff: prove it reached the child FIFO.
      await until(async () => {
        const response = await fetch(url + "/osd/serving");
        const {workProcess} = await response.json();
        return workProcess.held && workProcess.waiting === 1;
      });
      expect(events).to.deep.equal([]);
      release();
      expect(await deleting).to.deep.equal({gone: {type: "PROG", name: "ZOSD_DELETE"}});
      await off;
      expect(events).to.deep.equal(["deleteDone", "ended"]);
      expect(await nodeSessions.holderOf("PROG", "ZOSD_DELETE")).to.equal(undefined);
      expect(taken.handle).to.be.a("string");
    } finally { release(); await deleting; await off; }
  });

  it("B3: callback failure releases the FIFO and removes its context", async () => {
    const {session} = await logon();
    const {handle} = await nodeSessions.lock(session, "PROG", "ZOSD_REMOTE");
    const error = await nodeSessions.whileHeld(session, handle, "PROG", "ZOSD_REMOTE", () => {
      throw new Error("parent write failed");
    }).then(() => undefined, e => e);
    expect(error.message).to.contain("parent write failed");
    expect(runtime.adtContexts.size).to.equal(0);
    await nodeSessions.end(session.id);
    expect(await nodeSessions.holderOf("PROG", "ZOSD_REMOTE")).to.equal(undefined);
  });

  it("B3: graceful recycle drains a held callback and carries its lock", async () => {
    const {session} = await logon();
    const {handle} = await nodeSessions.lock(session, "PROG", "ZOSD_REMOTE");
    let enter, release, calls = 0, recycling;
    const entered = new Promise(r => { enter = r; });
    const go = new Promise(r => { release = r; });
    const pending = nodeSessions.whileHeld(session, handle, "PROG", "ZOSD_REMOTE", async () => {
      enter(); await go; calls++;
      store.write("PROG", "ZOSD_REMOTE", "REPORT zosd_remote.\n* carried write\n");
    }).then(value => ({value}), error => ({error}));
    try {
      await entered;
      const pid = runtime.child.pid;
      recycling = runtime.recycle();
      recycling.catch(() => undefined);
      // Outlast server-close grace plus leave's FIFO grace.
      await new Promise(r => setTimeout(r, 2 * runtime.grace + 250));
      release();
      expect(await pending).to.deep.equal({value: true});
      await recycling;
      expect(runtime.child.pid).to.not.equal(pid);
      expect((await nodeSessions.holderOf("PROG", "ZOSD_REMOTE"))?.handle).to.equal(handle);
      expect(store.read("PROG", "ZOSD_REMOTE").source).to.contain("carried write");
      expect(calls).to.equal(1);
    } finally {
      release(); await pending; await recycling;
      await nodeSessions.end(session.id);
    }
  });

  it("B3: stop overtakes a recycle waiting for a held callback", async () => {
    const {session} = await logon();
    const {handle} = await nodeSessions.lock(session, "PROG", "ZOSD_REMOTE");
    let enter, release;
    const entered = new Promise(r => { enter = r; });
    const go = new Promise(r => { release = r; });
    const pending = nodeSessions.whileHeld(session, handle, "PROG", "ZOSD_REMOTE", async () => {
      enter(); await go;
    }).catch(() => undefined);
    const grace = runtime.grace;
    try {
      await entered;
      runtime.grace = 50;
      const recycled = runtime.recycle().then(() => undefined, error => error);
      await new Promise(r => setTimeout(r, 30));
      await runtime.stop();
      expect((await recycled).message).to.equal("stopped while recycling");
      expect(runtime.child).to.equal(undefined);
      expect(runtime.adtContexts.size).to.equal(0);
    } finally {
      release(); await pending; runtime.grace = grace;
      await runtime.ensure();
    }
  });

  it("B3: a failed step after parent deletion releases the surviving handle", async () => {
    const {session} = await logon();
    await nodeSessions.lock(session, "PROG", "ZOSD_DELETE_ERROR");
    let deleted = false, calls = 0;
    const error = await nodeSessions.deleteObject(session, "PROG", "ZOSD_DELETE_ERROR", {
      find: () => deleted ? undefined : {name: "ZOSD_DELETE_ERROR"},
      delete: () => {
        deleted = true; calls++;
        // IPC serialization fails after deletion, before the child can forget.
        return {type: "PROG", name: "ZOSD_DELETE_ERROR", unserializable: 1n};
      },
    }).then(() => undefined, e => e);
    try {
      expect(error).to.be.instanceOf(Error);
      expect(deleted).to.equal(true);
      expect(calls).to.equal(1);
      expect(await nodeSessions.holderOf("PROG", "ZOSD_DELETE_ERROR")).to.equal(undefined);
    } finally { await nodeSessions.end(session.id); }
  });

  it("B3: crash during a callback releases the old step without replaying the write", async () => {
    const {session} = await logon();
    const {handle} = await nodeSessions.lock(session, "PROG", "ZOSD_REMOTE");
    let enter, release, calls = 0;
    const entered = new Promise(r => { enter = r; });
    const go = new Promise(r => { release = r; });
    const pending = nodeSessions.whileHeld(session, handle, "PROG", "ZOSD_REMOTE", async () => {
      calls++; enter(); await go;
    }).then(() => "resolved", () => "rejected");
    try {
      await entered;
      const child = runtime.child;
      child.kill("SIGKILL");
      expect(await pending).to.equal("rejected");
      // A socket error can precede exit; ensure must see a departed child.
      if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
      expect(runtime.adtContexts.size).to.equal(0);
      await runtime.ensure();
      expect(runtime.child.pid).to.not.equal(child.pid);
      expect(await nodeSessions.holderOf("PROG", "ZOSD_REMOTE")).to.equal(undefined);
      expect(calls).to.equal(1);
    } finally { release(); }
  });

  it("B3: the session door refuses invalid operations and the ABAP door refuses session envelopes", async () => {
    await runtime.ensure();
    const url = runtime.url;
    for (const [door, input] of [
      ["adt-sessions", {method: "constructor", args: []}],
      ["adt-sessions", {method: "end", args: []}],
      ["adt-step", {view: {sessionCall: "end", args: ["absent"]}}],
    ]) {
      const response = await fetch(url + "/osd/" + door, {method: "POST",
        headers: {"content-type": "application/json", "x-osd-adt-step-key": runtime.adtStepKey}, body: JSON.stringify(input)});
      expect(response.status).to.equal(400);
    }
  });

  it("B3: the session door bounds its JSON body to 1 MB", async () => {
    await runtime.ensure();
    const url = runtime.url;
    const response = await fetch(url + "/osd/adt-sessions", {method: "POST",
      headers: {"content-type": "application/json", "x-osd-adt-step-key": runtime.adtStepKey},
      body: JSON.stringify({method: "get", args: ["x".repeat(1024 * 1024)]})});
    expect(response.status).to.equal(413);
  });

  it("ACTIVATE says live after the step and cannot publish while the child is held", async () => {
    await runtime.ensure();
    const url = runtime.url;
    let release, entered, publishes = 0;
    const held = new Promise(r => { entered = r; });
    const go = new Promise(r => { release = r; });
    const previous = runtime.storeDestination;
    runtime.storeDestination = new StoreDestination({store: {root,
      activate: () => ({active: true, issues: []}), completeActivation: () => true,
      publish: async () => { publishes++; return {ok: true, recycled: true}; }}});
    runtime.systemAnswers = async kind => { if (kind === "BUILD") { entered(); await go; return {ok: true}; } };
    try {
      const pending = fetch(url + "/osd/classrun", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_ADT_STORE_PROBE"})});
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
    await runtime.ensure();
    const url = runtime.url;
    const before = runtime.child.pid;
    const overrides = {activate: store.activate, publish: store.publish, completeActivation: store.completeActivation};
    let publishes = 0;
    store.activate = () => ({active: true, issues: []});
    store.completeActivation = () => true;
    store.publish = async () => { publishes++; await runtime.recycle(); return {ok: true, recycled: true}; };
    try {
      const response = await fetch(url + "/sap/bc/osd/edit/", {method: "POST",
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

  for (const [name, type, key, status] of [
    ["missing key", "application/json", undefined, 403],
    ["wrong key", "application/json", "wrong", 403],
    ["text/plain", "text/plain", "valid", 415],
  ]) {
    it(`the internal door refuses ${name}`, async () => {
      await runtime.ensure();
      const url = runtime.url;
      const headers = {"content-type": type};
      if (key) headers["x-osd-adt-step-key"] = key === "valid" ? runtime.adtStepKey : key;
      for (const door of ["adt-step", "adt-sessions"]) {
        const response = await fetch(url + "/osd/" + door, {method: "POST", headers, body: "{}"});
        expect(response.status).to.equal(status);
      }
    });
  }

  it("the door accepts an ABAP body larger than 8 MB", async () => {
    await runtime.ensure();
    const url = runtime.url;
    const response = await fetch(url + "/osd/adt-step", {method: "POST",
      headers: {"content-type": "application/json", "x-osd-adt-step-key": runtime.adtStepKey},
      body: JSON.stringify({view: {method: "GET", path: BASE + "/core/http/systeminformation", url: BASE + "/core/http/systeminformation", headers: {}}, bodyHex: "00".repeat(9 * 1024 * 1024)})});
    expect(response.status).to.equal(200);
  });

  it("the internal door rejects invalid views and byte hex", async () => {
    await runtime.ensure();
    const url = runtime.url;
    for (const input of [{}, {view: {}}, {view: {method: "GET", path: BASE, url: BASE, headers: {}}, bodyHex: "f"}]) {
      const response = await fetch(url + "/osd/adt-step", {method: "POST", headers: {"content-type": "application/json", "x-osd-adt-step-key": runtime.adtStepKey}, body: JSON.stringify(input)});
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

describe("remote activation publication", () => {
  for (const failure of ["publish", "promotion"]) {
    it(`waits for ${failure} failure and returns the ADT failure document`, async () => {
      const child = new EventEmitter();
      child.connected = true;
      const context = 1;
      let release, started;
      const entered = new Promise(r => { started = r; });
      const go = new Promise(r => { release = r; });
      const runtime = {child, url: "http://unused", ensure: async () => {}};
      runtime.storeDestination = new StoreDestination({store: {root: "/tmp",
        activate: () => ({active: true, issues: []}),
        publish: async () => { started(); await go; return {ok: failure !== "publish", transpile: {error: "build failed"}}; },
        completeActivation: () => failure !== "promotion"}});
      attachStoreIPC(child, runtime);
      const original = globalThis.fetch;
      child.send = () => child.emit("message", {type: "store-step-ended", step: 1, ok: true});
      globalThis.fetch = async () => {
        child.emit("message", {type: "store-request", id: 1, context, step: 1,
          parameters: {IV_COMMAND: "ACTIVATE", IV_TYPE: "PROG", IV_NAME: "ZTEST"}});
        await entered;
        return new Response(JSON.stringify({record: {status: 200, headers: [], contentType: "application/xml", body: "success"}}), {headers: {"content-type": "application/json"}});
      };
      try {
        let settled = false;
        const answer = abapRunner({remote: runtime}).execute({body: Buffer.alloc(0), method: "POST", path: BASE + "/activation"}, {},
          {sessions: {identity: {}}, system: () => undefined}).then(r => { settled = true; return r; });
        await entered;
        await new Promise(r => setTimeout(r, 20));
        expect(settled, "response must wait for publication").to.equal(false);
        release();
        const record = await answer;
        expect(record.status).to.equal(200);
        expect(record.body.toString()).to.contain('activationExecuted="false"');
        expect(record.body.toString()).to.contain(failure === "publish" ? "build failed" : "source changed during activation");
      } finally { release(); globalThis.fetch = original; child.emit("exit"); }
    });
  }
});

describe("step response decoding", () => {
  it("maps a non-JSON body-parser 413 to an ADT 413", async () => {
    let error;
    try { await stepJSON(new Response("too large", {status: 413, headers: {"content-type": "text/html"}})); }
    catch (e) { error = e; }
    expect(error.status).to.equal(413);
  });
});

describe("STORE long commands and non-dialog activation", () => {
  it("BUILD and ACTIVATE wait for reply or disconnect without a 120 s timer", async () => {
    const channel = new EventEmitter();
    channel.connected = true;
    channel.send = () => {};
    const client = new StoreIPCClient(channel);
    try {
      for (const parameters of [{IV_COMMAND: "ACTIVATE"}, {IV_COMMAND: "SYSTEM", IV_TYPE: "BUILD"}]) {
        const pending = client.request(parameters).catch(e => e.message);
        expect(client.pending.get(client.seq).timer).to.equal(undefined);
        channel.emit("disconnect");
        expect(await pending).to.contain("disconnected");
      }
    } finally { client.close(); }
  });

  it("ACTIVATE without a child step publishes immediately", async () => {
    const child = new EventEmitter();
    child.connected = true;
    let published = false;
    const runtime = {storeDestination: new StoreDestination({store: {root: "/tmp",
      activate: () => ({active: true, issues: []}), completeActivation: () => true,
      publish: async () => { published = true; return {ok: true}; }}})};
    attachStoreIPC(child, runtime);
    const reply = new Promise(resolve => { child.send = resolve; });
    child.emit("message", {type: "store-request", id: 1,
      parameters: {IV_COMMAND: "ACTIVATE", IV_TYPE: "PROG", IV_NAME: "ZTEST"}});
    try {
      const answer = await reply;
      expect(answer.error).to.equal(undefined);
      expect(published).to.equal(true);
      expect(answer.values.EV_ACTIVE).to.equal("X");
    } finally { child.emit("exit"); }
  });
});

describe("one-runtime SYSTEM kind gate", () => {
  for (const enabled of [false, true]) {
    it(`accepts resource kinds only with the switch on (${enabled ? "on" : "off"})`, async () => {
      const previous = process.env.OSD_ADT_ONE_RUNTIME;
      try {
        if (enabled) process.env.OSD_ADT_ONE_RUNTIME = "1";
        else delete process.env.OSD_ADT_ONE_RUNTIME;
        const destination = new StoreDestination({store: {}});
        for (const kind of [...PARENT_SYSTEM_KINDS, ...CHILD_SYSTEM_KINDS]) {
          const answer = await withSystem(() => ({owner: kind}), () => destination.execute({IV_COMMAND: "SYSTEM", IV_TYPE: kind}));
          if (enabled) expect(JSON.parse(answer.EV_JSON)).to.deep.equal({owner: kind});
          else expect(answer.EV_ERROR).to.equal(`unknown SYSTEM kind ${kind}`);
        }
      } finally {
        if (previous === undefined) delete process.env.OSD_ADT_ONE_RUNTIME;
        else process.env.OSD_ADT_ONE_RUNTIME = previous;
      }
    });
  }
});

describe("remote ADT body transport", () => {
  it("keeps HOST bodies in the parent and hexes only ABAP bodies", async () => {
    const original = globalThis.fetch;
    try {
      for (const bodyRequired of [false, true]) {
        const inputs = [];
        const runtime = {url: "http://unused", ensure: async () => {}};
        globalThis.fetch = async (_url, init) => {
          const input = JSON.parse(init.body);
          inputs.push(input);
          return new Response(JSON.stringify(input.bodyRequired ? {bodyRequired} :
            {record: {status: 200, headers: [], body: "ok"}}), {headers: {"content-type": "application/json"}});
        };
        await abapRunner({remote: runtime}).execute({body: Buffer.from("source"), method: "PUT", path: BASE, url: BASE}, {}, {sessions: {identity: {}}, system: () => undefined});
        expect(inputs).to.have.length(2);
        expect(inputs[0].bodyHex).to.equal(undefined);
        expect(inputs[1].bodyHex).to.equal(bodyRequired ? Buffer.from("source").toString("hex") : "");
      }
    } finally { globalThis.fetch = original; }
  });

  it("returns an ADT 413 for a non-JSON child 413", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("too large", {status: 413, headers: {"content-type": "text/html"}});
    try {
      const runner = abapRunner({remote: {url: "http://unused", ensure: async () => {}}});
      let refusal;
      await abapFront({...runner, sessions: {identity: {}}, system: () => undefined,
        refuse: (_res, status, code, message) => { refusal = {status, code, message}; }})
        ({method: "GET", originalUrl: BASE, headers: {}, body: Buffer.alloc(0)}, {}, () => {});
      expect(refusal).to.deep.equal({status: 413, code: "ExceptionInvalidRequest", message: "ADT request body too large"});
    } finally { globalThis.fetch = original; }
  });
});

// With the switch off, the added internal node is inert. Existing inline
// and JS routes keep the exact session implementation selected on main.
describe("B3 switch off", function () {
  this.timeout(60000);
  it("both internal doors remain disabled", async () => {
    const runtime = new ServingRuntime({root: process.cwd(), env: {
      OSD_ADT_ONE_RUNTIME: "0", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0",
    }});
    try {
      await runtime.start();
      for (const door of ["adt-step", "adt-sessions"]) {
        const response = await fetch(runtime.url + "/osd/" + door, {method: "POST",
          headers: {"content-type": "application/json"}, body: "{}"});
        expect(response.status).to.equal(404);
      }
    } finally { await runtime.stop(); }
  });
});

describe("B3 callback timeout context", () => {
  it("invalidates on the child timer, refuses further callbacks and logs late completion", async () => {
    const child = new EventEmitter();
    child.connected = true;
    const channel = new EventEmitter();
    channel.connected = true;
    channel.send = message => child.emit("message", message);
    let finish;
    const finished = new Promise(r => { finish = r; });
    child.send = message => {
      channel.emit("message", message);
      if (message.id === 1) finish(message);
    };
    let enter, release, fireTimer, calls = 0;
    const entered = new Promise(r => { enter = r; });
    const go = new Promise(r => { release = r; });
    const runtime = {adtContexts: new Map([[1, {callback: async () => {
      calls++; enter(); await go; return {};
    }}]])};
    attachStoreIPC(child, runtime);
    const client = new StoreIPCClient(channel);
    const originalTimer = globalThis.setTimeout;
    const originalWarn = console.warn;
    const warnings = [];
    let pending;
    try {
      console.warn = (...args) => warnings.push(args.join(" "));
      globalThis.setTimeout = (callback, ms) => {
        expect(ms).to.equal(120000);
        fireTimer = callback;
        return undefined;
      };
      pending = withStoreIPC(1, () => client.request({action: "work"}, "OSD_SESSION_CALLBACK"))
        .catch(error => error.message);
      globalThis.setTimeout = originalTimer;
      await entered;
      fireTimer();
      expect(await pending).to.contain("timed out");
      expect(runtime.adtContexts.size).to.equal(0);
      const refused = await withStoreIPC(1, () => client.request({action: "work"}, "OSD_SESSION_CALLBACK"))
        .catch(error => error.message);
      expect(refused).to.contain("context ended");
      expect(calls).to.equal(1);
      release();
      const lateReply = await finished;
      expect(warnings).to.have.length(1);
      expect(warnings[0]).to.contain("uncertain write");
      expect(lateReply.error).to.contain("context ended during work");
    } finally {
      release(); globalThis.setTimeout = originalTimer; console.warn = originalWarn;
      client.close(); child.emit("exit");
    }
  });
});
