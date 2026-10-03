import {expect} from "chai";
import express from "express";
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {Data} from "../tools/osd-data.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {liveHash, switchTo} from "../tools/osd-build.mjs";
import {undoOnExit} from "./helpers/undo-on-exit.mjs";

// Keep the read facade unprimed: XREF_WARM would answer from the parent's
// compiler and conceal stale rows in the serving child's database.
describe("ADT xref after a warm swap", function () {
  this.timeout(180000);
  it("refreshes the edited class's readers rows without restarting the child", async () => {
    const root = process.cwd(), file = resolve("src/apc/zcl_stg_apc_demo.clas.abap");
    const before = readFileSync(file, "utf8"), generation = liveHash(root), warm = process.env.OSD_WARM;
    const edited = "ZCL_STG_APC_DEMO", target = "ZCL_OSD_JOB_DOCTOR";
    const compiler = new WarmCompiler({root});
    const store = new ObjectStore({root});
    const runtime = new ServingRuntime({root, env:{OSD_WARM:"1", OSD_ADT_ONE_RUNTIME:"1", STG_DB:"sqlite", STG_DB_PATH:"", STG_TLS:"0"}});
    runtime.storeDestination = new StoreDestination({store});
    const restore = () => {writeFileSync(file, before); switchTo(root, generation);};
    const dropUndo = undoOnExit(restore);
    let server;
    process.env.OSD_WARM = "1";
    try {
      await runtime.start();
      const pid = runtime.child.pid;
      await compiler.prime();
      const app = express();
      const served = [];
      app.use(adtRouter({store, data:new Data({runtime}), watch:false, logMisses:false,
        abap:abapRunner({remote:runtime}), abapServed:by => served.push(by)}).router);
      server = await new Promise(done => {const s=app.listen(0,"127.0.0.1",()=>done(s));});
      const readers = async () => {
        served.length = 0;
        const r = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/core/http/xref/readers?type=CLAS&name=${target}`);
        expect(r.status).to.equal(200);
        const answer = await r.json();
        expect(answer.source, "must read child tables, not the warm parent index").to.equal("xref");
        expect(served).to.deep.equal(["ABAP"]);
        return answer.readers.map(o=>o.name);
      };
      const initialReaders = await readers();
      expect(initialReaders).not.to.include(edited);
      writeFileSync(file, before.replace("    mv_seen = 0.", "    DATA lo_xref_warm TYPE REF TO zcl_osd_job_doctor.\n    mv_seen = 0."));
      const built = await compiler.build();
      expect(built.warm).to.equal(true);
      expect(built.hostHeld).to.deep.equal([]);
      expect(built.closure).to.deep.include({type:"CLAS", name:edited});
      const swapped = await runtime.hot({generation:built.hash, from:built.from, modules:built.modules, only:built.closure});
      expect(swapped.swaps).to.equal(1);
      expect(runtime.child.pid).to.equal(pid);
      expect(runtime.generation).to.equal(built.hash);
      const afterSwap = await readers();
      expect(afterSwap, "just-saved class missing from child WBCROSSGT/X").to.include(edited);
      expect(afterSwap).to.include.members(initialReaders);
      // Removing the reference must remove its old row as well.
      writeFileSync(file, before);
      const reverted = await compiler.build();
      await runtime.hot({generation:reverted.hash, from:reverted.from, modules:reverted.modules, only:reverted.closure});
      expect(runtime.child.pid).to.equal(pid);
      expect(await readers()).to.deep.equal(initialReaders);
    } finally {
      writeFileSync(file, before);
      try {
        if(server) await new Promise(done=>server.close(done));
        await runtime.stop();
      } finally {
        compiler.close();
        restore();
        dropUndo();
        if(warm === undefined) delete process.env.OSD_WARM; else process.env.OSD_WARM=warm;
      }
    }
  });
});
