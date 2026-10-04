import {expect} from "chai";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {sliceFronts} from "./helpers/adt-slice.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {TYPES} from "../tools/osd-store-types.mjs";
import {StoreDestination,withSystem,COMMANDS} from "../tools/osd-store-destination.mjs";
import {box,answerOf} from "./helpers/destination.mjs";

const base = "/sap/bc/adt/";
const uri = base+"oo/classes/zcl_check";
const clean = "CLASS zcl_check DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_check IMPLEMENTATION.\nENDCLASS.\n";
const block = (u=uri,content,include="") => `<chkrun:checkObject xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="${u}">${include ? `<chkrun:artifact chkrun:uri="${uri}/includes/${include}/source/main"/>` : ""}${content === undefined ? "" : `<chkrun:content>${content}</chkrun:content>`}</chkrun:checkObject>`;
describe("C1 checkruns live Node byte diff",function () {
  this.timeout(120000);
  let root,store,fronts;
  before(async () => {
    root = mkdtempSync(join(tmpdir(),"osd-c1-")); mkdirSync(join(root,"src"));
    writeFileSync(join(root,"src/package.devc.xml"),"<abapGit><DEVC><DEVCLASS>$TMP</DEVCLASS></DEVC></abapGit>");
    writeFileSync(join(root,"src/zcl_check.clas.abap"),clean);
    writeFileSync(join(root,"src/zcl_check.clas.testclasses.abap"),"CLASS ltcl_check DEFINITION FOR TESTING. PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS. CLASS ltcl_check IMPLEMENTATION. METHOD check. ENDMETHOD. ENDCLASS.");
    writeFileSync(join(root,"src/zt_value.dtel.xml"),"<abapGit><DD04V><ROLLNAME>ZT_VALUE</ROLLNAME><DATATYPE>CHAR</DATATYPE><LENG>10</LENG></DD04V></abapGit>");
    writeFileSync(join(root,"abaplint.jsonc"),JSON.stringify({global:{files:"/src/**/*.*"},syntax:{version:"v702"},rules:{}}));
    store = new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    store.create("PROG","/DEMO/X",{package:"$TMP"});
    store.create("PROG","ZT_A",{package:"$TMP"});
    if (process.env.OSD_ADT_RED === "join") {
      const klass = abap.Classes.ZCL_OSD_ADT_CHECKREPORT, original = klass.document;
      klass.document = async (...args) => { const result = await original.apply(klass,args); result.set(result.get().replace("<chkrun:checkMessageList>\n\n","<chkrun:checkMessageList>\n")); return result; };
    }
    if (process.env.OSD_ADT_RED === "host") {
      const klass = abap.Classes.ZCL_OSD_ADT_ROUTER, original = klass.routes;
      klass.routes = async (...args) => { const result = await original.apply(klass,args); for (const row of result.array()) if (row.get().handler.get() === "ZCL_OSD_ADT_CHECKRUN") row.get().served_by.set("HOST"); return result; };
    }
    fronts = await sliceFronts(store);
  });
  after(async () => { if (fronts) await fronts.close(); if (root) rmSync(root,{recursive:true,force:true}); });
  const post = (body) => fronts.diff(base+"checkruns?reporters=ignored","POST",body,{"content-type":"application/xml"});
  for (const path of ["checkruns/reporters","ChEcKrUnS/RePoRtErS/"]) for (const method of ["GET","HEAD"])
    it(`reporters ${path} ${method}`,async () => { expect((await fronts.diff(base+path,method)).status).to.equal(200); });
  it("pins TYPES order",async () => { expect((await abap.Classes.ZCL_OSD_ADT_TYPES.all()).array().map((r) => r.get().type.get())).to.deep.equal(Object.keys(TYPES)); });
  it("1 clean base64 overlay and empty message list",async () => { const r = await post(block(uri,Buffer.from(clean).toString("base64"))); expect(r.body.toString()).to.include("<chkrun:checkMessageList>\n\n").and.include(`chkrun:statusText="no errors"`); });
  it("2 broken entity overlay never writes disk",async () => { await post(block(uri,"CLASS zcl_check DEFINITION. &lt;bad&gt; &amp; ENDCLASS.")); expect(readFileSync(join(root,"src/zcl_check.clas.abap"),"utf8")).to.equal(clean); });
  it("3 testclasses include",async () => { await post(block(uri,"CLASS ltcl_check DEFINITION FOR TESTING. ENDCLASS.","testclasses")); });
  it("4 AMDP warnings follow errors and count as messages",async () => {
    const source = `CLASS zcl_check DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS run.
ENDCLASS.
CLASS zcl_check IMPLEMENTATION.
  METHOD run BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT.
    call unsupported_procedure();
  ENDMETHOD.
ENDCLASS.`;
    const r = await post(block(uri,source)); expect(r.body.toString()).to.include('chkrun:type="W"');
  });
  it("5 dictionary presence and missing",async () => { for (const name of ["zt_value","missing"]) await post(block(base+"ddic/dataelements/"+name)); });
  it("6 missing class with and without overlay",async () => { await post(block(base+"oo/classes/zcl_new")); await post(block(base+"oo/classes/zcl_new",clean.replaceAll("zcl_check","zcl_new"))); });
  it("7 empty overlay differs from absent",async () => { await post(block(uri,"")); expect((await post(block(uri))).status).to.equal(200); });
  it("8 package DEVC quirk and host ordering with namespaced child",async () => { const r = await post(block(base+"packages/%24tmp")); const body = r.body.toString(); expect(body).to.include("%2Fdemo%2Fx"); expect(body.match(/triggeringUri="\/sap\/bc\/adt\/packages\/[^\"]+"/g)).to.have.length(2); });
  it("9 missing package preserves original spelling",async () => { const r = await post(block(base+"packages/ZNoPe")); expect(r.body.toString()).to.include("package ZNoPe does not exist"); });
  it("10 legacy references canonical URI",async () => { await post(`<adtcore:objectReference xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="${uri.toUpperCase().replace("/SAP/BC/ADT/OO/CLASSES/","/sap/bc/adt/oo/classes/")}/source/main?x#f"/>`); });
  it("11 empty or unknown request",async () => { for (const b of [`<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun"/>`,block(base+"unknown/x")]) expect((await post(b)).status).to.equal(400); });
  it("12 malformed percent escape",async () => { expect((await post(block(uri+"%zz"))).status).to.equal(500); });
  it("13 base64 lookalikes, bad UTF8, missing padding and whitespace",async () => { for (const content of ["REPORT ztest","/wo=",Buffer.from(clean).toString("base64").replace(/=+$/,"").replace(/(.{12})/g,"$1\n")]) await post(block(uri,content)); });
  it("14 raw XML entity URI echoes escaped",async () => { await post(block(uri+"&amp;")); await post(block(uri+'%22')); });
  it("15 UTF8 issue text",async () => {
    const original = store.check; store.check = () => ({issues:[{message:'é & < > " apostrophe\'',line:2,column:3}]});
    try { const r = await post(block(uri,"")); expect(r.body.toString()).to.include("é &amp;"); } finally { store.check = original; }
  });
  it("12 issues retain Node byte order",async () => {
    const original = store.check;
    store.check = () => ({issues:Array.from({length:12},(_,i) => ({message:`issue ${i}`,line:i+1,column:1}))});
    try { const r = await post(block(uri,"")); expect(r.body.toString().match(/chkrun:type="E"/g)).to.have.length(12); }
    finally { store.check = original; }
  });
  it("package check with 12 objects retains Node byte order",async () => {
    const original = store.package;
    const objects = Array.from({length:12},(_,i) => ({type:"PROG",name:`ZT_ORDER_${String(i).padStart(2,"0")}`}));
    for (const object of objects) store.create(object.type,object.name,{package:"$TMP"});
    store.package = () => ({name:"$TMP",objects});
    try { const r = await post(block(base+"packages/%24tmp")); expect(r.body.toString().match(/chkrun:triggeringUri="\/sap\/bc\/adt\/programs\/programs\/zt_order_/g)).to.have.length(12); }
    finally { store.package = original; }
  });
  it("absent CHECKRUN refuses instead of falling through",async () => {
    const at = COMMANDS.indexOf("CHECKRUN"); COMMANDS.splice(at,1);
    try { // Node remains the oracle for ordinary requests; this explicitly tests host capability refusal.
      const input = {exporting:{iv_command:box("CHECKRUN")},importing:{ev_error:box(""),ev_json:box("")}};
      await new StoreDestination({store}).call("ZOSD_STORE",input); expect(JSON.parse(answerOf(input).EV_JSON).error.code).to.equal("NOT_SUPPORTED");
    } finally { COMMANDS.splice(at,0,"CHECKRUN"); }
  });
});
describe("C1 CHECKRUN bound destination",() => {
  it("uses bound store and preserves empty SOURCE overlay",async () => {
    const destination = new StoreDestination({store:() => { throw new Error("default store must not open"); }});
    const overlays = [];
    const store = {check:(_t,n,o) => { overlays.push(o.source); return {issues:[{message:n}]}; },read:() => ({source:""})};
    for (const filter of ["SOURCE",""]) {
      const signature = {exporting:{iv_command:box("CHECKRUN"),iv_type:box("CLAS"),iv_name:box("ZCL_BOUND"),iv_source:box(""),iv_filter:box(filter)},importing:{ev_json:box(""),ev_error:box("")}};
      await withSystem(() => ({}),() => destination.call("ZOSD_STORE",signature),{store});
      const result = answerOf(signature); expect(result.EV_ERROR).to.equal(""); expect(JSON.parse(result.EV_JSON).issues[0]).to.deep.equal({severity:"E",line:1,column:1,message:"ZCL_BOUND"});
    }
    expect(overlays).to.deep.equal(["",undefined]);
  });
});
describe("C1 focused ABAP Unit",() => {
  for (const method of ["content","reporters"]) it(method,async () => {
    const {ltcl_protocol} = await import("../output/zcl_osd_adt_checkrun.clas.testclasses.mjs");
    const instance = new ltcl_protocol(); await instance.constructor_();
    await instance.FRIENDS_ACCESS_INSTANCE[method]();
  });
});
