import {expect} from "chai";
import express from "express";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {structureOf,objectStructureDocument} from "../tools/adt-documents.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination,withSystem} from "../tools/osd-store-destination.mjs";
import {box,answerOf} from "./helpers/destination.mjs";
const base="/sap/bc/adt/";
const fixtures={
  "zi_outline.intf.abap":"INTERFACE zi_outline PUBLIC. METHODS run. ENDINTERFACE.",
  "zif_edge.intf.abap":"INTERFACE zif_edge PUBLIC. ENDINTERFACE.",
  "zcl_outline.clas.abap":`CLASS zcl_outline DEFINITION PUBLIC. PUBLIC SECTION. CLASS-METHODS execute. METHODS run. DATA value TYPE i. ENDCLASS.
CLASS zcl_outline IMPLEMENTATION. METHOD execute. ENDMETHOD. METHOD run. value = 1. ENDMETHOD. ENDCLASS.`,
  "zcl_outline.clas.testclasses.abap":"CLASS ltcl_test DEFINITION FOR TESTING. PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS. CLASS ltcl_test IMPLEMENTATION. METHOD check. ENDMETHOD. ENDCLASS.",
  "zcl_interface.clas.abap":"CLASS zcl_interface DEFINITION PUBLIC. PUBLIC SECTION. INTERFACES zi_outline. ENDCLASS. CLASS zcl_interface IMPLEMENTATION. METHOD zi_outline~run. ENDMETHOD. ENDCLASS.",
  "zcl_empty.clas.abap":"CLASS zcl_empty DEFINITION PUBLIC. ENDCLASS. CLASS zcl_empty IMPLEMENTATION. ENDCLASS.",
  "zcl_structures.clas.abap":`CLASS zcl_structures DEFINITION PUBLIC.
PUBLIC SECTION.
DATA: BEGIN OF row,
        field TYPE i,
        BEGIN OF nested,
          item TYPE i,
        END OF nested,
      END OF row,
      tail TYPE i.
PROTECTED SECTION.
CONSTANTS: answer TYPE i VALUE 42,
           BEGIN OF settings,
             enabled TYPE i VALUE 1,
             BEGIN OF nested,
               flag TYPE i VALUE 2,
             END OF nested,
           END OF settings.
PRIVATE SECTION.
CLASS-DATA: BEGIN OF shared,
              field TYPE i,
              BEGIN OF nested,
                item TYPE i,
              END OF nested,
            END OF shared.
ENDCLASS.
CLASS zcl_structures IMPLEMENTATION. ENDCLASS.`,
  "zcl_structures.clas.locals_def.abap":`CLASS lcl_structures DEFINITION.
PUBLIC SECTION.
DATA: BEGIN OF row, field TYPE i, END OF row.
ENDCLASS.`,
  "zoutline.prog.abap":`REPORT zoutline.
CLASS lcl_local DEFINITION. PUBLIC SECTION. METHODS run. ENDCLASS.
CLASS lcl_local IMPLEMENTATION. METHOD run. ENDMETHOD. ENDCLASS.
FORM do_it. WRITE 'hello'. ENDFORM.
START-OF-SELECTION. PERFORM do_it.`,
  "zinclude.prog.abap":"FORM included. WRITE 'included'. ENDFORM.",
  "zinclude.prog.xml":"<abapGit><PROGDIR><SUBC>I</SUBC></PROGDIR></abapGit>",
  "zddl.ddls.asddls":"define view entity ZEntity as select from ztable { key id }",
  "zsrv.srvd.srvdsrv":"define service ZSrv { expose ZEntity; }",
};
const routes=[["CLAS","oo/classes","zcl_outline"],["INTF","oo/interfaces","zi_outline"],
  ["INTF","oo/interfaces","zif_edge"],["CLAS","oo/classes","zcl_empty"],["CLAS","oo/classes","zcl_structures"],
  ["PROG","programs/programs","zoutline"],["DDLS","ddic/ddl/sources","zddl"],
  ["SRVD","ddic/srvd/sources","zsrv"],["INCL","programs/includes","zinclude"]];
