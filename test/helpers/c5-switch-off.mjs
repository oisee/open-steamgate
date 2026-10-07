import {copyRuntimeRoot} from "./runtime-root.mjs";
// Fresh process: load the reduced parent kernel, never the whole generation.
import assert from "node:assert/strict";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {loadAdtKernel} from "../../tools/adt-abap-kernel.mjs";
import * as setup from "../setup.mjs";
import {ServingRuntime} from "../../tools/osd-runtime.mjs";
import {Data} from "../../tools/osd-data.mjs";
import {ObjectStore} from "../../tools/osd-store.mjs";
import {adtRouter} from "../../tools/adt-facade.mjs";
import {abapRunner} from "../../tools/adt-abap-front.mjs";
import {dialogStep} from "../../tools/osd-dialog-step.mjs";

const root = mkdtempSync(join(tmpdir(), "osd-c5-off-"));
const servers = [];
let runtime;
const runtimeRoot = copyRuntimeRoot();
try {
  mkdirSync(join(root, "src"));
  symlinkSync(resolve("output"), join(root, "output"));
  writeFileSync(join(root, "src/zcl_osd_classrun_demo.clas.abap"), readFileSync("src/classrun/zcl_osd_classrun_demo.clas.abap"));
  writeFileSync(join(root, "src/zcl_osd_c5_unbuilt.clas.abap"), "CLASS zcl_osd_c5_unbuilt DEFINITION.\n INTERFACES if_oo_adt_classrun.\nENDCLASS.");
  const kernel = await loadAdtKernel({output: resolve("output"), setup});
  assert.equal(abap.Classes.ZCL_OSD_CLASSRUN_DEMO, undefined, "parent kernel has no user class");
  assert.equal((await abap.Classes.ZCL_OSD_KERNEL_GUARD.has_generation({})).get(), " ");
  runtime = new ServingRuntime({root: runtimeRoot, env: {OSD_ADT_ONE_RUNTIME: "0", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
  await runtime.start();
  const store = new ObjectStore({root, libs: []});
  const sides = [];
  const served = [];
  for (const ported of [false, true]) {
    const app = express(); app.set("etag", false);
    app.use(adtRouter({store, data: new Data({runtime}), watch: false, logMisses: false,
      ...(ported ? {abap: abapRunner({handler: kernel.handler, step: dialogStep}), abapServed: by => served.push(by)} : {})}).router);
    const server = await new Promise(done => {const s = app.listen(0, "127.0.0.1", () => done(s));});
    servers.push(server);
    const url = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(url + "/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    await login.arrayBuffer();
    sides.push({url, headers: {cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), "x-csrf-token": login.headers.get("x-csrf-token")}});
  }
  for (const [name, status] of [["ZCL_OSD_CLASSRUN_DEMO", 200], ["ZCL_OSD_C5_UNBUILT", 500]]) {
    const answers = [];
    served.length = 0;
    for (const side of sides) {
      const r = await fetch(side.url + "/sap/bc/adt/oo/classrun/" + name, {method: "POST", headers: side.headers});
      answers.push({status: r.status, type: r.headers.get("content-type"), length: r.headers.get("content-length"), bytes: Buffer.from(await r.arrayBuffer())});
    }
    assert.deepEqual(answers[1], answers[0]);
    assert.equal(answers[1].status, status);
    assert.deepEqual(served, ["HOST"]);
  }
  const door = await fetch(runtime.url + "/osd/classrun", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({name: "ZCL_OSD_CLASSRUN_DEMO"})});
  assert.equal(door.status, 200);
  assert.match((await door.json()).text, /hello from classrun/);
  console.log("C5 switch-off: reduced kernel HOST parity 200/500; classrun door 200");
} finally {
  for (const s of servers) await new Promise(done => s.close(done));
  await runtime?.stop();
  rmSync(runtimeRoot, {recursive: true, force: true});
  await abap?.context?.databaseConnections?.DEFAULT?.disconnect();
  rmSync(root, {recursive: true, force: true});
}
