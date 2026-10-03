import {expect} from "chai";
import express from "express";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve, basename} from "node:path";
import "./start.mjs";
import {remoteForTest} from "./helpers/adt-remote.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination, withSystem} from "../tools/osd-store-destination.mjs";

const base = "/sap/bc/adt/core/http/";
const routes = ["build", "changed", "services", "transactions"];
const clean = (url) => url.replace(/\?$/, "");
describe("ADT A8a thin introspection live Node byte diff", function () {
  this.timeout(120000);
  let root, store, runtime, node, ported;
  const sides = [], served = [];
  let lastAbapMs;
  async function mount(isAbap, identity = {}) {
    const app = express(); app.set("etag", false);
    const runner = runtime ? abapRunner({remote: runtime}) : abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep});
    const facade = adtRouter({store, data: {source: "serving"}, watch: false, logMisses: false, identity,
      ...(isAbap ? {abap: runner, abapServed: (by, req) => served.push(`${by} ${req.method} ${clean(req.originalUrl)}`)} : {})});
    app.use(facade.router);
    const server = await new Promise((r) => {const s = app.listen(0, "127.0.0.1", () => r(s));});
    const side = {server, facade, origin: `http://127.0.0.1:${server.address().port}`}; sides.push(side); return side;
  }
  async function wire(side, path, method) {
    const r = await fetch(side.origin + path, {method});
    expect(r.headers.get("x-osd-miss")).to.equal(null);
    return {status: r.status, headers: Object.fromEntries(["content-type", "content-length", "etag"].map((h) => [h, r.headers.get(h)])),
      body: Buffer.from(await r.arrayBuffer())};
  }
  async function diff(route, {method = "GET", path = base + route, left = node, right = ported} = {}) {
    const expected = await wire(left, path, method); served.length = 0;
    const start = performance.now();
    const actual = await wire(right, path, method);
    lastAbapMs = performance.now() - start;
    expect(actual, `${route} wire bytes`).to.deep.equal(expected);
    expect(served, `${route} served by ABAP`).to.deep.equal([`ABAP ${method} ${clean(path)}`]);
    return actual;
  }
  before(async () => {
    if (process.env.OSD_ADT_ONE_RUNTIME === "1") runtime = await remoteForTest();
    root = mkdtempSync(join(tmpdir(), "osd-a8a-")); mkdirSync(join(root, "src")); mkdirSync(join(root, "webapp"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"]}));
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}, rules: {}}));
    writeFileSync(join(root, "release.json"), JSON.stringify({commit: "fixture-commit"}));
    for (const file of ["src/demo/zstg_demo_srv                      0001.iwsv.xml", "src/demo/zstg_demo_mdl                   0001.iwmo.xml",
      "src/icf/zstg_icf_demo.sicf.xml", "src/apc/zstg_apc_demo.sapc.xml", "src/webgui/zosd_note.tran.xml"]) {
      writeFileSync(join(root, "src", basename(file)), readFileSync(file));
    }
    for (const name of ["ZCL_ZSTG_DEMO_DPC_EXT", "ZCL_ZSTG_DEMO_MPC_EXT", "ZCL_ZSTG_DEMO_MPC_ANN", "ZCL_STG_SEGW_REGISTRY", "ZCL_STG_BSP_REGISTRY", "ZCL_OSD_NOTE"])
      writeFileSync(join(root, "src", name.toLowerCase() + ".clas.abap"), `CLASS ${name} DEFINITION PUBLIC. ENDCLASS. CLASS ${name} IMPLEMENTATION. ENDCLASS.`);
    writeFileSync(join(root, "webapp", "manifest.json"), JSON.stringify({"sap.app": {id: "fixture.app", title: 'Fixture <app> & "text" \u2028 \ud83d\ude00'}}));
    store = new ObjectStore({root, libs: [], roots: [{path: "src", package: "$TMP", writable: true}]});
    node = await mount(false); ported = await mount(true);
  });
  after(async () => {
    for (const s of sides) await new Promise((r) => s.server.close(r));
    await runtime?.stop(); if (root) rmSync(root, {recursive: true, force: true});
  });
  for (const route of routes) for (const method of ["GET", "HEAD"]) for (const suffix of ["", "/"]) {
    it(`${route} ${method} ${suffix ? "case and trailing slash" : "literal"}`, async () => {
      const path = (suffix ? (base + route).toUpperCase() + suffix : base + route) + "?repeat=1&repeat=2";
      const r = await diff(route, {path, method}); expect(r.status).to.equal(200);
      if (method === "HEAD") expect(r.body.length).to.equal(0);
    });
  }
  it("build root undefined drops system and generation in key order", async () => {
    const old = store.root; store.root = undefined;
    try {const r = await diff("build"); expect(Object.keys(JSON.parse(r.body))).to.deep.equal(["build", "commit", "started", "identity"]);}
    finally {store.root = old;}
  });
  it("build liveHash undefined and present preserve nested key order", async () => {
    let r = JSON.parse((await diff("build")).body);
    expect(Object.keys(r)).to.deep.equal(["build", "commit", "system", "started", "identity"]);
    expect(Object.keys(r.system)).to.deep.equal(["source", "serving", "database", "synchronized"]);
    mkdirSync(join(root, "build")); symlinkSync("fixture-generation", join(root, "build", "live"));
    store.served = {running: true, generation: "fixture-generation", database: "memory"};
    try {
      r = JSON.parse((await diff("build")).body);
      expect(Object.keys(r)).to.deep.equal(["build", "generation", "commit", "system", "started", "identity"]);
      expect(Object.keys(r.system)).to.deep.equal(["source", "live", "serving", "database", "synchronized"]);
      expect(Object.keys(r.system.database)).to.deep.equal(["serving", "preview"]);
    } finally {unlinkSync(join(root, "build", "live")); store.served = undefined;}
  });
  it("build two identities stay bound under interleaved calls", async () => {
    const pairs = [];
    for (const systemID of ["AAA", "BBB"]) pairs.push({left: await mount(false, {systemID}), right: await mount(true, {systemID}), systemID});
    for (const p of [pairs[0], pairs[1], pairs[0], pairs[1]]) {
      const r = JSON.parse((await diff("build", p)).body); expect(r.identity.systemID).to.equal(p.systemID);
      expect(Object.keys(r.identity)).to.deep.equal(["systemID", "userName", "userFullName", "client", "language"]);
    }
  });
  it("changed cold, unprimed and edited digest Map order", async () => {
    store.warmState = {on: false}; expect((await diff("changed")).body.toString()).to.equal('{"reason":"OSD_WARM is not 1"}');
    store.warmState = {on: true, reason: "not primed yet"}; expect(JSON.parse((await diff("changed")).body)).to.deep.equal({reason: "not primed yet"});
    const entries = store.list().filter((e) => e.type === "CLAS").map((e) => store.find(e.type, e.name));
    const digests = new Map(entries.map((e) => [resolve(root, e.file), createHash("sha256").update(readFileSync(join(root, e.file))).digest("hex")]));
    store.warmState = {on: true, compiler: {primed: true, digests}};
    for (const e of entries.slice(0, 2)) writeFileSync(join(root, e.file), readFileSync(join(root, e.file), "utf8") + "\n* edited\n");
    try {const r = JSON.parse((await diff("changed")).body); expect(Object.keys(r)).to.deep.equal(["objects"]);
      expect(r.objects.map((o) => o.name)).to.deep.equal(entries.slice(0, 2).map((e) => e.name));
      expect(Object.keys(r.objects[0])).to.deep.equal(["type", "name", "base"]);
    } finally {store.warmState = undefined;}
  });
  it("services kinds, helper presence and key order", async () => {
    const r = JSON.parse((await diff("services")).body); expect(Object.keys(r)).to.deep.equal(["services", "counts"]);
    expect(new Set(r.services.map((s) => s.kind))).to.deep.equal(new Set(["APP", "ICF", "APC", "ODATA"]));
    const o = r.services.find((s) => s.kind === "ODATA");
    expect(Object.keys(o)).to.deep.equal(["kind", "name", "path", "text", "pack", "handler", "handlerUri", "handlerSource", "mpc", "mpcUri", "mpcSource", "helpers", "source"]);
    expect(o.helpers.map((h) => h.name)).to.deep.equal(["ZCL_ZSTG_DEMO_MPC_ANN", "ZCL_STG_SEGW_REGISTRY"]);
    expect(Object.keys(o.helpers[0])).to.deep.equal(["name", "role", "uri", "source"]);
    expect(Object.keys(r.counts)).to.deep.equal([...new Set(r.services.map((s) => s.kind))]);
  });
  it("transactions ordered body and per-request step latency", async () => {
    const r = JSON.parse((await diff("transactions")).body);
    console.log("A8a transactions ABAP request ms", +lastAbapMs.toFixed(2));
    expect(Object.keys(r)).to.deep.equal(["transactions"]); expect(r.transactions).to.have.length(1);
    expect(Object.keys(r.transactions[0])).to.deep.equal(["tcode", "text", "program", "dynpro", "className", "method", "parameter", "webgui", "reason", "runnable", "kind", "source", "package", "layer", "programSource"]);
  });
  for (const route of ["services", "transactions"]) it(`${route} forced throw uses com.sap.adt with no miss`, async () => {
    const key = route === "services" ? "exists" : "locationOf", old = store[key];
    store[key] = () => {throw new Error('forced <error> & "message"');};
    try {for (const method of ["GET", "HEAD"]) {
      const r = await diff(route, {method}); expect(r.status).to.equal(500);
      if (method === "GET") {expect(r.body.toString()).to.include("com.sap.adt").and.include("ExceptionInternalError"); expect(r.body.toString()).not.to.include("org.open-steamgate.osd");}
    }} finally {store[key] = old;}
  });
  it("SYSTEM kinds use bound raw EV_SOURCE and IV_JSON envelope", async () => {
    const destination = new StoreDestination({store: () => {throw new Error("must not open store");}});
    for (const kind of routes.map((r) => r.toUpperCase())) {
      const raw = '{"text":"\\u0000\r\n\u2028\ud83d\ude00"}';
      const r = await withSystem((asked) => asked === kind ? {raw} : undefined,
        () => destination.execute({IV_COMMAND: "SYSTEM", IV_JSON: JSON.stringify({kind})}));
      expect(r.EV_SOURCE).to.equal(raw); expect(r.EV_JSON).to.equal(""); expect(r.EV_ERROR).to.equal("");
    }
  });
});