const clean=(s) => s.replace(/\?$/,"");
describe("B2b objectstructure live Node byte diff",function () {
  this.timeout(120000);
  let root,store,node,ported,restore;
  const served=[];
  async function wire(side,path,method="GET",headers={}) {
    const r=await fetch(side.origin+path,{method,headers});
    expect(r.headers.get("x-osd-miss")).to.equal(null);
    return {status:r.status,headers:Object.fromEntries(["content-type","content-length","etag"].map((h) => [h,r.headers.get(h)])),body:Buffer.from(await r.arrayBuffer())};
  }
  async function diff(path,method="GET",headers={}) {
    const expected=await wire(node,path,method,headers);served.length=0;
    const actual=await wire(ported,path,method,headers);
    expect(actual.body.toString()).to.equal(expected.body.toString());expect(actual).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${clean(path)}`]);expect(actual.headers.etag).to.equal(null);
    return actual;
  }
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-b2b-"));mkdirSync(join(root,"src"));
    writeFileSync(join(root,"abaplint.jsonc"),JSON.stringify({syntax:{version:"v702"},rules:{}}));
    for (const [file,source] of Object.entries(fixtures)) writeFileSync(join(root,"src",file),source);
    store=new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    const klass=abap.Classes.ZCL_OSD_ADT_STRUCTURE,original=klass.document;
    if(process.env.OSD_ADT_RED) {
      klass.document=async (...args) => {const r=await original.apply(klass,args);let s=r.get();
        switch(process.env.OSD_ADT_RED) {
          case "extras": s=s.replace('isExternalRef="true" description="Text Elements"','description="Text Elements" isExternalRef="true"');break;
          case "twins": s=s.replace(/^.*<atom:link[^\n]*Identifier[^\n]*\n/gm,"");break;
          case "base": s=s.replace(/(xml:base="[^"?]*)\?[^" ]*/g,"$1");break;
          case "indent": s=s.replace(/^  </gm,"   <");break;
        }r.set(s);return r;};restore=() => {klass.document=original;};
    }
    const mount=async (isAbap) => {
      const app=express();app.set("etag",false);app.use(express.raw({type:"*/*"}));
      const facade=adtRouter({store,data:{},watch:false,logMisses:false,transpileOnActivate:false,...(isAbap ? {
        abap:abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
        abapServed:(by,req) => served.push(`${by} ${req.method} ${clean(req.originalUrl)}`)} : {})});
      app.use(facade.router);const server=await new Promise((r) => {const s=app.listen(0,"127.0.0.1",() => r(s));});
      return {server,facade,origin:`http://127.0.0.1:${server.address().port}`};
    };node=await mount(false);ported=await mount(true);
  });
  after(async () => {restore?.();for (const s of [node,ported]) if(s) await new Promise((r) => s.server.close(r));if(root) rmSync(root,{recursive:true,force:true});});
  for (const [type,collection,name] of routes) {
    const paths=[`${base}${collection}/${name}/objectstructure`,...(["INCL","SRVD"].includes(type) ? [`${base}${collection}/${name}`] : [])];
    for (const path of paths) for(const method of ["GET","HEAD"]) for(const variant of [path,path.toUpperCase()+"/"])
      it(`${method} ${variant}`,async () => {expect((await diff(variant+"?version=active&x=1",method)).status).to.equal(200);});
    for(const path of paths) {
      it(`freshness ${path}`,async () => {expect((await diff(path,"GET",{"If-None-Match":"*","Cache-Control":"max-age=0"})).status).to.equal(304);});
      it(`missing ${path}`,async () => {const p=path.replace(name,"zNoPe");expect((await diff(p)).status).to.equal(404);
        const key=`object GET ${p}`;expect(ported.facade.missed.get(key)?.count).to.equal(node.facade.missed.get(key)?.count);expect(ported.facade.missed.get(key)).to.be.an("object");});
    }
  }
  it("zcl_interface",async () => {expect((await diff(base+"oo/classes/zcl_interface/objectstructure")).status).to.equal(200);});
  it("structured attributes own their entire blocks in both fronts and STORE OUTLINE",async () => {
    const attribute=(name,visibility,level,identifier,block) => ({name,type:"CLAS/OA",visibility,level,links:[
      {rel:"definitionIdentifier",href:"./source/main#"+identifier},
      {rel:"definitionBlock",href:"./source/main#"+block},
    ]});
    const members=[
      attribute("ROW","public","instance","start=3,15;end=3,18","start=3,0;end=8,16"),
      attribute("TAIL","public","instance","start=9,6;end=9,10","start=3,0;end=9,17"),
      attribute("ANSWER","protected","static","start=11,11;end=11,17","start=11,0;end=11,33"),
      attribute("SETTINGS","protected","static","start=12,20;end=12,28","start=11,0;end=17,26"),
      attribute("SHARED","private","static","start=19,21;end=19,27","start=19,0;end=24,25"),
    ];
    const outline=structureOf(store,"CLAS","zcl_structures");
    expect(outline.children.slice(0,5)).to.deep.equal(members);
    const local=outline.children[5];
    expect(local.name).to.equal("LCL_STRUCTURES");
    expect(local.children).to.deep.equal([attribute("ROW","public","instance","start=3,15;end=3,18","start=3,0;end=3,44")
      ].map(e => ({...e,links:e.links.map(l => ({...l,href:l.href.replace("./source/main","./includes/definitions")}))})));
    const answer=await new StoreDestination({store}).execute({iv_command:"PARSE",iv_json:JSON.stringify({kind:"OUTLINE",type:"CLAS",name:"zcl_structures"})});
    expect(answer.EV_ERROR).to.equal("");
    const ordered=e => ({...e,extra:Object.entries(e.extra ?? {}).map(([name,value]) => ({name,value})),links:e.links ?? [],children:(e.children ?? []).map(ordered)});
    expect(JSON.parse(answer.EV_JSON)).to.deep.equal({found:true,...ordered(outline)});
    const actual=await diff(base+"oo/classes/zcl_structures/objectstructure");
    expect(actual.body.toString()).to.equal(objectStructureDocument(outline,{base:base+"oo/classes/zcl_structures/objectstructure"}));
  });
  it("DDLS has no entity fallback",async () => {expect((await diff(base+"ddic/ddl/sources/ZEntity/objectstructure")).status).to.equal(404);});
  it("PARSE refusal has Node's 500 document",async () => {
    const original=store.registry;store.registry=() => {throw new Error('outline <failure> & "message"');};
    try {expect((await diff(base+"oo/classes/zcl_outline/objectstructure")).status).to.equal(500);} finally {store.registry=original;}
  });
  it("cold and warm parse after write, both sides",async () => {
    const path=base+"oo/classes/zcl_outline/objectstructure",results={};
    const source=store.read("CLAS","ZCL_OUTLINE").source;
    for(const [label,side] of [["Node",node],["ABAP",ported]]) {
      store.write("CLAS","ZCL_OUTLINE",source);let bodies=[];
      for(const temperature of ["cold","warm"]) {const start=performance.now();const r=await wire(side,path);results[`${label} ${temperature}`]=+(performance.now()-start).toFixed(2);expect(r.status).to.equal(200);bodies.push(r.body);}
      expect(bodies[0]).to.deep.equal(bodies[1]);results[label]=bodies[0].toString();
    }
    expect(results.Node).to.equal(results.ABAP);delete results.Node;delete results.ABAP;console.log("B2b latency ms",JSON.stringify(results));
  });
  it("host save defers parsing to the next outline; activation primes the registry",async () => {
    const url=node.origin+base+"oo/classes/zcl_empty";
    const warm=await fetch(url,{headers:{"x-csrf-token":"fetch"}});await warm.arrayBuffer();
    const headers={cookie:warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),"x-csrf-token":warm.headers.get("x-csrf-token"),"x-sap-adt-sessiontype":"stateful","content-type":"text/plain"};
    const locked=await fetch(url+"?_action=LOCK&accessMode=MODIFY",{method:"POST",headers});
    const lockXml=await locked.text();const handle=/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(lockXml)?.[1];expect(handle,lockXml).to.be.a("string");
    try {
      const source=store.read("CLAS","ZCL_EMPTY").source;
      const registry=store.registry;
      store.registry=() => {throw new Error("SAVE must not parse the project");};
      try {
        const saved=await fetch(url+"/source/main?lockHandle="+encodeURIComponent(handle),{method:"PUT",headers,body:source});
        await saved.arrayBuffer();expect(saved.status).to.equal(200);expect(store.parsed).to.equal(undefined);
      } finally {store.registry=registry;}
      await diff(base+"oo/classes/zcl_empty/objectstructure");
      expect(store.parsed).not.to.equal(undefined);
      let calls=0;const original=store.registry;store.registry=function (...args) {calls++;return original.apply(this,args);};
      try {
        const activated=await fetch(node.origin+base+"activation?method=activate",{method:"POST",headers:{...headers,"content-type":"application/xml"},body:`<adtcore:objectReference xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="${base}oo/classes/zcl_empty"/>`});
        expect(await activated.text()).to.include("activationExecuted");expect(calls).to.be.greaterThan(0);
        expect(store.parsed).not.to.equal(undefined);
      } finally {store.registry=original;}
    } finally {await fetch(url+"?_action=UNLOCK&lockHandle="+encodeURIComponent(handle),{method:"POST",headers});}
  });
  it("OUTLINE is bound and extras/links are ordered arrays",async () => {
    const destination=new StoreDestination({store:() => {throw new Error("unbound store");}});
    const signature={exporting:{iv_command:box("PARSE"),iv_json:box(JSON.stringify({kind:"OUTLINE",type:"CLAS",name:"zcl_outline"}))},importing:{ev_json:box(""),ev_error:box("")}};
    await withSystem(() => ({}),() => destination.call("ZOSD_STORE",signature),{store});
    const r=JSON.parse(answerOf(signature).EV_JSON);expect(r.found).to.equal(true);
    expect(r.children.at(-1).extra).to.deep.equal([{name:"isExternalRef",value:"true"},{name:"description",value:"Text Elements"}]);
    expect(r.children[0].links).to.be.an("array");
    expect(objectStructureDocument(structureOf(store,"CLAS","zcl_outline"))).to.include('isExternalRef="true" description="Text Elements"');
  });
});
describe("B2b focused ABAP Unit",() => {
  for(const method of ["empty","root_links","nested"]) it(method,async () => {const {ltcl_structure}=await import("../output/zcl_osd_adt_structure.clas.testclasses.mjs");const o=new ltcl_structure();await o.constructor_();await o.FRIENDS_ACCESS_INSTANCE[method]();});
});
