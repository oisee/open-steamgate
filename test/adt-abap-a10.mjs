import {expect} from "chai";
import express from "express";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,symlinkSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import "./start.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {exceptionDocument} from "../tools/adt-documents.mjs";

const path="/sap/bc/adt/core/http/segw/entitysets";
async function wire(server,url=path+"?class=ZCL_FAIL",method="GET") {
  const r=await fetch(`http://127.0.0.1:${server.address().port}`+url,{method});
  return {status:r.status,headers:Object.fromEntries(["content-type","content-length","etag"].map((h) => [h,r.headers.get(h)])),body:Buffer.from(await r.arrayBuffer())};
}
describe("A10 Node answer wrapper",function () {
  it("registration throw becomes the byte-exact ADT document",async () => {
    let fail=false;
    const store={get root() {if(fail) throw new Error('registration <failure> & "message"'); return undefined;}};
    const app=express();app.set("etag",false);
    const facade=adtRouter({store,data:{},watch:false,logMisses:false});
    const route=facade.router.stack.find((l) => l.route?.path===path).route;
    const original=route.stack[0].handle;
    route.stack[0].handle=(req,res,next) => {fail=true;return original(req,res,next);};
    app.use(facade.router);
    const server=await new Promise((resolve) => {const s=app.listen(0,"127.0.0.1",() => resolve(s));});
    try {
      const body=Buffer.from(exceptionDocument("ExceptionInternalError",'registration <failure> & "message"',{namespace:"org.open-steamgate.osd"}));
      expect(await wire(server)).to.deep.equal({status:500,headers:{"content-type":"application/xml; charset=utf-8","content-length":String(body.length),etag:null},body});
    } finally {await new Promise((resolve) => server.close(resolve));}
  });
});

