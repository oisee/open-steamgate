import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {AbapSessions} from "../tools/adt-abap-sessions.mjs";
import {Sessions} from "../tools/adt-session.mjs";
import {EnqOwners} from "../tools/adt-enq.mjs";
import {resetAdtSessionClaimForTests} from "../tools/adt-enq-key.mjs";
import {adtEnqOwner} from "../tools/adt-enq-key.mjs";
import {endEnqSession} from "../tools/osd-enq-host.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";

const BASE = "/sap/bc/adt";
const SOURCE = `CLASS zcl_osd_adapter DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_osd_adapter IMPLEMENTATION.
ENDCLASS.
`;

async function scenario(kind) {
  resetAdtSessionClaimForTests();
  const root = mkdtempSync(join(tmpdir(), "osd-adapter-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "src/pkg"));
  writeFileSync(join(root, "src/zcl_osd_adapter.clas.abap"), SOURCE);
  writeFileSync(join(root, "src/pkg/package.devc.xml"), `<?xml version="1.0"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><DEVC><CTEXT>Adapter test</CTEXT></DEVC></asx:values>
 </asx:abap>
</abapGit>`);
  const sessions = kind === "abap" ? new AbapSessions() : new Sessions({owners: new EnqOwners()});
  const app = express();
  app.use(adtRouter({store: new ObjectStore({root, libs: [],
    roots: [{path: "src", package: "$STG_TEST", writable: true}]}), data: {}, watch: false,
    transpileOnActivate: false, sessions}).router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [{}, {}, {}, {}];
  const results = [];
  const handles = new Set();
  const call = async (client, method, path, extra = {}) => {
    const headers = {...extra.headers};
    if (client.id) headers.cookie = `sap-contextid=${client.id}`;
    if (client.token && !Object.hasOwn(headers, "x-csrf-token")) headers["x-csrf-token"] = client.token;
    const response = await fetch(url + path, {method, headers, body: extra.body});
    const cookies = response.headers.getSetCookie();
    const id = cookies.join("; ").match(/sap-contextid=([^;]+)/)?.[1];
    if (id) client.id = id;
    const token = response.headers.get("x-csrf-token");
    if (token && token !== "Required") client.token = token;
    const body = await response.text();
    const handle = body.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
    if (handle) handles.add(handle);
    let normalizedBody = body;
    for (const known of handles) normalizedBody = normalizedBody.replaceAll(known, "<handle>");
    let normalizedPath = path.replace(/lockHandle=[^&]+/, "lockHandle=<handle>");
    for (const known of clients.map((v) => v.id).filter(Boolean)) normalizedPath = normalizedPath.replaceAll(known, "<id>");
    results.push({method, path: normalizedPath,
      status: response.status, token: token === "Required" ? "Required" : token ? "<token>" : null,
      cookies: cookies.map((v) => v.replace(/=[a-f0-9]{24}/g, "=<id>")),
      body: normalizedBody.replace(/lockHandle="[^"]+"/g, 'lockHandle="<handle>"')});
    return {response, body, handle};
  };
  try {
    const one = clients[0], two = clients[1], sameUser = clients[2], stateless = clients[3];
    await call(one, "GET", BASE + "/core/discovery", {headers: {"x-sap-adt-sessiontype": "stateful"}});
    const object = BASE + "/oo/classes/ZCL_OSD_ADAPTER";
    const locked = await call(one, "POST", object + "?_action=LOCK&accessMode=MODIFY");
    expect(locked.handle, kind).to.be.a("string");
    await call(one, "GET", object + "/source/main", {headers: {"x-sap-adt-sessiontype": "stateless"}});
    await call(two, "GET", BASE + "/core/discovery", {headers: {"x-sap-adt-sessiontype": "stateful",
      authorization: "Basic " + Buffer.from("other:x").toString("base64")}});
    await call(two, "POST", object + "?_action=LOCK&accessMode=MODIFY");
    await call(sameUser, "GET", BASE + "/core/discovery", {headers: {"x-sap-adt-sessiontype": "stateful"}});
    await call(sameUser, "POST", object + "?_action=LOCK&accessMode=MODIFY");
    await call(two, "DELETE", object);
    await call(one, "PUT", object + "/source/main?lockHandle=" + locked.handle,
      {body: SOURCE + "* edited\n", headers: {"content-type": "text/plain"}});
    const includeBody = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClassInclude xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"
 adtcore:name="ZCL_OSD_ADAPTER" class:includeType="testclasses"/>`;
    await call(one, "POST", object + "/includes?lockHandle=" + locked.handle,
      {body: includeBody, headers: {"content-type": "application/xml"}});
    await call(one, "PUT", object + "/includes/testclasses?lockHandle=" + locked.handle,
      {body: "* adapter test\n", headers: {"content-type": "text/plain"}});
    await call(one, "POST", object + "?_action=UNLOCK&lockHandle=" + locked.handle);
    await call(one, "PUT", object + "/source/main?lockHandle=" + locked.handle,
      {body: SOURCE, headers: {"content-type": "text/plain"}});
    await call(one, "GET", "/sap/public/bc/icf/logoff");
    await call(one, "GET", BASE + "/core/discovery");
    await call(two, "POST", object + "?_action=LOCK&accessMode=MODIFY");
    await call(two, "DELETE", BASE + "/core/http/sessions/" + two.id);
    await call(sameUser, "POST", object + "?_action=LOCK&accessMode=MODIFY");
    await call(sameUser, "DELETE", object);
    const packageObject = BASE + "/packages/$STG_TEST_PKG";
    const packageLock = await call(sameUser, "POST", packageObject + "?_action=LOCK");
    expect(packageLock.handle, kind + " package").to.be.a("string");
    await call(sameUser, "POST", packageObject + "?_action=UNLOCK&lockHandle=" + packageLock.handle);
    await call(stateless, "GET", BASE + "/core/discovery");
    await call(stateless, "POST", packageObject + "?_action=LOCK");
    await call(stateless, "POST", object + "?_action=LOCK");
    await call(stateless, "POST", object + "?_action=OTHER");
    await call(stateless, "POST", BASE + "/oo/classes/NO_SUCH_CLASS?_action=LOCK");
    return results;
  } finally {
    for (const client of clients) if (client.id) await sessions.end(client.id);
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  }
}

describe("AbapSessions on the Node façade", function () {
  this.timeout(60000);
  afterEach(() => resetAdtSessionClaimForTests());
  after(() => resetAdtSessionClaimForTests());
  it("claims one ENQ session owner kind per host", () => {
    resetAdtSessionClaimForTests();
    new AbapSessions();
    new AbapSessions();
    expect(() => new Sessions({owners: new EnqOwners()})).to.throw(/cannot own ADT sessions/);
    resetAdtSessionClaimForTests();
    new Sessions({owners: new EnqOwners()});
    new Sessions({owners: new EnqOwners()});
    expect(() => new AbapSessions()).to.throw(/cannot own ADT sessions/);
    resetAdtSessionClaimForTests();
  });

  it("exposes the Sessions lookup and handle methods over persisted rows", async () => {
    resetAdtSessionClaimForTests();
    const sessions = new AbapSessions();
    const opened = await sessions.open("adapter");
    try {
      expect(opened.user).to.equal("ADAPTER");
      expect((await sessions.get(opened.id)).token).to.equal(opened.token);
      const taken = await sessions.lock(opened, "CLAS", "ZCL_OSD_DIRECT");
      expect(taken.handle).to.match(/^[a-f0-9]{40}$/);
      expect(await sessions.holds(opened, taken.handle, "clas", "zcl_osd_direct")).to.equal(true);
      expect((await sessions.holderOf("CLAS", "ZCL_OSD_DIRECT")).handle).to.equal(taken.handle);
      await sessions.release("CLAS", "ZCL_OSD_DIRECT");
      expect(await sessions.holds(opened, taken.handle, "CLAS", "ZCL_OSD_DIRECT")).to.equal(false);
      const adopted = await sessions.adopt(opened, "CLAS", "ZCL_OSD_DIRECT");
      expect((await sessions.forget(opened, adopted)).name).to.equal("ZCL_OSD_DIRECT");
      await sessions.unlock(opened, adopted);
    } finally {
      await sessions.end(opened.id);
      expect(await sessions.get(opened.id)).to.equal(undefined);
      resetAdtSessionClaimForTests();
    }
  });

  // The eleven route uses are sessionIdentifier (session DELETE), end (session
  // DELETE and logoff), holderOf and release (object DELETE), stateful and
  // user (LOCK), lock and unlock (object action), locks (mayWrite and
  // stillHeld), and holds (source PUT and include POST/PUT).
  it("keeps lock, read, write, holder, refusal, unlock and logoff answers in parity", async () => {
    const node = await scenario("node");
    const abap = await scenario("abap");
    expect(abap.length, "both façades answered every request").to.equal(node.length);
    for (let i = 0; i < node.length; i++) {
      expect(abap[i], `response ${i}: ${node[i].method} ${node[i].path}`).to.deep.equal(node[i]);
    }
  });

  it("serves ABAP LOCK, PUT, holder refusal, UNLOCK and dump with persisted sessions", async () => {
    const root = mkdtempSync(join(tmpdir(), "osd-abap-lock-adapter-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/zcl_osd_adapter.clas.abap"), SOURCE);
    const {cl_express_icf_shim} = await import("../output/cl_express_icf_shim.clas.mjs");
    const {zcl_osd_adt_router} = await import("../output/zcl_osd_adt_router.clas.mjs");
    const sessions = new AbapSessions();
    const served = [];
    const app = express();
    app.use(adtRouter({store: new ObjectStore({root, libs: []}), data: {}, watch: false,
      transpileOnActivate: false, sessions,
      abap: abapRunner({shim: cl_express_icf_shim, router: zcl_osd_adt_router, step: dialogStep}),
      abapServed: (by, req) => served.push(`${by} ${req.method} ${req.path}`)}).router);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const path = BASE + "/oo/classes/ZCL_OSD_ADAPTER";
    const clients = [{}, {}];
    const call = async (client, method, suffix, extra = {}) => {
      const headers = {...extra.headers};
      if (client.id) headers.cookie = `sap-contextid=${client.id}`;
      if (client.token) headers["x-csrf-token"] = client.token;
      const res = await fetch(url + suffix, {method, headers, body: extra.body});
      client.id = res.headers.getSetCookie().join("; ").match(/sap-contextid=([^;]+)/)?.[1] ?? client.id;
      client.token = res.headers.get("x-csrf-token") ?? client.token;
      return {status: res.status, body: await res.text()};
    };
    try {
      for (const [client, user] of [[clients[0], "ONE"], [clients[1], "TWO"]]) {
        expect((await call(client, "GET", BASE + "/core/discovery", {headers: {
          "x-sap-adt-sessiontype": "stateful", authorization: `Basic ${Buffer.from(`${user}:x`).toString("base64")}`,
        }})).status).to.equal(200);
      }
      const one = clients[0], two = clients[1];
      const locked = await call(one, "POST", path + "?_action=LOCK&accessMode=MODIFY");
      expect(locked.status, locked.body).to.equal(200);
      const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(locked.body)?.[1];
      expect(handle).to.match(/^[a-f0-9]{40}$/);
      const refused = await call(two, "POST", path + "?_action=LOCK&accessMode=MODIFY");
      expect(refused.status, refused.body).to.equal(403);
      expect(refused.body).to.contain("ONE");
      const saved = await call(one, "PUT", path + `/source/main?lockHandle=${handle}`, {
        headers: {"content-type": "text/plain"}, body: SOURCE + "* saved\n"});
      expect(saved.status, saved.body).to.equal(200);
      expect((await call(one, "POST", path + `?_action=UNLOCK&lockHandle=${handle}`)).status).to.equal(200);
      const next = await call(two, "POST", path + "?_action=LOCK&accessMode=MODIFY");
      expect(next.status, next.body).to.equal(200);
      // The bound context dumps after the lock. Its next resolve must clear
      // the stale handle and let another session take the object.
      await dialogStep(async () => {
        const req = {headers: {cookie: `sap-contextid=${two.id}`}, method: "GET"};
        const res = {append() {return this;}, setHeader() {return this;}};
        await new Promise((resolve, reject) => sessions.middleware()(req, res, (e) => e ? reject(e) : resolve()));
        throw new Error("adapter bound-step dump");
      }, "adapter bound-step dump").then(() => { throw new Error("no dump"); },
        (e) => expect(e.message).to.equal("adapter bound-step dump"));
      expect(sessions.owners.holder("CLAS", "ZCL_OSD_ADAPTER"), "dump released ENQ lock").to.equal(undefined);
      const afterDump = await call(one, "POST", path + "?_action=LOCK&accessMode=MODIFY");
      expect(afterDump.status, afterDump.body).to.equal(200);
      expect(served.filter((entry) => entry === "ABAP POST /oo/classes/ZCL_OSD_ADAPTER"), JSON.stringify(served)).to.have.length(5);
    } finally {
      for (const client of clients) if (client.id) await sessions.end(client.id);
      await new Promise((resolve) => server.close(resolve));
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("a session whose ENQ context the lock server ended: GET 200 in the same session, twice", async () => {
    resetAdtSessionClaimForTests();
    const sessions = new AbapSessions();
    const app = express();
    app.use(adtRouter({sessions, data: {}, watch: false}).router);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const url = `http://127.0.0.1:${server.address().port}${BASE}/core/discovery`;
    try {
      const first = await fetch(url, {headers: {"x-sap-adt-sessiontype": "stateful", "x-csrf-token": "fetch"}});
      const id = first.headers.getSetCookie().join("; ").match(/sap-contextid=([^;]+)/)?.[1];
      const token = first.headers.get("x-csrf-token");
      expect(id).to.match(/^[a-f0-9]{24}$/);
      for (const round of [1, 2]) {
        endEnqSession(adtEnqOwner.key(id));
        const read = await fetch(url, {headers: {cookie: `sap-contextid=${id}`, "x-sap-adt-sessiontype": "stateful"}});
        expect([round, read.status, read.headers.get("x-csrf-token")]).to.deep.equal([round, 200, token]);
        expect((await sessions.get(id))?.id).to.equal(id);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      resetAdtSessionClaimForTests();
    }
  });
});
