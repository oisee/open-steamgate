// Fresh reduced parent kernel: xref must keep using the serving database.
import assert from "node:assert/strict";
import express from "express";
import {resolve} from "node:path";
import {loadAdtKernel} from "../../tools/adt-abap-kernel.mjs";
import * as setup from "../setup.mjs";
import {ServingRuntime} from "../../tools/osd-runtime.mjs";
import {Data} from "../../tools/osd-data.mjs";
import {ObjectStore} from "../../tools/osd-store.mjs";
import {adtRouter} from "../../tools/adt-facade.mjs";
import {abapRunner} from "../../tools/adt-abap-front.mjs";
import {dialogStep} from "../../tools/osd-dialog-step.mjs";
const servers=[],served=[],sides=[];
let runtime;
try {
  const kernel=await loadAdtKernel({output:resolve("output"),setup});
  assert.equal((await abap.Classes.ZCL_OSD_KERNEL_GUARD.has_serving_database({})).get()," ");
  runtime=new ServingRuntime({root:process.cwd(),env:{OSD_ADT_ONE_RUNTIME:"0",STG_DB:"sqlite",STG_DB_PATH:"",STG_TLS:"0"}});
  await runtime.start();
  const store=new ObjectStore({root:process.cwd()}), data=new Data({runtime});
  const db=abap.context.databaseConnections.DEFAULT;
  const select=db.select;
  db.select=function(input) {if(/wbcrossgt/i.test(input.select)) throw new Error("parent xref read");return select.call(this,input);};
  for(const ported of [false,true]) {
    const app=express();app.set("etag",false);
    app.use(adtRouter({store,data,watch:false,logMisses:false,...(ported?{abap:abapRunner({handler:kernel.handler,step:dialogStep}),abapServed:by=>served.push(by)}:{})}).router);
    const server=await new Promise(done=>{const s=app.listen(0,"127.0.0.1",()=>done(s));});servers.push(server);
    sides.push(`http://127.0.0.1:${server.address().port}`);
  }
  for(const route of ["readers","closure"]) {
    const answers=[];served.length=0;
    for(const origin of sides) {
      const r=await fetch(origin+`/sap/bc/adt/core/http/xref/${route}?type=CLAS&name=ZCL_ZSTG_DEMO_MPC_EXT`);
      answers.push({status:r.status,type:r.headers.get("content-type"),length:r.headers.get("content-length"),etag:r.headers.get("etag"),body:Buffer.from(await r.arrayBuffer())});
    }
    assert.deepEqual(answers[1],answers[0]);assert.equal(answers[0].status,200);
    assert.deepEqual(served,["HOST"]);
    const result=JSON.parse(answers[0].body);
    assert.equal(result.source,"xref");assert.ok(result.counts[route === "readers" ? "readers" : "objects"]>0);
  }
  console.log("A9 switch-off: reduced parent delegates both routes to Node over child tables");
} finally {
  for(const s of servers) await new Promise(done=>s.close(done));
  await runtime?.stop();
  await globalThis.abap?.context?.databaseConnections?.DEFAULT?.disconnect();
}
