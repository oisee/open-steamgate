import {expect} from "chai";
import express from "express";
import {existsSync, rmSync} from "node:fs";
import {adtRouter} from "../tools/adt-facade.mjs";

// The state-changing half of the façade: lock, write, unlock, activate.
//
// On its own express app rather than the served one, and with the transpile
// after an activation switched off, because a test that rewrites output/
// underneath the rest of the suite is a test that breaks its neighbours. The
// verdict is what these assert; the modules are the store's business and its
// own tests cover them.
const SCRATCH = "ZCL_OSD_SCRATCH";
const SOURCE = `CLASS zcl_osd_scratch DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS greet RETURNING VALUE(rv) TYPE string.
ENDCLASS.

CLASS zcl_osd_scratch IMPLEMENTATION.
  METHOD greet.
    rv = 'hello'.
  ENDMETHOD.
ENDCLASS.
`;

describe("tools/adt-facade: the development loop", () => {
  let server;
  let port;
  let store;
  let token;
  let context;

  before(async function () {
    this.timeout(120000);
    const app = express();
    app.disable("x-powered-by");
    app.use(express.raw({type: "*/*", limit: "16mb"}));
    const facade = adtRouter({transpileOnActivate: false});
    store = facade.store;
    app.use(facade.router);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    port = server.address().port;

    const res = await fetch(base() + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    token = res.headers.get("x-csrf-token");
    context = (res.headers.getSetCookie?.() ?? []).join("; ").match(/sap-contextid=([^;]+)/)?.[1];
  });

  after(() => {
    server.close();
    // the scratch object is a file like any other, so it is removed like one
    const entry = store.find("CLAS", SCRATCH);
    if (entry !== undefined && existsSync(entry.file)) {
      rmSync(entry.file);
    }
  });

  const base = () => `http://localhost:${port}/sap/bc/adt`;

  const call = (path, options = {}) => fetch(base() + path, {
    ...options,
    headers: {
      cookie: `sap-contextid=${context}`,
      "x-csrf-token": token,
      "x-sap-adt-sessiontype": "stateful",
      ...(options.headers ?? {}),
    },
  });

  const lock = async (name = SCRATCH) => {
    const res = await call(`/oo/classes/${name}?_action=LOCK&accessMode=MODIFY`, {method: "POST"});
    const xml = await res.text();
    return {status: res.status, xml, handle: xml.match(/<LOCK_HANDLE>([^<]*)<\/LOCK_HANDLE>/)?.[1]};
  };

  describe("locking", () => {
    it("a lock gives a handle in the envelope a client expects", async () => {
      // the object has to exist before it can be locked, so it is written
      // through the store first; the façade's own write is the next test
      store.write("CLAS", SCRATCH, SOURCE);
      const {status, xml, handle} = await lock();
      expect(status).to.equal(200);
      expect(xml).to.contain("<asx:abap");
      expect(handle).to.be.a("string").with.length.greaterThan(8);
    });

    it("locking the same object twice in one session gives the same handle", async () => {
      const first = await lock();
      const again = await lock();
      expect(again.handle).to.equal(first.handle);
    });

    it("a library object locks with no handle, which is how a system says not modifiable", async () => {
      const res = await call("/oo/classes/CL_ABAP_ZIP?_action=LOCK&accessMode=MODIFY", {method: "POST"});
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("<LOCK_HANDLE></LOCK_HANDLE>");
    });

    it("a writable object of ours still locks, whatever its modification support says", async () => {
      // a real system reports NoModification for plenty of writable local
      // objects, so that field is never what decides; only the handle is
      const {status, handle} = await lock();
      expect(status).to.equal(200);
      expect(handle).to.have.length.greaterThan(8);
    });

    it("an object that is not there cannot be locked", async () => {
      const res = await call("/oo/classes/ZCL_NOT_A_THING?_action=LOCK&accessMode=MODIFY", {method: "POST"});
      expect(res.status).to.equal(404);
      expect(await res.text()).to.contain("exc:exception");
    });

    it("an unknown action is refused rather than guessed at", async () => {
      const res = await call(`/oo/classes/${SCRATCH}?_action=SOMETHING`, {method: "POST"});
      expect(res.status).to.equal(400);
    });
  });

  describe("writing", () => {
    it("a write needs the handle, and refuses without one", async () => {
      const res = await call(`/oo/classes/${SCRATCH}/source/main`, {method: "PUT", body: SOURCE});
      expect(res.status).to.equal(409);
      expect(await res.text()).to.contain("no lock handle");
    });

    it("a handle from another object does not open this one", async () => {
      const {handle} = await lock();
      store.write("CLAS", "ZCL_OSD_SCRATCH_TWO", SOURCE.replaceAll("zcl_osd_scratch", "zcl_osd_scratch_two"));
      const res = await call(`/oo/classes/ZCL_OSD_SCRATCH_TWO/source/main?lockHandle=${handle}`, {method: "PUT", body: SOURCE});
      expect(res.status).to.equal(409);
      const other = store.find("CLAS", "ZCL_OSD_SCRATCH_TWO");
      if (other !== undefined && existsSync(other.file)) {
        rmSync(other.file);
      }
    });

    it("a write with the handle lands, and reads back", async () => {
      const {handle} = await lock();
      const changed = SOURCE.replace("'hello'", "'changed'");
      const res = await call(`/oo/classes/${SCRATCH}/source/main?lockHandle=${handle}`, {method: "PUT", body: changed});
      expect(res.status).to.equal(200);
      const back = await call(`/oo/classes/${SCRATCH}/source/main`);
      expect(await back.text()).to.contain("'changed'");
    });

    it("a library object cannot be written", async () => {
      const {handle} = await lock();
      const res = await call(`/oo/classes/CL_ABAP_ZIP/source/main?lockHandle=${handle}`, {method: "PUT", body: "nope"});
      expect(res.status).to.equal(405);
    });

    it("a stateless hop retires the handle, the way a real session does", async () => {
      const {handle} = await lock();
      // the client says it no longer needs affinity; the locks go with it
      await call("/core/discovery", {headers: {"x-sap-adt-sessiontype": "stateless"}});
      const res = await call(`/oo/classes/${SCRATCH}/source/main?lockHandle=${handle}`, {method: "PUT", body: SOURCE});
      expect(res.status).to.equal(409);
    });

    it("unlocking gives the object back", async () => {
      const {handle} = await lock();
      const unlocked = await call(`/oo/classes/${SCRATCH}?_action=UNLOCK&lockHandle=${handle}`, {method: "POST"});
      expect(unlocked.status).to.equal(200);
      const res = await call(`/oo/classes/${SCRATCH}/source/main?lockHandle=${handle}`, {method: "PUT", body: SOURCE});
      expect(res.status).to.equal(409);
    });
  });

  describe("the syntax check", () => {
    const checkRun = (name, source) => call("/checkruns?reporters=abapCheckRun", {
      method: "POST",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <chkrun:checkObject adtcore:uri="/sap/bc/adt/oo/classes/${String(name).toLowerCase()}" chkrun:version="active">
    <chkrun:artifacts>
      <chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="/sap/bc/adt/oo/classes/${String(name).toLowerCase()}/source/main">
        <chkrun:content>${source.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`,
    });

    it("source that holds checks clean", async function () {
      this.timeout(60000);
      const res = await checkRun(SCRATCH, SOURCE);
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain("<chkrun:checkReport");
      expect(xml).to.contain('chkrun:status="processed"');
      expect(xml).to.contain("<chkrun:checkMessageList>");
      // no findings is an empty list, not an absent one: a client tells the
      // two apart and only one of them means "this ran and found nothing"
      expect(xml).to.not.contain("<chkrun:checkMessage ");
    });

    it("source that does not hold comes back with the finding, though nothing was written", async function () {
      this.timeout(60000);
      const before = await (await call(`/oo/classes/${SCRATCH}/source/main`)).text();
      const res = await checkRun(SCRATCH, SOURCE.replace("rv = 'hello'.", "rv = no_such_variable."));
      const xml = await res.text();
      expect(xml).to.contain("<chkrun:checkMessage ");
      expect(xml).to.contain('chkrun:type="E"');
      // a client reads the severity, the position and the text, each where it
      // expects them: attributes for the first two, a child for the text
      expect(xml).to.match(/chkrun:line="\d+"/);
      expect(xml).to.match(/chkrun:column="\d+"/);
      expect(xml).to.match(/<shortText>[^<]+<\/shortText>/);
      // the point of a check run: the file is untouched by it
      const after = await (await call(`/oo/classes/${SCRATCH}/source/main`)).text();
      expect(after).to.equal(before);
    });

    it("a check of an object that does not exist yet answers, because that is what a create looks like", async function () {
      this.timeout(60000);
      const res = await checkRun("ZCL_OSD_NEVER_WRITTEN", SOURCE.replaceAll("zcl_osd_scratch", "zcl_osd_never_written"));
      expect(res.status).to.equal(200);
      expect(await res.text()).to.contain("<chkrun:checkReport");
      expect(store.exists("CLAS", "ZCL_OSD_NEVER_WRITTEN"), "asking created nothing").to.equal(false);
    });

    it("a check run that names nothing is refused", async () => {
      const res = await call("/checkruns?reporters=abapCheckRun", {method: "POST", body: "<chkrun:checkObjectList/>"});
      expect(res.status).to.equal(400);
    });

    it("the check is advertised now that it answers", async () => {
      expect(await (await call("/discovery")).text()).to.contain('href="/sap/bc/adt/checkruns"');
    });
  });

  describe("activating", () => {
    const activate = (name) => call("/activation?method=activate&preauditRequested=true", {
      method: "POST",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/${String(name).toLowerCase()}" adtcore:name="${name}"/>
</adtcore:objectReferences>`,
    });

    it("source that holds activates, and says so by saying nothing", async function () {
      this.timeout(60000);
      const {handle} = await lock();
      await call(`/oo/classes/${SCRATCH}/source/main?lockHandle=${handle}`, {method: "PUT", body: SOURCE});
      const res = await activate(SCRATCH);
      expect(res.status).to.equal(200);
      expect((await res.text()).trim()).to.equal("");
    });

    it("source that does not hold comes back as messages, not as an empty success", async function () {
      this.timeout(60000);
      const {handle} = await lock();
      await call(`/oo/classes/${SCRATCH}/source/main?lockHandle=${handle}`, {
        method: "PUT",
        body: SOURCE.replace("rv = 'hello'.", "rv = undefined_variable_here."),
      });
      const res = await activate(SCRATCH);
      expect(res.status).to.equal(200);
      const xml = await res.text();
      expect(xml).to.contain('activationExecuted="false"');
      expect(xml).to.contain("<msg:msg");
      expect(xml.toUpperCase()).to.contain(SCRATCH);
    });

    it("an activation of nothing is refused rather than reported as success", async () => {
      const res = await call("/activation?method=activate", {method: "POST", body: "<adtcore:objectReferences/>"});
      expect(res.status).to.equal(400);
    });

    it("activation is advertised now that it answers", async () => {
      const xml = await (await call("/discovery")).text();
      expect(xml).to.contain('href="/sap/bc/adt/activation"');
    });
  });
});
