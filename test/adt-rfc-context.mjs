import {expect} from "chai";
import express from "express";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {createRfcAdtServer} from "../tools/protocols/rfc-server.mjs";
import {connectAdt} from "./helpers/rfc-adt-client.mjs";
import {remoteForTest} from "./helpers/adt-remote.mjs";

describe("RFC editing context without client sessiontype headers", function () {
  this.timeout(120000);
  let root,server,bridge,runtime,one,two,foreign;
  let paused, entered, endContext;
  const object = "/sap/bc/adt/oo/classes/zcl_rfc_context";
  const source = "CLASS zcl_rfc_context DEFINITION PUBLIC. ENDCLASS.\nCLASS zcl_rfc_context IMPLEMENTATION. ENDCLASS.\n";
  const lock = `${object}?_action=LOCK&accessMode=MODIFY`;
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-rfc-context-")); mkdirSync(join(root,"src"));
    writeFileSync(join(root,"src/zcl_rfc_context.clas.abap"),source);
    writeFileSync(join(root,"abaplint.jsonc"),JSON.stringify({global:{files:"/src/**/*.*"},syntax:{version:"v702"},rules:{}}));
    writeFileSync(join(root,"abap_transpile.json"),JSON.stringify({input_folder:["src"]}));
    const store=new ObjectStore({root,libs:[],roots:[{path:"src",package:"$STG_TEST",writable:true}]});
    if(process.env.OSD_ADT_ONE_RUNTIME === "1") runtime=await remoteForTest();
    const app=express();
    app.use(async (req,res,next) => {
      if(paused && ((req.method === "POST" && req.url === lock) || req.method === "PUT")) {entered(); await paused;}
      next();
    });
    app.use(adtRouter({store,data:{},watch:false,logMisses:false,transpileOnActivate:false,
      abap:abapRunner(runtime ? {remote:runtime} : {step:dialogStep})}).router);
    server=await new Promise((resolve,reject) => {const s=app.listen(0,"127.0.0.1",() => resolve(s));s.once("error",reject);});
    bridge=createRfcAdtServer({backend:`http://127.0.0.1:${server.address().port}`,host:"127.0.0.1",port:0,
      log: (event) => {
        if(event.error) console.error("synthetic RFC client:",event.error);
        if(event.function === "backend-logoff") endContext?.(event.status);
      }});
    await bridge.listen();
    one=await connectAdt(bridge.server.address().port); two=await connectAdt(bridge.server.address().port);
    foreign=await connectAdt(bridge.server.address().port,"OTHER");
  });
  after(async () => {
    try {
      // TCP server.close does not wait for the asynchronous backend logoff.
      // End these clients explicitly before closing the shared ABAP backend.
      for(const client of [one,two,foreign]) if(client)
        expect((await client.call("GET","/sap/public/bc/icf/logoff")).status).to.equal(200);
    } finally {
      one?.close(); two?.close(); foreign?.close();
      if(bridge) await new Promise((resolve) => bridge.server.close(resolve));
      if(server) await new Promise((resolve) => server.close(resolve));
      await runtime?.stop();
      if(root)rmSync(root,{recursive:true,force:true});
    }
  });
  it("pooled connections save with the same user's known handle and reject foreign or stale handles",async () => {
    expect((await one.call("GET",object+"/source/main")).status).to.equal(200);
    const held=await one.call("POST",lock);
    expect(held.status,held.body).to.equal(200); expect(held.handle).to.match(/^[a-f0-9]{40}$/);
    expect((await two.call("POST",lock)).status).to.equal(403);
    const read=await one.call("GET",object+"/source/main","",{"x-sap-adt-sessiontype":"stateless"});
    expect(read.status).to.equal(200); expect(read.body).to.equal(source);
    const path=object+"/source/main?lockHandle="+held.handle;
    expect((await foreign.call("PUT",path,source+"* foreign\n",{"Content-Type":"text/plain"})).status).to.equal(409);
    // UNLOCK is idempotent even for an unowned handle; it must leave the
    // owner's lock intact rather than routing a foreign RFC user to it.
    expect((await foreign.call("POST",object+"?_action=UNLOCK&lockHandle="+held.handle)).status).to.equal(200);
    expect((await two.call("POST",lock)).status).to.equal(403);
    expect((await two.call("PUT",object+"/source/main?lockHandle="+"0".repeat(40),source,{"Content-Type":"text/plain"})).status).to.equal(409);
    const edited=source+"* saved over RFC\n";
    const saved=await two.call("PUT",path,edited,{"Content-Type":"text/plain"});
    expect(saved.status).to.equal(200); expect(saved.body).to.equal("");
    expect(saved.responseXml).not.to.match(/<NAME>content-type<\/NAME>/i);
    expect(saved.responseXml).to.match(/<NAME>etag<\/NAME>/i);
    expect((await one.call("GET",object+"/source/main")).body).to.equal(edited);
    expect((await two.call("POST",object+"?_action=UNLOCK&lockHandle="+held.handle)).status).to.equal(200);
    expect((await one.call("PUT",path,source,{"Content-Type":"text/plain"})).status).to.equal(409);
    const other=await two.call("POST",lock); expect(other.status).to.equal(200);
    expect(other.handle).not.to.equal(held.handle);
    expect((await two.call("GET","/sap/public/bc/icf/logoff")).status).to.equal(200);
    const again=await one.call("POST",lock); expect(again.status).to.equal(200);
    expect((await one.call("POST",object+"?_action=UNLOCK&lockHandle="+again.handle)).status).to.equal(200);
    await one.call("GET","/sap/public/bc/icf/logoff");
  });
  it("closing the RFC owner releases its backend lock for another connection",async () => {
    const owner=await connectAdt(bridge.server.address().port);
    const ended=new Promise((resolve) => {endContext=resolve;});
    try {
      expect((await owner.call("POST",lock)).status).to.equal(200);
      expect((await two.call("POST",lock)).status).to.equal(403);
      owner.close();
      expect(await ended).to.equal(200);
      const held=await two.call("POST",lock); expect(held.status).to.equal(200);
      await two.call("POST",object+"?_action=UNLOCK&lockHandle="+held.handle);
    } finally {owner.close(); endContext=undefined;}
  });
  it("closing during LOCK waits for the pending request before backend logoff",async () => {
    const owner=await connectAdt(bridge.server.address().port);
    let release;
    const started=new Promise((resolve) => {entered=resolve;});
    paused=new Promise((resolve) => {release=resolve;});
    const ended=new Promise((resolve) => {endContext=resolve;});
    try {
      const pending=owner.call("POST",lock).catch(() => undefined);
      await started;
      owner.close();
      paused=undefined; release(); await pending;
      expect(await ended).to.equal(200);
      const held=await two.call("POST",lock); expect(held.status).to.equal(200);
      await two.call("POST",object+"?_action=UNLOCK&lockHandle="+held.handle);
    } finally {paused=undefined; release(); owner.close(); endContext=undefined;}
  });
  it("closing the owner waits for a pooled connection's pending SAVE before logoff",async () => {
    const owner=await connectAdt(bridge.server.address().port);
    let release;
    try {
      const held=await owner.call("POST",lock); expect(held.status).to.equal(200);
      const started=new Promise((resolve) => {entered=resolve;});
      paused=new Promise((resolve) => {release=resolve;});
      const ended=new Promise((resolve) => {endContext=resolve;});
      const pending=two.call("PUT",object+"/source/main?lockHandle="+held.handle,source,{"Content-Type":"text/plain"});
      await started; owner.close();
      paused=undefined; release();
      expect((await pending).status).to.equal(200);
      expect(await ended).to.equal(200);
      const next=await two.call("POST",lock); expect(next.status).to.equal(200);
      await two.call("POST",object+"?_action=UNLOCK&lockHandle="+next.handle);
    } finally {paused=undefined; release?.(); owner.close(); endContext=undefined;}
  });
});
