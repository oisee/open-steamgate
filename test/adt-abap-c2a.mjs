import {expect} from "chai";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";
import {startServer} from "./start.mjs";
import {sliceFronts} from "./helpers/adt-slice.mjs";
import {ObjectStore,NotFound} from "../tools/osd-store.mjs";
import {unitClasses,unitPlan,warmUnitPlan} from "../tools/osd-unit.mjs";
import {StoreDestination,withSystem,COMMANDS} from "../tools/osd-store-destination.mjs";
import {box,answerOf} from "./helpers/destination.mjs";

const base="/sap/bc/adt/";
const escapes='é < > & \\" /\b\f\n\r\t'+String.fromCharCode(...Array.from({length:32},(_,i) => i))+'😀';
const plan = (type,name) => ({object:{type,name:name === "ZCL_ESCAPES" ? escapes : name,private:"hidden"},
  classes:[{name:escapes,riskLevel:"harmless",riskLevelDeclared:false,durationCategory:"short",durationDeclared:true,
    include:"testclasses",line:3,column:2,localClass:"hidden",testMethods:[{name:escapes,line:5,column:7,method:"hidden"}]}]});
describe("C2a metadata and unit object live Node byte diff",function () {
  this.timeout(120000);
  let root,store,fronts;
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-c2a-")); mkdirSync(join(root,"src"));
    writeFileSync(join(root,"abaplint.jsonc"),JSON.stringify({global:{files:"/src/**/*.*"},syntax:{version:"v702"},rules:{}}));
    writeFileSync(join(root,"abap_transpile.json"),JSON.stringify({input_folder:["src"]}));
    writeFileSync(join(root,"src/zcl_discover.clas.abap"),"CLASS zcl_discover DEFINITION PUBLIC. ENDCLASS. CLASS zcl_discover IMPLEMENTATION. ENDCLASS.");
    writeFileSync(join(root,"src/zcl_discover.clas.testclasses.abap"),"CLASS ltcl_discover DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT. PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS. CLASS ltcl_discover IMPLEMENTATION. METHOD check. ENDMETHOD. ENDCLASS.");
    store=new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    store.tests={classes:(type,name) => {
      if (name === "ZCL_MISSING" || name === "") throw new NotFound(type,name);
      if (name === "ZCL_ERROR") throw new Error(escapes);
      if (name === "ZCL_MANY") {
        const p=plan(type,name);
        p.classes=Array.from({length:12},(_,i) => ({...p.classes[0],name:`LTCL_${i}`,testMethods:Array.from({length:12},(_,j) => ({name:`METHOD_${j}`,line:j,column:1}))}));
        return p;
      }
      return name === "ZCL_EMPTY" ? {object:{type,name},classes:[]} : plan(type,name);
    },withRisk:async (p) => ({...p,writes:[{object:escapes,kind:"INSERT",file:escapes,line:2}],writesTotal:1,
      ...(p.object.name === "ZCL_RISK_ERROR" ? {riskError:escapes} : {}),
      classes:p.classes.map((c) => ({...c,schedule:"dangerous",guard:false}))})};
    if (process.env.OSD_ADT_RED === "json") {
      const klass=abap.Classes.ZCL_OSD_ADT_UNIT_OBJECT,original=klass.document;
      klass.document=async (...args) => { const r=await original.apply(klass,args); r.set(r.get()+"\n"); return r; };
    }
    if (process.env.OSD_ADT_RED === "metadata") {
      const klass=abap.Classes.ZCL_OSD_ADT_UNIT_OBJECT,original=klass.metadata;
      klass.metadata=async (...args) => { const r=await original.apply(klass,args); r.set(r.get()+"\n"); return r; };
    }
    if (process.env.OSD_ADT_RED === "host") {
      const klass=abap.Classes.ZCL_OSD_ADT_ROUTER,original=klass.routes;
      klass.routes=async (...args) => { const r=await original.apply(klass,args); for (const row of r.array()) if (row.get().handler.get() === "ZCL_OSD_ADT_UNIT_OBJECT") row.get().served_by.set("HOST"); return r; };
    }
    fronts=await sliceFronts(store);
  });
  after(async () => {if(fronts) await fronts.close();if(root) rmSync(root,{recursive:true,force:true});});
  for (const method of ["GET","HEAD"]) for (const path of ["abapunit/metadata","AbApUnIt/MeTaDaTa/"])
    it(`metadata ${path} ${method}`,async () => { expect((await fronts.diff(base+path,method)).status).to.equal(200); });
  for (const [type,name,status] of [["CLAS/OC","zcl_discover",200],["clas","zcl_discover",200],["PROG","zt_prog",200],["INTF","zi_test",400],["","zcl_discover",400],["CLAS","zcl_missing",404],["CLAS","",404],["CLAS","zcl_error",500],["CLAS","zcl_empty",200],["CLAS","zcl_many",200],["CLAS","zcl_escapes",200],["CLAS","zcl_risk_error",200]])
    it(`unit/object ${type} ${name} ${status}`,async () => {
      const r=await fronts.diff(base+"core/http/unit/object?"+new URLSearchParams({type,name})); expect(r.status).to.equal(status);
      if (status===200) {
        const body=JSON.parse(r.body); expect(body).not.to.have.property("private");
      }
    });
  it("riskError is present only when provided",async () => {
    for (const name of ["ZCL_DISCOVER","ZCL_RISK_ERROR"]) {
      const r=await fronts.diff(base+"core/http/unit/object?type=CLAS&name="+name);
      expect(Object.hasOwn(JSON.parse(r.body),"riskError")).to.equal(name==="ZCL_RISK_ERROR");
    }
  });
  it("real parser and risk graph share exported unitClasses and unitPlan",async () => {
    delete store.tests;
    const direct=unitClasses(store,"CLAS","ZCL_DISCOVER"); expect(direct.classes[0].name).to.equal("LTCL_DISCOVER");
    const parsed=await unitPlan(store,"CLAS","ZCL_DISCOVER",{risk:true}); expect(parsed.classes[0].testMethods[0].name).to.equal("CHECK");
    const warmed=await warmUnitPlan(store); expect(warmed.objects).to.be.greaterThan(0);
    const r=await fronts.diff(base+"core/http/unit/object?type=CLAS/OC&name=zcl_discover");expect(r.status).to.equal(200);
  });
  it("absent PARSE command refuses with 501",async () => {
    const at=COMMANDS.indexOf("PARSE"); COMMANDS.splice(at,1);
    try {
      const response=await abap.Classes.ZCL_OSD_ADT_HOST.require({iv_command:new abap.types.String().set("PARSE")}).catch((e) => e);
      expect(response.status.get()).to.equal(501);
    } finally { COMMANDS.splice(at,0,"PARSE"); }
  });
});
describe("C2a PARSE dispatcher destination",() => {
  async function call(destination,input,store) {
    const signature={exporting:{iv_command:box("PARSE"),iv_json:box(JSON.stringify(input))},importing:{ev_json:box(""),ev_error:box("")}};
    await withSystem(() => ({}),() => destination.call("ZOSD_STORE",signature),{store});return answerOf(signature);
  }
  for (const kind of ["OUTLINE","DDLS","unknown",undefined]) it(`unsupported kind ${kind}`,async () => {
    const result=await call(new StoreDestination({store:() => {throw new Error("unsupported kind must not open a store");}}),{kind});expect(JSON.parse(result.EV_JSON).error.code).to.equal("NOT_SUPPORTED");
  });
  it("bound runner is used; risk false skips enrichment and risk true invokes it",async () => {
    const destination=new StoreDestination({store:() => {throw new Error("default must not open");}});
    let calls=0;
    const store={unit:async () => ({classes:(t,n) => plan(t,n),withRisk:async (p) => {calls++;return {...p,writes:[],writesTotal:0};}})};
    for (const risk of [false,true]) {
      const result=await call(destination,{kind:"UNIT_PLAN",type:"clas",name:"zcl_x",risk},store);
      expect(result.EV_ERROR).to.equal("");expect(JSON.parse(result.EV_JSON).object.name).to.equal("ZCL_X");
    }
    expect(calls).to.equal(1);
  });
});
describe("C2a focused ABAP Unit",() => {
  for (const method of ["projection","metadata"]) it(method,async () => {
    const {ltcl_discovery}=await import("../output/zcl_osd_adt_unit_object.clas.testclasses.mjs");
    const instance=new ltcl_discovery();await instance.constructor_();await instance.FRIENDS_ACCESS_INSTANCE[method]();
  });
});

describe("C2a serving startup",function () {
  this.timeout(30000);
  it("does not listen until the unit graph is warm",async () => {
    const originalUnit=ObjectStore.prototype.unit, originalRegistry=ObjectStore.prototype.registry;
    const tls=process.env.STG_TLS;
    let release,store,server;
    const ready=new Promise((resolve) => {release=resolve;});
    ObjectStore.prototype.unit=async function () {store=this;return {risk:{writesReached:() => ready}};};
    ObjectStore.prototype.registry=() => ({getObjects:() => ["fixture"]});
    process.env.STG_TLS="0";
    try {
      server=startServer(false);
      expect(server.listening).to.equal(false);
      const listening=once(server,"listening");
      release();await listening;
      expect(server.listening).to.equal(true);
    } finally {
      release();
      if(server) await server.close();
      store?.unwatch();
      ObjectStore.prototype.unit=originalUnit;ObjectStore.prototype.registry=originalRegistry;
      if(tls===undefined) delete process.env.STG_TLS;else process.env.STG_TLS=tls;
    }
  });
});