const clean=(url) => url.replace(/\?$/,"");
describe("A10 SEGW entitysets live Node byte diff",function () {
  this.timeout(120000);
  let root,store,node,ported,restore;
  const served=[];
  const write=(file,source) => writeFileSync(join(root,"src",file),source);
  function register(id,dpc,mpc) {
    write(`${id}.iwsv.xml`,`<abapGit><_-IWBEP_-I_MGW_SRG><MODEL_TECH_NAME>${id}_MDL</MODEL_TECH_NAME><MODEL_VERSION>0001</MODEL_VERSION></_-IWBEP_-I_MGW_SRG><_-IWBEP_-I_MGW_SRH><TECHNICAL_NAME>${id}_SRV</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>${dpc}</CLASS_NAME></_-IWBEP_-I_MGW_SRH></abapGit>`);
    if(mpc) write(`${id}.iwmo.xml`,`<abapGit><TECHNICAL_NAME>${id}_MDL</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>${mpc}</CLASS_NAME></abapGit>`);
  }
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-a10-"));mkdirSync(join(root,"src"));
    writeFileSync(join(root,"abaplint.jsonc"),JSON.stringify({syntax:{version:"v702"},rules:{}}));
    for(const file of readdirSync("src/demo").filter((f) => /\.(iwsv|iwmo)\.xml$|_(dpc|mpc)(_ext)?\.clas\.abap$/.test(f))) write(file,readFileSync(join("src/demo",file),"utf8"));
    const generated=readFileSync("gen/stg/zosd_test/zcl_zosd_test_mpc.clas.abap","utf8");
    write("zcl_zosd_test_mpc.clas.abap",generated);
    const generatedSets=[...generated.matchAll(/->create_entity_set\s*\(\s*'([^']+)'/gi)].map((m) => m[1]);
    expect(generatedSets.length).to.be.greaterThan(0);
    write("zcl_generated_dpc.clas.abap",generatedSets.map((set) => `METHOD ${set.slice(0,16)}_get_entityset.\nENDMETHOD.`).join("\n"));
    register("zgenerated","ZCL_GENERATED_DPC","ZCL_ZOSD_TEST_MPC");
    const dpc=`  METHOD abcdefghijklmnop_get_entityset.\nENDMETHOD.\nMETHOD unique_prefix_16_get_entityset.\nENDMETHOD.\nMETHOD emptyset_get_entity.\nENDMETHOD.\nMETHOD travels_get_entity.\nENDMETHOD.\nMETHOD travels_get_entityset.\nENDMETHOD.\nMETHOD unknown_get_entityset.\nENDMETHOD.\nMETHOD travels_get_entityset.\nENDMETHOD.\nMETHOD travels_get_entityset. WRITE 'inline ignored'.\n* METHOD travels_get_entityset.\n`;
    const mpc=`CONSTANTS gc_one\n TYPE /iwbep/if_mgw_med_odata_types=>ty_e_med_entity_name\n VALUE 'abcdefghijklmnopOne'.\nCONSTANTS gc_two TYPE ty_e_med_entity_name VALUE 'abcdefghijklmnopTwo'.\nCONSTANTS gc_unique TYPE ty_e_med_entity_name VALUE 'unique_prefix_16Long'.\nCONSTANTS gc_old TYPE ty_e_med_entity_name VALUE 'OldSet'.\nCONSTANTS GC_OLD TYPE ty_e_med_entity_name VALUE 'Travels'.\nCONSTANTS gc_empty TYPE ty_e_med_entity_name VALUE 'EmptySet'.\nmodel->create_entity_set( 'TRAVELS' ).\n`;
    for(const [id,eol] of [["zscan","\n"],["zcrlf","\r\n"]]) {
      const cls=id.toUpperCase();register(id,cls+"_DPC_EXT",cls+"_MPC_EXT");
      write(id+"_dpc_ext.clas.abap",dpc.replaceAll("\n",eol));
      write(id+"_mpc_ext.clas.abap",mpc.replaceAll("\n",eol));
    }
    register("znomodel","ZNO_MODEL_DPC",undefined);
    register("zmissing","ZMISSING_DPC_EXT","ZMISSING_MPC_EXT");
    write("zmissing_dpc.clas.abap","METHOD travels_get_entityset.\nENDMETHOD.");
    write("zmissing_mpc.clas.abap",mpc);
    register("zempty","ZEMPTY_DPC","ZEMPTY_MPC");
    write("zempty_dpc.clas.abap","");write("zempty_mpc.clas.abap","");
    store=new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    const klass=abap.Classes.ZCL_OSD_ADT_ENTITYSETS,original=klass.sets;
    if(process.env.OSD_ADT_RED==="byte") {
      klass.sets=async (...args) => {const r=await original.apply(klass,args);r.set(r.get()+" ");return r;};
      restore=() => {klass.sets=original;};
    }
    const mount=async (isAbap) => {
      const app=express();app.set("etag",false);app.use(express.raw({type:"*/*"}));
      const facade=adtRouter({store,data:{},watch:false,logMisses:false,transpileOnActivate:false,...(isAbap ? {
        abap:abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
        abapServed:(by,req) => served.push(`${by} ${req.method} ${clean(req.originalUrl)}`)} : {})});
      if(isAbap && process.env.OSD_ADT_RED==="host") {
        const router=abap.Classes.ZCL_OSD_ADT_ROUTER,originalRoutes=router.routes;
        router.routes=async (...args) => {const rows=await originalRoutes.apply(router,args);
          for(const row of rows.array()) if(row.get().pattern.get()===path) row.get().served_by.set("HOST");return rows;};
        restore=() => {router.routes=originalRoutes;};
      }
      app.use(facade.router);
      const server=await new Promise((resolve) => {const s=app.listen(0,"127.0.0.1",() => resolve(s));});
      return {server,facade};
    };
    node=await mount(false);ported=await mount(true);
  });
  after(async () => {restore?.();for(const side of [node,ported]) if(side) await new Promise((r) => side.server.close(r));if(root) rmSync(root,{recursive:true,force:true});});
  async function diff(url,method="GET") {
    const expected=await wire(node.server,url,method);served.length=0;
    const actual=await wire(ported.server,url,method);
    expect(actual.body.toString()).to.equal(expected.body.toString());
    expect(actual).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${clean(url)}`]);
    return actual;
  }
  it("demo DPC_EXT and inherited MPC constants",async () => {
    const r=await diff(path+"?class=zcl_zstg_demo_dpc_ext");expect(r.status).to.equal(200);
    expect(JSON.parse(r.body).sets.map((s) => s.set)).to.include.members(["TravelSet","BookingSet","PhotoSet","StatusVHSet"]);
  });
  it("STG-generated MPC create_entity_set calls",async () => {const r=await diff(path+"?class=ZCL_GENERATED_DPC");expect(r.status).to.equal(200);expect(JSON.parse(r.body).sets).to.have.length.greaterThan(0);});
  for(const cls of ["ZSCAN","ZCRLF"]) it(`${cls}: multiline constants, 16-character ambiguous/unique prefixes, order and dedupe`,async () => {
    const r=await diff(path+"?class="+cls+"_DPC_EXT");expect(r.status).to.equal(200);
    expect(JSON.parse(r.body).sets).to.deep.equal([
      {method:"UNIQUE_PREFIX_16_GET_ENTITYSET",kind:"get_entityset",set:"unique_prefix_16Long"},
      {method:"TRAVELS_GET_ENTITYSET",kind:"get_entityset",set:"TRAVELS"},
      {method:"EMPTYSET_GET_ENTITY",kind:"get_entity",set:"EmptySet"},
      {method:"TRAVELS_GET_ENTITY",kind:"get_entity",set:"TRAVELS"}]);
  });
  for(const [query,status] of [["",400],["?class=",400],["?class=ZUNKNOWN",404],["?class=ZNO_MODEL_DPC",404],["?class=ZMISSING_DPC_EXT",200],["?class=ZEMPTY_DPC",200],["?class=ZSCAN_DPC_EXT&class=ZCRLF_DPC_EXT",404]]) {
    it(`${status} ${query||"no class"}`,async () => {expect((await diff(path+query)).status).to.equal(status);expect(ported.facade.missed.size).to.equal(node.facade.missed.size);});
  }
  for(const method of ["GET","HEAD"]) it(`${method} case and trailing slash`,async () => {expect((await diff(path.toUpperCase()+"/?class=ZSCAN_DPC_EXT",method)).status).to.equal(200);});
  it("missing sources are 404; read errors are swallowed",async () => {
    const original=store.read;store.read=() => {throw new Error("source unavailable");};
    try {expect((await diff(path+"?class=ZSCAN_DPC_EXT")).status).to.equal(404);} finally {store.read=original;}
  });
  it("registration throw has the wrapped Node 500 document",async () => {
    const broken=join(root,"src","zbroken.iwsv.xml");symlinkSync(join(root,"absent"),broken);
    try {expect((await diff(path+"?class=ZSCAN_DPC_EXT")).status).to.equal(500);} finally {unlinkSync(broken);}
  });
});

describe("A10 serving-child registration facts",function () {
  this.timeout(120000);
  let runtime;
  const servers=[],served=[];
  before(async () => {
    const store=new ObjectStore({root:process.cwd()});
    runtime=new ServingRuntime({root:process.cwd(),env:{OSD_ADT_ONE_RUNTIME:"1",STG_DB:"sqlite",STG_DB_PATH:join(tmpdir(),"a10-child.sqlite")}});
    runtime.storeDestination=new StoreDestination({store});
    await runtime.start();
  });
  after(async () => {for(const server of servers) await new Promise((r) => server.close(r));await runtime?.stop();});
  it("parent registration walk and READ reach the serving ABAP route over IPC",async () => {
    const store=new ObjectStore({root:process.cwd()});
    async function mount(isAbap) {
      const app=express();app.set("etag",false);
      app.use(adtRouter({store,data:{},watch:false,logMisses:false,...(isAbap ? {
        abap:abapRunner({remote:runtime}),abapServed:(by,req) => served.push(`${by} ${clean(req.originalUrl)}`)} : {})}).router);
      const server=await new Promise((r) => {const s=app.listen(0,"127.0.0.1",() => r(s));});servers.push(server);return server;
    }
    const node=await mount(false),ported=await mount(true);
    for(const [query,status] of [["?class=ZCL_ZSTG_DEMO_DPC_EXT",200],["?class=ZUNKNOWN",404],["?",400]]) {
      const expected=await wire(node,path+query);served.length=0;
      const actual=await wire(ported,path+query);
      expect(actual.body.toString()).to.equal(expected.body.toString());
      expect(actual).to.deep.equal(expected);expect(actual.status).to.equal(status);
      expect(served).to.deep.equal([`ABAP ${clean(path+query)}`]);
    }
  });
});
