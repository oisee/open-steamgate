import {expect} from "chai";
import express from "express";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
const base="/sap/bc/adt/",transport=base+"cts/transportchecks",occurrences=base+"abapsource/occurencemarkers";
const feeds=["feeds","feeds/variants","system/users","runtime/dumps","runtime/systemmessages","gw/errorlog"];
const clean=(s) => s.replace(/\?$/,"");
describe("A2 editor helpers live Node byte diff",function () {
  this.timeout(120000);
  let root,store,node,ported,otherNode,otherPorted,restore;
  const served=[];
  async function wire(side,path,method="GET",body,extra={}) {
    const r=await fetch(side.origin+path,{method,headers:{...side.auth,...extra},body});
    return {status:r.status,headers:Object.fromEntries(["content-type","content-length","etag"].map((h) => [h,r.headers.get(h)])),body:Buffer.from(await r.arrayBuffer()).toString()};
  }
  async function diff(path,method="GET",body,extra={},pair=[node,ported]) {
    const expected=await wire(pair[0],path,method,body,extra);served.length=0;
    const actual=await wire(pair[1],path,method,body,extra);
    const dates=[];
    for(const result of [expected,actual]) {
      result.body=result.body.replace(/<atom:updated>([^<]*)<\/atom:updated>/,(_,stamp) => {
        expect(stamp).to.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);dates.push(Date.parse(stamp));return "<atom:updated><clock></atom:updated>";
      });
      if(feeds.some((f) => clean(path.split("?")[0]).toLowerCase().replace(/\/$/,"")===base+f) && result.headers.etag) {
        expect(result.headers.etag).to.match(/^W\/"[0-9a-f]+-[A-Za-z0-9+/]{27}"$/);
        result.headers.etag=result.headers.etag.replace(/-[^"]+"$/,'-<hash>"');
      }
    }
    if(dates.length) {expect(dates).to.have.length(2);expect(Math.abs(dates[0]-dates[1])).to.be.lessThan(5000);}
    expect(actual.body).to.equal(expected.body);expect(actual).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${clean(path)}`]);return actual;
  }
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-a2-"));mkdirSync(join(root,"src"));mkdirSync(join(root,"lib"));
    writeFileSync(join(root,"src/zcl_editor.clas.abap"),"CLASS zcl_editor DEFINITION PUBLIC. ENDCLASS. CLASS zcl_editor IMPLEMENTATION. ENDCLASS.");
    writeFileSync(join(root,"lib/zcl_library.clas.abap"),"CLASS zcl_library DEFINITION PUBLIC. ENDCLASS. CLASS zcl_library IMPLEMENTATION. ENDCLASS.");
    store=new ObjectStore({root,libs:[],roots:[{path:"src",package:"$EDITOR",writable:true},{path:"lib",package:"$LIBRARY",writable:false}]});
    if(process.env.OSD_ADT_RED) {
      const key=process.env.OSD_ADT_RED;
      const isTransport=["transport","newline","operation","prefix","package","object-error"].includes(key);
      const isOccurrences=["occurrences","repeat"].includes(key);
      const klass=abap.Classes[isTransport ? "ZCL_OSD_ADT_TRANSPORT" : isOccurrences ? "ZCL_OSD_ADT_OCCURRENCES" : "ZCL_OSD_ADT_FEEDS"];
      const original=klass.prototype.zif_osd_adt_route$handle;
      klass.prototype.zif_osd_adt_route$handle=async function (input) {
        const request=input.is_request.get();
        if(key==="repeat") request.uri.set(request.uri.get().replace("uri=a&uri=b","uri=a"));
        if(key==="prefix") request.body.set(Buffer.from(Buffer.from(request.body.get(),"hex").toString().replace("OO/classes","oo/classes")).toString("hex"));
        const r=await original.call(this,input);let body=r.get().body.get();
        if(key==="identity") body=body.replaceAll('Editor & <Name> "test"','Editor &amp; &lt;Name&gt; &quot;test&quot;');
        else if(key==="order") body=body.replace(/(<atom:author>.*?<\/atom:author>)(<atom:contributor>.*?<\/atom:contributor>)/,"$2$1");
        else if(key==="newline") body=body.replace(/\n$/,"");
        else if(key==="operation") body=body.replace("<OPERATION></OPERATION>","<OPERATION>I</OPERATION>");
        else if(key==="package") body=body.replaceAll("$EDITOR","$TMP");
        else if(key==="object-error") {const error=await abap.Classes.ZCX_OSD_ADT.internal({iv_message:new abap.types.String().set("OBJECT refused")});throw error.get();}
        else if(key!=="prefix" && key!=="repeat" && (isTransport || isOccurrences || request.pattern.get()===base+key)) body+=" ";
        r.get().body.set(body);return r;
      };
      restore=() => {klass.prototype.zif_osd_adt_route$handle=original;};
    }
    const mount=async (isAbap,identity) => {
      const app=express();app.use(express.raw({type:"*/*",limit:"2mb"}));
      const facade=adtRouter({store,data:{},identity,watch:false,logMisses:false,transpileOnActivate:false,
        ...(isAbap ? {abap:abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
          abapServed:(by,req) => served.push(`${by} ${req.method} ${clean(req.originalUrl)}`)} : {})});
      app.use(facade.router);const server=await new Promise((r) => {const s=app.listen(0,"127.0.0.1",() => r(s));});
      const origin=`http://127.0.0.1:${server.address().port}`;
      const warm=await fetch(origin+base+"feeds",{headers:{"x-csrf-token":"fetch"}});await warm.arrayBuffer();
      return {server,origin,auth:{cookie:warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),"x-csrf-token":warm.headers.get("x-csrf-token")}};
    };
    const identity={systemID:"TST",userName:"EDITOR",userFullName:'Editor & <Name> "test"'};
    node=await mount(false,identity);ported=await mount(true,identity);
    const second={systemID:"ALT",userName:"SECOND",userFullName:"Second Editor"};
    otherNode=await mount(false,second);otherPorted=await mount(true,second);
  });
  after(async () => {restore?.();for(const s of [node,ported,otherNode,otherPorted]) if(s) await new Promise((r) => s.server.close(r));if(root) rmSync(root,{recursive:true,force:true});});
  for(const path of feeds) for(const method of ["GET","HEAD"]) for(const variant of [base+path,(base+path).toUpperCase()+"/"]) {
    it(`${method} ${variant}`,async () => {expect((await diff(variant+"?$top=1&x=y",method)).status).to.equal(200);});
  }
  it("interleaved facade identities remain unescaped and bound",async () => {
    for(const path of feeds) for(const pair of [[otherNode,otherPorted],[node,ported]]) {
      const r=await diff(base+path,"GET",undefined,{},pair);
      expect(r.body).to.include(pair[0]===node ? 'Editor & <Name> "test"' : "Second Editor");
      expect(r.body).to.include(pair[0]===node ? path==="system/users" ? "EDITOR" : "TST" : path==="system/users" ? "SECOND" : "ALT");
    }
  });
  const uri=base+"oo/classes/zcl_editor";
  const transportBody = fields => `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>${fields}</DATA></asx:values></asx:abap>`;
  const cases=[...['','/source/main','#start=1,1','?version=active','/source/main?version=active#start=1,1'].map((suffix) => `<URI>${uri+suffix}</URI>`),
    ...['','<DEVCLASS></DEVCLASS>','<DEVCLASS/>','<DEVCLASS>ZPKG</DEVCLASS>'].map((tag) => `<URI>${base}oo/classes/zmissing</URI>${tag}`),
    ...['oo/classes','oo/interfaces','programs/programs','ddic/ddl/sources','ddic/srvd/sources','programs/includes','OO/classes','packages','ddic/tables'].map((coll) => `<URI>${base+coll}/x</URI>`),
    `<URI>${uri}/includes/testclasses</URI>`,`<URI>${base}oo/classes/%2FNS%2FZCL_X</URI>`,
    `<URI>${base}oo/classes/</URI>`,"",'<URI></URI>',`<URI>${uri}</URI><OPERATION></OPERATION>`,
    `<URI>${uri}</URI><OPERATION>D</OPERATION>`,`<uri>${uri}</uri><URI>ignored</URI>`,
    `<URI>${uri}&amp;x</URI>`,...['%zz','%FF'].map((name) => `<URI>${base}oo/classes/${name}</URI>`),
    Buffer.from([255]),Buffer.concat([Buffer.from(`<URI>${uri}</URI>`),Buffer.from([255])])];
  for(const [i,body] of cases.entries()) it(`transport ${i}: ${String(body)}`,async () => {const r=await diff(transport,"POST",Buffer.isBuffer(body) ? body : transportBody(body),{"content-type":"application/xml"});expect(r.status).to.equal(Buffer.isBuffer(body) ? 400 : String(body).includes('%zz') || String(body).includes('%FF') ? 500 : 200);});
  it("library package survives OBJECT",async () => {expect((await diff(transport,"POST",transportBody(`<URI>${base}oo/classes/zcl_library</URI>`))).body).to.include("<DEVCLASS>$LIBRARY</DEVCLASS>");});
  it("OBJECT errors are swallowed",async () => {
    const original=store.find;store.find=() => {throw new Error("OBJECT refused");};
    try {expect((await diff(transport,"POST",transportBody(`<URI>${uri}</URI><DEVCLASS>ZASKED</DEVCLASS>`))).body).to.include("<DEVCLASS>ZASKED</DEVCLASS>");} finally {store.find=original;}
  });
  for(const query of ["uri="+encodeURIComponent(uri),"","uri=","uri","uri=a&uri=b","uri[x]=1","URI=x","uri=%","uri=a&uri[x]=b","%75ri=a"]) {
    it(`occurrences ${query}`,async () => {await diff(occurrences+"?"+query,"POST","ignored body");});
  }
  it("occurrences freshness and ignored 1MB body",async () => {
    const r=await diff(occurrences+"?uri=a","POST","x".repeat(1024*1024));
    expect((await diff(occurrences+"?uri=a","POST",undefined,{"if-none-match":r.headers.etag})).status).to.equal(200);
  });
  it("CSRF refused before route work",async () => {expect((await diff(occurrences+"?uri=a","POST",undefined,{"x-csrf-token":"invalid"})).status).to.equal(403);});
});
describe("A2 focused ABAP Unit",() => {
  it("clock and wire literals",async () => {const {ltcl_feeds}=await import("../output/zcl_osd_adt_feeds.clas.testclasses.mjs");const o=new ltcl_feeds();await o.constructor_();await o.FRIENDS_ACCESS_INSTANCE.clock();await o.FRIENDS_ACCESS_INSTANCE.routes();});
});
