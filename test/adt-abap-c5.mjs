// C5 acceptance: live Node and ABAP front over one bound store and database.
import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {box} from "./helpers/destination.mjs";
import {implementsClassrun} from "../tools/osd-classrun.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination, withSystem, currentSystemAnswers} from "../tools/osd-store-destination.mjs";

import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {Data} from "../tools/osd-data.mjs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";

const runtimeFixture = runtimeRootFixture();

const BASE = "/sap/bc/adt/oo/classrun/";
const str = (v) => new abap.types.String().set(v);
describe("ADT C5: classrun bytes and runtime guard", function () {
  this.timeout(60000);
  let root, store, runtime, node, front;
  const servers = [], served = [];
  // The preload only transports the envelope: osd-serve's installed
  // StoreIPCClient.localSystem records/maps/persists the actual dump.
  let sequence = 0;
  function childDump(json) {
    const id = ++sequence;
    const child = runtime.child;
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer);
        child.off("message", receive);
        child.off("exit", exited);
        if (error) reject(error); else resolve(value);
      };
      const receive = message => {
        if (message?.type === "c5-dump-answer" && message.id === id) {
          finish(message.error ? new Error(message.error) : undefined, message.value);
        }
      };
      const exited = () => finish(new Error("C5 dump child exited"));
      const timer = setTimeout(() => finish(new Error("C5 dump answer timed out")), 10000);
      child.on("message", receive);
      child.once("exit", exited);
      child.send({type: "c5-dump", id, json}, error => {if (error) finish(error);});
    });
  }
  async function mount(ported) {
    const app = express();
    app.set("etag", false);
    const runner = abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep});
    const answer = runner.answer;
    runner.answer = (view, session) => {
      const previous = currentSystemAnswers();
      return withSystem((kind, name, json) => {
        if (kind !== "DUMP") return previous?.(kind, name, json);
        return childDump(json);
      }, () => answer(view, session), {store, oneRuntime: true});
    };
    const facade = adtRouter({store, data: {}, watch: false, logMisses: false,
      ...(ported ? {abap: runner,
        abapServed: (by) => served.push(by)} : {})});
    app.use((req, res, next) => withSystem(currentSystemAnswers(), next, {store, oneRuntime: true}));
    app.use(facade.router);
    const server = await new Promise((done) => {const s = app.listen(0, "127.0.0.1", () => done(s));});
    servers.push(server);
    const token = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/core/http/systeminformation`,
      {headers: {"x-csrf-token": "fetch"}});
    return {server, missed: facade.missed, headers: {"x-csrf-token": token.headers.get("x-csrf-token"),
      cookie: token.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")}};
  }
  async function call(side, name, {method = "POST", body, base = BASE} = {}) {
    const response = await fetch(`http://127.0.0.1:${side.server.address().port}${base}${name}`,
      {method, headers: side.headers, body});
    return {status: response.status, type: response.headers.get("content-type"),
      length: response.headers.get("content-length"), etag: response.headers.get("etag"),
      bytes: Buffer.from(await response.arrayBuffer())};
  }
  async function diff(name, status, options = {}, who = "ABAP", inspect) {
    const expected = await call(node, name, options);
    if (inspect) await inspect();
    served.length = 0;
    const actual = await call(front, name, options);
    if (inspect) await inspect();
    expect(actual, name).to.deep.equal(expected);
    expect(actual.status, name).to.equal(status);
    expect(served, name).to.deep.equal([who]);
    return actual.bytes.toString("utf8");
  }
  const source = (name, text) => writeFileSync(join(root, "src", `${name.toLowerCase()}.clas.abap`), text);
  const rows = async (sql) => dialogStep(() => abap.context.databaseConnections.DEFAULT.select({select: sql}), "C5 inspect");
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-adt-c5-"));
    mkdirSync(join(root, "src"));
    symlinkSync(resolve("output"), join(root, "output"));
    for (const name of ["zcl_osd_classrun_demo", "zcl_osd_classrun_dumper"]) {
      source(name, readFileSync(`src/classrun/${name}.clas.abap`, "utf8"));
    }
    for (const name of ["empty", "firstdump", "assert", "rollback", "utf8", "values", "constructor"]) {
      source(`zcl_osd_c5_${name}`, readFileSync(`test/unit/classrun/zcl_osd_c5_${name}.clas.abap`, "utf8"));
    }
    source("zcl_osd_c5_unbuilt", "CLASS zcl_osd_c5_unbuilt DEFINITION.\n INTERFACES if_oo_adt_classrun.\nENDCLASS.");
    source("zcl_osd_c5_plain", "CLASS zcl_osd_c5_plain DEFINITION. ENDCLASS.");
    source("zcl_osd_c5_inherited", "CLASS zcl_osd_c5_inherited DEFINITION INHERITING FROM zcl_osd_classrun_demo. ENDCLASS.");
    source("zcl_osd_c5_indented", "CLASS zcl_osd_c5_indented DEFINITION.\n\t InTeRfAcEs if_oo_adt_classrun_out.\nENDCLASS.");
    // Source supports classrun, compiled generation does not: second check.
    source("zcl_osd_classrun_out", "CLASS zcl_osd_classrun_out DEFINITION.\n  InTeRfAcEs if_oo_adt_classrun.\nENDCLASS.");
    source("zcl_osd_c5_empty", "CLASS zcl_osd_c5_empty DEFINITION.\r\n\t InTeRfAcEs if_oo_adt_classrun.\r\nENDCLASS.");
    store = new ObjectStore({root, libs: []});
    runtime = new ServingRuntime({root: runtimeFixture.root, env: {
      OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${resolve("test/helpers/c5-child-dump.mjs")}`].filter(Boolean).join(" "),
    }});
    runtime.storeDestination = new StoreDestination({store});
    await runtime.start();
    node = await mount(false); front = await mount(true);
  });
  after(async () => {
    for (const s of servers) await new Promise((done) => s.close(done));
    await runtime?.stop();
    rmSync(root, {recursive: true, force: true});
  });
  it("1: demo", async () => expect(await diff("ZCL_OSD_CLASSRUN_DEMO", 200)).to.contain("hello from classrun"));
  it("2: lower case, percent encoding and case-insensitive path", async () => {
    await diff("zcl_osd_classrun_demo", 200);
    await diff("%5Acl_osd_classrun_demo", 200);
    await diff("ZCL_OSD_CLASSRUN_DEMO/", 200);
    await diff("ZCL_OSD_CLASSRUN_DEMO", 200, {base: BASE.toUpperCase()});
  });
  it("3: missing names retain the path's case", async () => {
    for (const n of ["ZCL_NOT_A_THING_AT_ALL", "zcl_not_a_thing_at_all"]) {
      expect(await diff(n, 404)).to.contain(`CLAS ${n} does not exist`);
      expect(front.missed.get(`object POST ${BASE}${n}`)?.kind).to.equal("object");
    }
  });
  it("4: no interface line", async () => {await diff("zcl_osd_c5_plain", 400);});
  it("5: source-only decision and compiled interface recheck", async () => {
    await diff("zcl_osd_c5_inherited", 400);
    await diff("zcl_osd_c5_indented", 400);
    await diff("zcl_osd_classrun_out", 400);
    // Both regex implementations accept indentation and mixed case.
    for (const s of ["  InTeRfAcEs if_oo_adt_classrun.", "\r\n\tINTERFACES if_oo_adt_classrun.",
      "* INTERFACES if_oo_adt_classrun.", "INTERFACES if_oo_adt_classrun_out."]) {
      expect((await abap.Classes.ZCL_OSD_ADT_CLASSRUN.supports({iv_source: str(s)})).get() === "X")
        .to.equal(implementsClassrun(s));
    }
  });
  it("6: partial output, durable dump and rollback on both sides", async () => {
    expect(await diff("ZCL_OSD_CLASSRUN_DUMPER", 200)).to.match(/^before the dump\n\nRuntime error:/);
    await diff("ZCL_OSD_C5_ROLLBACK", 200, {}, "ABAP", async () => {
      expect((await rows("SELECT * FROM zstg_demo WHERE travel_id = 'C5DUMP'")).rows).to.have.length(0);
    });
    const dumps = (await rows("SELECT * FROM zosd_dump WHERE objname = 'ZCL_OSD_CLASSRUN_DUMPER'")).rows;
    expect(dumps.length).to.be.at.least(1);
    const childDumps = await new Data({runtime}).query("SELECT * FROM zosd_dump WHERE objname = 'ZCL_OSD_CLASSRUN_DUMPER'");
    expect(childDumps.rows.length).to.be.at.least(1);
    expect(childDumps.rows.every(r => r.runtime_error.includes("ZERODIVIDE"))).to.equal(true);
    expect(dumps.every((r) => r.runtime_error.includes("ZERODIVIDE"))).to.equal(true);
  });
  it("7: first-statement dump has no blank prefix", async () => expect(await diff("ZCL_OSD_C5_FIRSTDUMP", 200)).to.match(/^Runtime error:/));
  it("8: ASSERT-todo is caught by the kernel guard", async () => expect(await diff("ZCL_OSD_C5_ASSERT", 200)).to.match(/^Runtime error:/));
  it("9: empty output has the same length and type", async () => expect(await diff("ZCL_OSD_C5_EMPTY", 200)).to.equal(""));
  it("10: UTF-8 output", async () => expect(await diff("ZCL_OSD_C5_UTF8", 200)).to.equal("Grüße"));
  it("11: structure and table output", async () => expect(await diff("ZCL_OSD_C5_VALUES", 200)).to.contain("example"));
  it("12: source exists but generation has no class", async () => {
    expect(await diff("ZCL_OSD_C5_UNBUILT", 503)).to.contain("is not built: activate it first");
  });
  it("13: body and profilerId ignored", async () => {await diff("ZCL_OSD_CLASSRUN_DEMO?profilerId=x", 200, {body: "ignored"});});
  it("14: GET still delegates", async () => {await diff("ZCL_OSD_CLASSRUN_DEMO", 404, {method: "GET"}, "HOST");});
  it("15: constructor division by zero is byte-equal", async () => {
    expect(await diff("ZCL_OSD_C5_CONSTRUCTOR", 200)).to.match(/^Runtime error:/);
  });
  it("SYSTEM DUMP uses the JSON envelope without opening an unbound store", async () => {
    const payload = JSON.stringify({name: "ERROR", message: "example", stack: "", request: "classrun EXAMPLE"});
    const sig = {exporting: {iv_command: box("SYSTEM"), iv_type: box("DUMP"), iv_json: box(payload)},
      importing: {ev_json: box(""), ev_error: box("")}};
    const dest = new StoreDestination({store: () => {throw new Error("must use bound context");}});
    const before = await (await fetch(runtime.url + "/osd/dumps")).json();
    await withSystem((kind, name, json) => {
      expect(kind).to.equal("DUMP"); expect(json).to.equal(payload);
      return childDump(JSON.stringify({...JSON.parse(json), operation: "record"}));
    }, () => dest.call("ZOSD_STORE", sig), {store, oneRuntime: true});
    expect(sig.importing.ev_error.get()).to.equal("");
    expect(JSON.parse(sig.importing.ev_json.get())).to.deep.equal({where: "ERROR (no ABAP position; is write_source_map on?)", frames: []});
    const after = await (await fetch(runtime.url + "/osd/dumps")).json();
    expect(after).to.have.length(before.length + 1);
    expect(after[0].request).to.equal("classrun EXAMPLE");
    expect(dest.opened).to.equal(false);
  });
  it("a host without SYSTEM refuses through the capability guard", async () => {
    const saved = abap.context.RFCDestinations.STORE;
    let dumps = 0;
    abap.context.RFCDestinations.STORE = {oneRuntimeEnabled: () => saved.oneRuntimeEnabled(), call: async (name, sig) => {
      const command = sig.exporting.iv_command.get();
      if (command === "COMMANDS") {
        sig.importing.ev_json.set(JSON.stringify({commands: ["OBJECT", "READ", "COMMANDS"]}));
      } else if (command === "SYSTEM") {
        dumps++;
        sig.importing.ev_error.set("unknown store command SYSTEM");
      } else {await saved.call(name, sig);}
    }};
    try {
      const success = await call(front, "ZCL_OSD_CLASSRUN_DEMO");
      expect(success.status).to.equal(501);
      expect(success.bytes.toString()).to.contain("unknown store command SYSTEM");
      expect(dumps).to.equal(0);
    } finally {abap.context.RFCDestinations.STORE = saved;}
  });
  it("an error without a constructor name keeps dumpOf's lowercase fallback", async () => {
    const klass = abap.Classes.ZCL_OSD_C5_EMPTY;
    const saved = klass.prototype.if_oo_adt_classrun$main;
    klass.prototype.if_oo_adt_classrun$main = async () => {throw {constructor: null, message: "unnamed"};};
    try {expect(await diff("ZCL_OSD_C5_EMPTY", 200)).to.contain("Runtime error: unnamed at error");}
    finally {klass.prototype.if_oo_adt_classrun$main = saved;}
  });
  it("red proof: plain guard call lets ASSERT-todo escape as 500", async () => {
    const guard = abap.Classes.ZCL_OSD_KERNEL_GUARD;
    const saved = guard.call_classrun;
    guard.call_classrun = async ({iv_name, io_out}) => {
      const instance = await new abap.Classes[iv_name.get()]().constructor_();
      return instance.if_oo_adt_classrun$main({out: io_out});
    };
    try {
      expect((await call(node, "ZCL_OSD_C5_ASSERT")).status).to.equal(200);
      expect((await call(front, "ZCL_OSD_C5_ASSERT")).status).to.equal(500);
    } finally {guard.call_classrun = saved;}
    await diff("ZCL_OSD_C5_ASSERT", 200);
  });
  it("red proof: dropping the rollback verdict persists a half-write", async () => {
    const proto = abap.Classes.ZCL_OSD_ADT_CLASSRUN.prototype;
    const saved = proto.zif_osd_adt_route$handle;
    proto.zif_osd_adt_route$handle = async function (input) {
      const response = await saved.call(this, input);
      response.get().rollback.set(" ");
      return response;
    };
    try {
      expect((await call(front, "ZCL_OSD_C5_ROLLBACK")).status).to.equal(200);
      expect((await rows("SELECT * FROM zstg_demo WHERE travel_id = 'C5DUMP'")).rows).to.have.length(1);
    } finally {
      proto.zif_osd_adt_route$handle = saved;
      await dialogStep(() => abap.context.databaseConnections.DEFAULT.execute("DELETE FROM zstg_demo WHERE travel_id = 'C5DUMP'"), "C5 cleanup");
    }
    await diff("ZCL_OSD_C5_ROLLBACK", 200);
  });
  it("red proof: removing the router row trips served-by", async () => {
    const handler = abap.Classes.ZCL_OSD_ADT_HANDLER;
    const routes = await abap.Classes.ZCL_OSD_ADT_ROUTER.routes({});
    const changed = routes.clone();
    changed.clear();
    for (const r of routes.array()) if (r.get().handler.get() !== "ZCL_OSD_ADT_CLASSRUN") changed.append(r);
    await handler.use_routes({it_routes: changed});
    try {
      served.length = 0;
      expect((await call(front, "ZCL_OSD_CLASSRUN_DEMO")).status).to.equal(200);
      expect(served).to.deep.equal(["HOST"]);
    } finally {await handler.use_routes({});}
    await diff("ZCL_OSD_CLASSRUN_DEMO", 200);
  });
});

describe("ADT C5 B: serving-child parity", function () {
  this.timeout(60000);
  let root, store, runtime, node, front;
  const served = [], servers = [];
  const wire = async (side, name, auth = true) => {
    const res = await fetch(side.url + BASE + name, {method: "POST", headers: auth ? side.headers : {}});
    return {status: res.status, type: res.headers.get("content-type"), length: res.headers.get("content-length"),
      etag: res.headers.get("etag"), bytes: Buffer.from(await res.arrayBuffer())};
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-c5-child-"));
    mkdirSync(join(root, "src"));
    symlinkSync(resolve("output"), join(root, "output"));
    for (const name of ["zcl_osd_classrun_demo", "zcl_osd_classrun_dumper"]) {
      writeFileSync(join(root, "src", name + ".clas.abap"), readFileSync("src/classrun/" + name + ".clas.abap"));
    }
    for (const name of ["assert", "rollback", "constructor", "empty", "utf8", "values", "firstdump"]) {
      writeFileSync(join(root, "src", `zcl_osd_c5_${name}.clas.abap`), readFileSync(`test/unit/classrun/zcl_osd_c5_${name}.clas.abap`));
    }
    writeFileSync(join(root, "src", "zcl_osd_c5_plain.clas.abap"), "CLASS zcl_osd_c5_plain DEFINITION. ENDCLASS.");
    writeFileSync(join(root, "src", "zcl_osd_c5_unbuilt.clas.abap"), "CLASS zcl_osd_c5_unbuilt DEFINITION.\n INTERFACES if_oo_adt_classrun.\nENDCLASS.");
    store = new ObjectStore({root, libs: []});
    runtime = new ServingRuntime({root: runtimeFixture.root, env: {OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
    runtime.storeDestination = new StoreDestination({store});
    await runtime.start();
    const data = new Data({runtime});
    for (const isAbap of [false, true]) {
      const app = express(); app.set("etag", false);
      app.use(express.raw({type: "*/*"}));
      const facade = adtRouter({store, data, watch: false, logMisses: false,
        ...(isAbap ? {abap: abapRunner({remote: runtime}), abapServed: (by, req) => served.push(`${by} ${req.originalUrl.replace(/\?$/, "")}`)} : {})});
      app.use(facade.router);
      const server = await new Promise(done => { const s = app.listen(0, "127.0.0.1", () => done(s)); });
      servers.push(server);
      const url = `http://127.0.0.1:${server.address().port}`;
      const login = await fetch(url + "/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
      await login.arrayBuffer();
      const side = {url, headers: {cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), "x-csrf-token": login.headers.get("x-csrf-token")}};
      if (isAbap) front = side; else node = side;
    }
  });
  after(async () => {
    for (const s of servers) await new Promise(done => s.close(done));
    await runtime?.stop();
    if (root) rmSync(root, {recursive: true, force: true});
  });
  for (const [name, status] of [
    ["ZCL_OSD_CLASSRUN_DEMO", 200], ["zcl_osd_classrun_demo?", 200], ["ZCL_OSD_C5_PLAIN", 400],
    ["ZCL_OSD_C5_UNBUILT", 503], ["zcl_absent", 404], ["ZCL_OSD_CLASSRUN_DUMPER", 200],
    ["ZCL_OSD_C5_ASSERT", 200], ["ZCL_OSD_C5_CONSTRUCTOR", 200], ["ZCL_OSD_C5_EMPTY", 200],
    ["ZCL_OSD_C5_UTF8", 200], ["ZCL_OSD_C5_VALUES", 200], ["ZCL_OSD_C5_FIRSTDUMP", 200],
    ["ZCL_OSD_C5_ROLLBACK", 200],
  ]) it(`${name}: live Node bytes equal serving-child ABAP (${status})`, async () => {
    const expected = await wire(node, name);
    served.length = 0;
    const actual = await wire(front, name);
    expect(actual).to.deep.equal(expected);
    expect(actual.status).to.equal(status);
    expect(served).to.deep.equal([`ABAP ${BASE}${name.replace(/\?$/, "")}`]);
    if (name.endsWith("ROLLBACK")) {
      const rows = await new Data({runtime}).query("SELECT * FROM zstg_demo WHERE travel_id = 'C5DUMP'");
      expect(rows.rows).to.have.length(0);
      const dumps = await (await fetch(runtime.url + "/osd/dumps")).json();
      expect(dumps.some(d => d.request === "classrun ZCL_OSD_C5_ROLLBACK")).to.equal(true);
      const persisted = await new Data({runtime}).query("SELECT * FROM zosd_dump WHERE objname = 'ZCL_OSD_C5_ROLLBACK'");
      expect(persisted.rows.length).to.be.greaterThan(0);
    }
  });
  it("CSRF refusal is byte-equal and served by ABAP", async () => {
    const expected = await wire(node, "ZCL_OSD_CLASSRUN_DEMO", false);
    served.length = 0;
    expect(await wire(front, "ZCL_OSD_CLASSRUN_DEMO", false)).to.deep.equal(expected);
    expect(expected.status).to.equal(403);
    expect(served).to.deep.equal([`ABAP ${BASE}ZCL_OSD_CLASSRUN_DEMO`]);
  });
  it("/osd/classrun remains a 200 door with the switch on", async () => {
    const response = await fetch(runtime.url + "/osd/classrun", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_CLASSRUN_DEMO"})});
    expect(response.status).to.equal(200);
    expect((await response.json()).text).to.contain("hello from classrun");
  });
});

describe("ADT C5 switch off", function () {
  this.timeout(60000);
  it("inline generation delegates to main with durable dumps and the original unbuilt status", async () => {
    const result = await promisify(execFile)(process.execPath, ["test/helpers/c5-inline-off.mjs"],
      {env: {...process.env, STG_SERVE: "inline", OSD_ADT_ONE_RUNTIME: "0"}, timeout: 55000});
    expect(result.stdout).to.contain("C5 inline switch-off: main HOST bytes, durable dump, unbuilt 500 after retry");
  });
  it("reduced parent kernel delegates to Node and preserves the classrun door", async () => {
    const result = await promisify(execFile)(process.execPath, ["test/helpers/c5-switch-off.mjs"],
      {env: {...process.env, OSD_ADT_ONE_RUNTIME: "0"}, timeout: 55000});
    expect(result.stdout).to.contain("C5 switch-off: reduced kernel HOST parity 200/500; classrun door 200");
  });
});
