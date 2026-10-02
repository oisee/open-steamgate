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
  for (const kind of ["OUTLINE","DDLS","unknown","toString","__proto__",undefined]) it(`unsupported kind ${kind}`,async () => {
    const result=await call(new StoreDestination({store:() => {throw new Error("unsupported kind must not open a store");}}),{kind});expect(JSON.parse(result.EV_JSON).error.code).to.equal("NOT_SUPPORTED");
  });
  for (const json of ["", "{", "null"]) it(`bad PARSE JSON ${JSON.stringify(json)} refuses without opening a store`,async () => {
    const destination=new StoreDestination({store:() => {throw new Error("bad JSON must not open a store");}});
    const signature={exporting:{iv_command:box("PARSE"),iv_json:box(json)},importing:{ev_json:box(""),ev_error:box("")}};
    await destination.call("ZOSD_STORE",signature);
    const result=answerOf(signature);
    expect(JSON.parse(result.EV_JSON)).to.have.property("error");
    expect(result.EV_ERROR).not.to.include("must not open");
  });
  it("a silent warm-up refuses the STORE request within its bound",async () => {
    const previous=process.env.OSD_TRANSITION_MS;
    process.env.OSD_TRANSITION_MS="20";
    try {
      const store={unitReady:new Promise(() => {}),unit:() => {throw new Error("must await warm-up first");}};
      const result=await call(new StoreDestination(),{kind:"UNIT_PLAN",type:"CLAS",name:"ZCL_X"},store);
      expect(result.EV_ERROR).to.include("pre-warm silent for 20 ms");
    } finally {
      if(previous===undefined) delete process.env.OSD_TRANSITION_MS;else process.env.OSD_TRANSITION_MS=previous;
    }
  });
  it("warm-up progress extends the silence bound",async () => {
    const previous=process.env.OSD_TRANSITION_MS;
    process.env.OSD_TRANSITION_MS="40";
    const store={unit:async () => ({classes:(t,n) => plan(t,n)})};
    store.unitWarmHeard=Date.now();
    let release;
    store.unitReady=new Promise((resolve) => {release=resolve;});
    const progress=setInterval(() => {store.unitWarmHeard=Date.now();},10);
    const complete=setTimeout(release,100);
    try {
      const result=await call(new StoreDestination(),{kind:"UNIT_PLAN",type:"CLAS",name:"ZCL_X"},store);
      expect(result.EV_ERROR).to.equal("");
      expect(JSON.parse(result.EV_JSON).object.name).to.equal("ZCL_X");
    } finally {
      clearInterval(progress);clearTimeout(complete);release();
      if(previous===undefined) delete process.env.OSD_TRANSITION_MS;else process.env.OSD_TRANSITION_MS=previous;
    }
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
  for (const front of ["js","abap"]) for (const outcome of ["warm","silent","rejected"])
    it(`${front}: listens before warm-up; first unit/object request handles ${outcome}`,async () => {
    const originalUnit=ObjectStore.prototype.unit, originalRegistry=ObjectStore.prototype.registry;
    const tls=process.env.STG_TLS, adt=process.env.OSD_ADT, silence=process.env.OSD_TRANSITION_MS;
    const originalError=console.error, errors=[];
    console.error=(...args) => errors.push(args.join(" "));
    let release,reject,store,server,entered;
    const waiting=new Promise((resolve) => {entered=resolve;});
    const ready=new Promise((resolve,fail) => {release=resolve;reject=fail;});
    ObjectStore.prototype.unit=async function () {store=this;return {risk:{writesReached:() => {entered();return ready;}},classes:(type,name) => ({object:{type,name},classes:[]}),withRisk:async (p) => ({...p,writes:[],writesTotal:0})};};
    ObjectStore.prototype.registry=() => ({getObjects:() => ["fixture"]});
    process.env.STG_TLS="0";process.env.OSD_ADT=front;
    process.env.OSD_TRANSITION_MS=outcome==="silent" ? "100" : "30000";
    try {
      server=startServer(false);
      if (!server.listening) await once(server,"listening");
      expect(server.listening).to.equal(true);
      await waiting;
      const origin=`http://127.0.0.1:${server.address().port}`;
      expect((await fetch(origin+"/osd/ready")).status).to.equal(200);
      let answered=false;
      const response=fetch(origin+base+"core/http/unit/object?type=CLAS&name=ZCL_X").then((r) => {answered=true;return r;});
      await new Promise((resolve) => setTimeout(resolve,50));
      expect(answered).to.equal(false);
      if(outcome==="warm") release();
      if(outcome==="rejected") reject(new Error("fixture warm failure"));
      const result=await response;
      expect(result.status).to.equal(outcome==="silent" ? 500 : 200);
      if(outcome==="silent") expect(await result.text()).to.include("pre-warm silent for 100 ms");
      if(outcome==="rejected") expect(errors).to.deep.equal(["unit plan: pre-warm failed: fixture warm failure"]);
    } finally {
      release();
      if(server) await server.close();
      store?.unwatch();
      ObjectStore.prototype.unit=originalUnit;ObjectStore.prototype.registry=originalRegistry;
      console.error=originalError;
      if(silence===undefined) delete process.env.OSD_TRANSITION_MS;else process.env.OSD_TRANSITION_MS=silence;
      if(adt===undefined) delete process.env.OSD_ADT;else process.env.OSD_ADT=adt;
      if(tls===undefined) delete process.env.STG_TLS;else process.env.STG_TLS=tls;
    }
  });
});
