import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner, registerContinuation, resume} from "../tools/adt-abap-front.mjs";
import {dialogStep, currentStepToken} from "../tools/osd-dialog-step.mjs";
import {adtEnqOwner} from "../tools/adt-enq-key.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {exceptionDocument} from "../tools/adt-documents.mjs";
import {previewContinuation, previewAdtAnswer} from "../web/preview-continuations.mjs";

// Registered once, independent of every router mounted below.
const finish = async ({req, res, kind, payload}) => {
  const {store, options} = req.osdFacade;
  store.write("PROG", "ZF3_STORE", "host work");
  options.f3SessionKey = adtEnqOwner.key(req.adt.session.id);
  await options.f3Host?.(req);
  await resume(req, res, kind, options.f3Source ?? payload.source);
};
const unregister = registerContinuation("f3-write", finish);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return {promise, resolve}; };
const pause = () => new Promise((r) => setTimeout(r, 40));

describe("ADT F3: continuation re-entry", function () {
  this.timeout(60000);
  let handler;
  const mounts = [];
  before(async () => {
    handler = abap.Classes.ZCL_OSD_ADT_HANDLER;
    const routes = abap.Classes.ZCL_OSD_ADT_ROUTER.METHODS.DISPATCH.parameters.IT_ROUTES.type();
    const r = routes.appendInitial().get();
    r.method.set("GET"); r.pattern.set("/sap/bc/adt/f3"); r.handler.set("ZCL_OSD_ADT_ROUTE_F3");
    r.served_by.set("ABAP"); r.resume_kind.set("f3-write");
    await handler.use_routes({it_routes: routes});
    for (const name of ["one", "two"]) {
      const root = mkdtempSync(join(tmpdir(), "osd-f3-"));
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "zf3_store.prog.abap"), `WRITE '${name}'.\n`);
      const store = new ObjectStore({root, libs: []});
      const options = {store, data: {}, watch: false, logMisses: false, transpileOnActivate: false};
      const runner = abapRunner({handler, step: dialogStep});
      options.abap = {...runner, resume: async (...args) => {
        expect(currentStepToken(), "RESUME must hold a dialog step").to.not.equal(undefined);
        expect(currentStepToken().enqSession, "re-entry pins the original session").to.equal(options.f3SessionKey);
        return runner.resume(...args);
      }};
      const app = express(); app.use(express.raw({type: "*/*"})); app.use(adtRouter(options).router);
      const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
      mounts.push({root, store, options, server, url: `http://127.0.0.1:${server.address().port}/sap/bc/adt/f3`});
    }
  });
  after(async () => {
    await handler.use_routes({}); unregister();
    for (const m of mounts) { await new Promise((r) => m.server.close(r)); rmSync(m.root, {recursive: true, force: true}); }
  });
  afterEach(() => { for (const m of mounts) delete m.options.f3Host; });

  it("two routers finish through RESUME against their own bound stores", async () => {
    for (const [i, m] of mounts.entries()) {
      const source = `resumed ${i}`;
      m.options.f3Host = (req) => {
        expect(req.osdFacade.options).to.equal(m.options);
        expect(req.osdFacade.store).to.equal(m.store);
        expect(m.store.read("PROG", "ZF3_STORE").source).to.equal("host work");
      };
      m.options.f3Source = source;
      const res = await fetch(m.url, {headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal(`finished through RESUME: f3-write;${source}`);
      expect(res.headers.getSetCookie()).to.have.length(2);
      expect(m.store.read("PROG", "ZF3_STORE").source).to.equal(source);
      delete m.options.f3Source;
    }
    expect(mounts.map((m) => m.store.read("PROG", "ZF3_STORE").source)).to.deep.equal(["resumed 0", "resumed 1"]);
  });

  it("RESUME queues behind a gated long step and retains its step context", async () => {
    const m = mounts[0]; const entered = deferred(); const hostFree = deferred(); const stepFree = deferred();
    m.options.f3Host = async () => { entered.resolve(); await hostFree.promise; };
    let completed = false;
    const request = fetch(m.url, {headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}}).then(async (r) => { completed = true; return [r.status, await r.text()]; });
    await entered.promise;
    const busy = deferred();
    const long = dialogStep(async () => { busy.resolve(); await stepFree.promise; }, "F3 gated step");
    await busy.promise;
    hostFree.resolve();
    try { await pause(); expect(completed, "FIFO must wait").to.equal(false); }
    finally { stepFree.resolve(); await long; }
    expect(await request).to.deep.equal([200, "finished through RESUME: f3-write;resumed source"]);
  });

  it("an ended session cannot resume under a new session", async () => {
    const m = mounts[0];
    m.options.f3Host = async (req) => { await req.adt.sessions.end(req.adt.session.id); };
    const res = await fetch(m.url, {headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
    expect(res.status).to.equal(403);
    expect(res.headers.get("x-csrf-token")).to.equal("Required");
    expect(await res.text()).to.equal("CSRF token validation failed");
    expect(m.store.read("PROG", "ZF3_STORE").source).to.equal("host work");
  });

  it("unknown host and ABAP kinds give ADT 500 documents", async () => {
    const res = await fetch(mounts[0].url + "?kind=f3-unknown");
    expect(res.status).to.equal(500);
    expect(await res.text()).to.equal(exceptionDocument("ExceptionInternalError", 'ZCL_OSD_ADT_HANDLER: no continuation "f3-unknown" is registered on this host', {namespace: "org.open-steamgate.osd"}));
    const stop = registerContinuation("f3-unknown", ({req, res, kind}) => {
      req.osdFacade.options.f3SessionKey = adtEnqOwner.key(req.adt.session.id);
      return resume(req, res, kind, "{}");
    });
    try {
      const unknown = await fetch(mounts[0].url + "?kind=f3-unknown", {headers: {"x-csrf-token": "fetch", "x-sap-adt-sessiontype": "stateful"}});
      expect(unknown.status).to.equal(500);
      expect(await unknown.text()).to.equal(exceptionDocument("ExceptionInternalError", "no ABAP continuation f3-unknown is registered", {namespace: "org.open-steamgate.osd"}));
    } finally { stop(); }
  });

  it("duplicate registration is refused without replacing the module handler", () => {
    expect(() => registerContinuation("f3-write", finish)).to.throw("registered already");
  });

  it("preview and service-worker stubs retain today's unregistered-kind 500 bytes", async () => {
    for (const kind of ["activation", "aunit-run", "unit-object-run", "NOTEBOOK_CELL", "unknown<&\""]) {
      const result = await dialogStep(() => previewAdtAnswer(handler, {method: "GET", path: "/sap/bc/adt/f3",
        search: "?kind=" + encodeURIComponent(kind)}), "F3 preview");
      expect(new TextDecoder().decode(previewContinuation(kind).body)).to.equal(new TextDecoder().decode(result.body));
      const current = await fetch(mounts[0].url + "?kind=" + encodeURIComponent(kind));
      expect([result.status, result.headers.get("content-type"), new TextDecoder().decode(result.body)])
        .to.deep.equal([current.status, current.headers.get("content-type"), await current.text()]);
      expect(result.status).to.equal(500);
      expect(result.headers.get("content-type")).to.equal("application/xml; charset=utf-8");
      expect(new TextDecoder().decode(result.body)).to.equal(exceptionDocument("ExceptionInternalError", `ZCL_OSD_ADT_HANDLER: no continuation ${JSON.stringify(kind)} is registered on this host`, {namespace: "org.open-steamgate.osd"}));
    }
  });
});
