// Full inline generation, the real ADT router, and main's actual Node runner.
import assert from "node:assert/strict";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import "../start.mjs";
import {ObjectStore} from "../../tools/osd-store.mjs";
import {adtRouter} from "../../tools/adt-facade.mjs";
import {abapRunner} from "../../tools/adt-abap-front.mjs";
import {dialogStep} from "../../tools/osd-dialog-step.mjs";
import {withSystem} from "../../tools/osd-store-destination.mjs";
import {runClassrun} from "../../tools/osd-classrun.mjs";

// Pin the pre-C5 main implementation (cc6b0287), not a second instance of this
// branch: a frozen copy, because CI's shallow checkout has no history to show.
const source = readFileSync("test/fixtures/c5/main-classrun.mjs.txt", "utf8")
  .replace(/from "(\.\/[^\"]+)"/g, (_, file) => `from "${pathToFileURL(resolve("tools", file)).href}"`);
const root = mkdtempSync(join(tmpdir(), "osd-c5-inline-off-"));
writeFileSync(join(root, "main-classrun.mjs"), source);
const main = await import(pathToFileURL(join(root, "main-classrun.mjs")).href);
const servers = [], served = [];
const rows = async () => (await dialogStep(() => abap.context.databaseConnections.DEFAULT.select({
  select: "SELECT * FROM zosd_dump WHERE objname = 'ZCL_OSD_CLASSRUN_DUMPER'",
}), "C5 inline dump inspect")).rows;
try {
  assert.equal(globalThis.__osdAdtKernel, undefined, "full inline generation, no reduced kernel sentinel");
  assert.equal((await abap.Classes.ZCL_OSD_KERNEL_GUARD.has_generation({})).get(), " ");
  await withSystem(() => undefined, async () => {
    assert.equal((await abap.Classes.ZCL_OSD_KERNEL_GUARD.has_generation({})).get(), "X", "request binding enables one-runtime");
  }, {oneRuntime: true});
  assert.equal((await abap.Classes.ZCL_OSD_KERNEL_GUARD.has_generation({})).get(), " ", "binding does not leak");
  mkdirSync(join(root, "src"));
  symlinkSync(resolve("output"), join(root, "output"));
  for (const name of ["zcl_osd_classrun_demo", "zcl_osd_classrun_dumper"]) {
    writeFileSync(join(root, "src", name + ".clas.abap"), readFileSync("src/classrun/" + name + ".clas.abap"));
  }
  writeFileSync(join(root, "src/zcl_osd_c5_unbuilt.clas.abap"), "CLASS zcl_osd_c5_unbuilt DEFINITION.\n INTERFACES if_oo_adt_classrun.\nENDCLASS.");
  const sides = [];
  for (const ported of [false, true]) {
    const store = new ObjectStore({root, libs: []});
    if (!ported) store.classrun = async () => new main.ClassRun(store);
    const app = express(); app.set("etag", false);
    app.use(adtRouter({store, data: {}, watch: false, logMisses: false,
      ...(ported ? {abap: abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep}),
        abapServed: by => served.push(by)} : {})}).router);
    const server = await new Promise(done => {const s = app.listen(0, "127.0.0.1", () => done(s));});
    servers.push(server);
    const url = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(url + "/sap/bc/adt/core/discovery", {headers: {"x-csrf-token": "fetch"}});
    await login.arrayBuffer();
    sides.push({url, headers: {cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), "x-csrf-token": login.headers.get("x-csrf-token")}});
  }
  for (const [name, status] of [["ZCL_OSD_CLASSRUN_DEMO", 200], ["ZCL_OSD_CLASSRUN_DUMPER", 200], ["ZCL_OSD_C5_UNBUILT", 500]]) {
    const answers = [];
    served.length = 0;
    for (const side of sides) {
      const before = await rows();
      const started = Date.now();
      const r = await fetch(side.url + "/sap/bc/adt/oo/classrun/" + name, {method: "POST", headers: side.headers});
      answers.push({status: r.status, type: r.headers.get("content-type"), length: r.headers.get("content-length"),
        etag: r.headers.get("etag"), bytes: Buffer.from(await r.arrayBuffer())});
      if (name.endsWith("UNBUILT")) assert.ok(Date.now() - started >= 500, "importFresh retries before the 500 refusal, including on main");
      if (name.endsWith("DUMPER")) {
        assert.match(answers.at(-1).bytes.toString(), /Runtime error: .* at .*\.clas\.abap:\d+/);
        const after = await rows();
        assert.equal(after.length, before.length + 1, "each facade persists its own dump");
        const added = after.find(row => !before.some(old => old.dump_id === row.dump_id));
        assert.ok(added.line > 0);
        assert.match(added.runtime_error, /ZERODIVIDE/);
      }
    }
    // The missing-module message names its importing module, which differs
    // for the extracted main oracle. Compare status and retry for that case.
    if (!name.endsWith("UNBUILT")) assert.deepEqual(answers[1], answers[0], `main cc6b0287: ${name}`);
    assert.equal(answers[0].status, status, `actual main cc6b0287 status`);
    assert.equal(answers[1].status, status);
    assert.deepEqual(served, ["HOST"]);
  }
  // A real file arriving after the first ENOENT must still get imported.
  const late = join(root, "late"); mkdirSync(late);
  writeFileSync(join(late, "init.mjs"), "");
  symlinkSync(resolve("output/zcl_osd_classrun_out.clas.mjs"), join(late, "zcl_osd_classrun_out.clas.mjs"));
  const lateRoot = join(root, "retry"); mkdirSync(lateRoot); symlinkSync(late, join(lateRoot, "output"));
  const timer = setTimeout(() => writeFileSync(join(late, "zcl_osd_c5_late.clas.mjs"),
    `export {zcl_osd_classrun_demo} from ${JSON.stringify(pathToFileURL(resolve("output/zcl_osd_classrun_demo.clas.mjs")).href)};`), 100);
  try {assert.match((await runClassrun(lateRoot, "ZCL_OSD_C5_LATE")).text, /hello from classrun/);}
  finally {clearTimeout(timer);}
  console.log("C5 inline switch-off: main HOST bytes, durable dump, unbuilt 500 after retry");
} finally {
  for (const s of servers) await new Promise(done => s.close(done));
  await abap.context.databaseConnections.DEFAULT.disconnect();
  rmSync(root, {recursive: true, force: true});
}
