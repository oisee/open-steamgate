// C5 acceptance: live Node and ABAP front over one bound store and database.
import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";

import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {Data} from "../tools/osd-data.mjs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const BASE = "/sap/bc/adt/oo/classrun/";
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
    runtime = new ServingRuntime({root: process.cwd(), env: {OSD_ADT_ONE_RUNTIME: "1", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
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
