import {expect} from "chai";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {liveHash} from "../tools/osd-build.mjs";
import {closeWarm} from "../tools/osd-store-warm.mjs";
import {warmCheck} from "../tools/adt-warm-check.mjs";
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
  it("creation validation and package URI match on ABAP and Node", async () => {
    const before = readFileSync(join(root,"src/zcl_check.clas.abap"),"utf8");
    for (const [resource, type, name] of [["oo/validation/objectname", "CLAS/OC", "ZCL_NEW"], ["packages/validation", "DEVC/K", "$NEW"]]) {
      const params = new URLSearchParams({objtype:type,objname:name,packagename:"$TMP"});
      const r = await fronts.diff(base+resource+"?"+params,"POST");
      expect(r.body.toString()).to.include("<CHECK_RESULT>X</CHECK_RESULT>");
      params.set("packagename", "$MISSING");
      expect((await fronts.diff(base+resource+"?"+params,"POST")).body.toString()).to.include("<SEVERITY>ERROR</SEVERITY>");
    }
    const mixed = new URLSearchParams({objtype:"DEVC/K",objname:"$MIXED",packagename:"$TMP"});
    expect((await fronts.diff(base+"PaCkAgEs/VaLiDaTiOn/?"+mixed,"POST")).body.toString()).to.include("<CHECK_RESULT>X</CHECK_RESULT>");
    for (const name of ["ZNEW", "$TMP_"]) {
      const params = new URLSearchParams({objtype:"DEVC/K",objname:name,packagename:"$TMP"});
      // $TMP_ is a local name but CREATE refuses its empty folder suffix.
      const r = await fronts.diff(base+"packages/validation?"+params,"POST");
      expect(r.body.toString()).to.include("<SEVERITY>ERROR</SEVERITY>");
    }
    expect((await fronts.diff(base+"packages/%24tmp")).body.toString()).to.include('adtcore:uri="/sap/bc/adt/packages/%24tmp"');
    expect(store.find("CLAS","ZCL_NEW")).to.equal(undefined);
    expect(readFileSync(join(root,"src/zcl_check.clas.abap"),"utf8")).to.equal(before);
  });
  it("discovery tells the creation wizard both validation addresses and package property/value-help templates", async () => {
    const r = await fronts.diff(base+"discovery");
    const xml = r.body.toString();
    expect(xml).to.include('href="/sap/bc/adt/packages/validation"');
    expect(xml).to.include('href="/sap/bc/adt/packages/settings"');
    expect(xml).to.include('term="devck/validation" scheme="http://www.sap.com/wbobj/packages"');
    expect(xml).to.include('href="/sap/bc/adt/oo/validation/objectname"');
    expect(xml).to.include('rel="http://www.sap.com/wbobj/packages/devck/properties"');
    for (const name of ["applicationcomponents", "softwarecomponents", "transportlayers", "translationrelevances", "abaplanguageversions"])
      expect(xml).to.include(`rel="${name}" template="/sap/bc/adt/packages/valuehelps/${name}"`);
  });
  it("pins TYPES order",async () => { expect((await abap.Classes.ZCL_OSD_ADT_TYPES.all()).array().map((r) => r.get().type.get())).to.deep.equal(Object.keys(TYPES)); });
  it("1 clean base64 overlay and empty message list",async () => { const r = await post(block(uri,Buffer.from(clean).toString("base64"))); expect(r.body.toString()).to.include("<chkrun:checkMessageList>\n\n").and.include(`chkrun:statusText="no errors"`); });
  it("single-line base64 artifact is checked as ABAP without writing", async () => {
    const oneLine = clean.replaceAll("\n", " ");
    const r = await post(block(uri, Buffer.from(oneLine).toString("base64")));
    expect(r.body.toString()).to.include('chkrun:statusText="no errors"');
    expect(readFileSync(join(root,"src/zcl_check.clas.abap"),"utf8")).to.equal(clean);
  });
  it("base64 comments and invalid single-line source decode before Check", async () => {
    const comment = "* comment";
    const r = await post(block(uri, Buffer.from(comment).toString("base64"), "testclasses"));
    expect(r.body.toString()).to.include('chkrun:statusText="no errors"');
    const invalid = "THIS IS INVALID ABAP";
    const bad = await post(block(uri, Buffer.from(invalid).toString("base64")));
    expect(bad.body.toString()).to.include('chkrun:type="E"');
    expect(bad.body.toString()).not.to.include(Buffer.from(invalid).toString("base64"));
  });
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
describe("C1 discovery ABAP Unit", () => {
  for (const method of ["ordered_collections", "workspace_order", "document_quirks", "head_and_get"]) it(method, async () => {
    const {ltcl_discovery} = await import("../output/zcl_osd_adt_discovery.clas.testclasses.mjs");
    const instance = new ltcl_discovery(); await instance.constructor_();
    await instance.FRIENDS_ACCESS_INSTANCE[method]();
  });
});
describe("C1 focused ABAP Unit",() => {
  for (const method of ["content","reporters"]) it(method,async () => {
    const {ltcl_protocol} = await import("../output/zcl_osd_adt_checkrun.clas.testclasses.mjs");
    const instance = new ltcl_protocol(); await instance.constructor_();
    await instance.FRIENDS_ACCESS_INSTANCE[method]();
  });
});

describe("C1 warm Check through Node and ABAP", function () {
  this.timeout(120000);
  let root, store, fronts;
  const provider = `CLASS zcl_check DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS get RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_check IMPLEMENTATION.
 METHOD get.
 rv = 1.
 ENDMETHOD.
ENDCLASS.\n`;
  const caller = provider.replaceAll("zcl_check", "zcl_check_caller").replace("rv = 1.", "rv = zcl_check=>get( ).");
  const broken = provider.replaceAll("get", "renamed");
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-c1-warm-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/zcl_check.clas.abap"), provider);
    writeFileSync(join(root, "src/zcl_check_caller.clas.abap"), caller);
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702"}}));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", input_filter: [], output_folder: "output", libs: [], write_unit_tests: true, write_source_map: true,
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"}}));
    symlinkSync(join(resolve("."), "node_modules"), join(root, "node_modules"));
    store = new ObjectStore({root, libs: [], roots: [{path: "src", writable: true}], build: {generators: false}});
    expect((await store.publish()).ok).to.equal(true);
    store.warmState = {on: true};
    expect(await store.warmUp()).to.not.equal(undefined, store.warmState.reason);
    fronts = await sliceFronts(store);
  });
  after(async () => {
    await fronts?.close();
    if (store) await closeWarm(store);
    if (root) rmSync(root, {recursive: true, force: true});
  });
  const post = source => fronts.diff(base + "checkruns", "POST", block(uri, Buffer.from(source).toString("base64")), {"content-type": "application/xml"});
  it("returns dependent errors with ADT severity and the dependent URI; no publication", async () => {
    const hash = liveHash(root);
    const response = await post(broken);
    const xml = response.body.toString();
    expect(xml).to.include('chkrun:type="E"').and.not.include('chkrun:type="Error"');
    expect(xml).to.include('chkrun:uri="/sap/bc/adt/oo/classes/zcl_check_caller/source/main#start=');
    expect(liveHash(root)).to.equal(hash);
    expect(readFileSync(join(root, "src/zcl_check.clas.abap"), "utf8")).to.equal(provider);
    expect((await post(provider)).body.toString()).to.include('chkrun:statusText="no errors"');
  });
  it("uses saved dependencies consistently when two edited objects are inactive", async () => {
    store.write("CLAS", "ZCL_CHECK", broken);
    store.write("CLAS", "ZCL_CHECK_CALLER", caller.replace("zcl_check=>get", "zcl_check=>renamed"));
    expect(await warmCheck(store, {type: "CLAS", name: "ZCL_CHECK"})).to.equal(undefined);
    const response = await post(broken);
    expect(response.body.toString()).to.include('chkrun:statusText="no errors"');
    expect(store.stateOf(store.find("CLAS", "ZCL_CHECK_CALLER")).version).to.equal("inactive");
  });
  it("keeps checking an editor overlay for an object not created yet", async () => {
    const source = provider.replaceAll("zcl_check", "zcl_new");
    const response = await fronts.diff(base + "checkruns", "POST", block(base + "oo/classes/zcl_new", Buffer.from(source).toString("base64")), {"content-type": "application/xml"});
    expect(response.body.toString()).to.include('chkrun:statusText="no errors"');
    expect(store.find("CLAS", "ZCL_NEW")).to.equal(undefined);
  });
});
