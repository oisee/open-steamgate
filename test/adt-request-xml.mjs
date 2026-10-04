import {requestXMLBodyError, XML_BODY_LIMIT} from "../tools/adt-request-xml.mjs";
import {expect} from "chai";
import express from "express";
import {createServer} from "node:net";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {liveHash} from "../tools/osd-build.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {locks} from "../tools/osd-enq.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";

const base = "/sap/bc/adt/";
const core = "http://www.sap.com/adt/core";
const uri = base + "programs/programs/zxml";
const refs = `<adtcore:objectReferences xmlns:adtcore="${core}"><adtcore:objectReference adtcore:uri="${uri}" adtcore:name="ZXML"/></adtcore:objectReferences>`;
const envelopes = [
  ["activation?method=activate", refs, 200],
  ["checkruns", `<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="${core}"><chkrun:checkObject adtcore:uri="${uri}"><chkrun:content>REPORT zxml.</chkrun:content></chkrun:checkObject></chkrun:checkObjectList>`, 200],
  ["programs/programs", `<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="${core}" adtcore:name="ZXML" adtcore:description="XML"><adtcore:packageRef adtcore:name="$TMP"/></program:abapProgram>`, 409],
  ["oo/classes", `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="${core}" adtcore:name="ZCL_XML"/>`, 409],
  ["oo/interfaces", `<intf:abapInterface xmlns:intf="http://www.sap.com/adt/oo/interfaces" xmlns:adtcore="${core}" adtcore:name="ZIF_XML"/>`, 409],
  ["programs/includes", `<include:abapInclude xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:adtcore="${core}" adtcore:name="ZINCL_XML"/>`, 409],
  ["ddic/ddl/sources", `<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources" xmlns:adtcore="${core}" adtcore:name="ZDDL_XML"/>`, 409],
  ["ddic/srvd/sources", `<srvd:serviceDefinition xmlns:srvd="http://www.sap.com/adt/ddic/srvd" xmlns:adtcore="${core}" adtcore:name="ZSRV_XML"/>`, 501],
  ["programs/programs/zxml?_action=LOCK", refs, 400],
  ["programs/programs/zxml?_action=UNLOCK", refs, 200],
  ["packages", `<pack:package xmlns:pack="http://www.sap.com/adt/packages" xmlns:adtcore="${core}" adtcore:name="$TMP"><pack:superPackage adtcore:name="$TMP"/></pack:package>`, 409],
  ["oo/classes/zcl_xml/includes", `<class:abapClassInclude xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="${core}" adtcore:name="ZCL_XML" class:includeType="testclasses"/>`, 409],
  ["cts/transportchecks", `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><URI>${uri}</URI><DEVCLASS>$TMP</DEVCLASS><OPERATION>I</OPERATION></DATA></asx:values></asx:abap>`, 200],
  ["repository/nodestructure?parent_type=DEVC/K&parent_name=%24TMP", `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><TV_NODEKEY>000002</TV_NODEKEY></DATA></asx:values></asx:abap>`, 200],
  ["repository/informationsystem/virtualfolders/contents", `<vfs:virtualFoldersRequest xmlns:vfs="http://www.sap.com/adt/ris/virtualFolders" objectSearchPattern="Z*"><vfs:preselection facet="package"><vfs:value>$TMP</vfs:value></vfs:preselection><vfs:facetorder><vfs:facet>type</vfs:facet></vfs:facetorder></vfs:virtualFoldersRequest>`, 200],
  ["abapunit/testruns", `<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">${refs.replaceAll("programs/programs/zxml", "oo/classes/zcl_xml")}</aunit:runConfiguration>`, 200],
  ["abapunit/testruns/evaluation", `<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">${refs.replaceAll("programs/programs/zxml", "oo/classes/zcl_xml")}</aunit:runConfiguration>`, 200],
];
const variants = {
  prefix: xml => {
    const prefixes = [...xml.matchAll(/xmlns:([\w]+)=/g)].map(m => m[1]);
    for(const [i,prefix] of prefixes.entries()) xml = xml.replaceAll(`${prefix}:`, `r${i}:`).replaceAll(`xmlns:${prefix}`, `xmlns:r${i}`);
    return xml;
  },
  default: xml => {
    const prefix = /<([\w]+):/.exec(xml)?.[1];
    // Default namespaces apply to elements only. Keep qualified attributes.
    const ns = new RegExp(`xmlns:${prefix}="([^"]+)"`).exec(xml)?.[1];
    if(prefix === "asx") xml = xml.replace("<DATA>", '<DATA xmlns="">');
    return xml.replace(new RegExp(`xmlns:${prefix}="[^"]+"`), `xmlns="${ns}" xmlns:${prefix}="${ns}"`).replaceAll(new RegExp(`(<\\/?|<)${prefix}:`, "g"), "$1");
  },
  quotes: xml => xml.replaceAll('"', "'"),
  order: xml => xml.replace(/<([^!?/][^<>]*?)>/g, (tag, inner) => {
    const name = /^\S+/.exec(inner)[0];
    const attrs = [...inner.slice(name.length).matchAll(/[^\s=]+="[^"]*"/g)].map(m => m[0]).reverse();
    return `<${name}${attrs.length ? " " + attrs.join(" ") : ""}${inner.endsWith("/") && !name.endsWith("/") ? "/" : ""}>`;
  }),
  whitespace: xml => xml.replaceAll("><", ">\n\t<").replaceAll("=", " = "),
  xmlSpaceText: xml => xml.replace(/<([\w:]+)>([^<]+)<\//g,'<$1 xml:space="preserve" xml:lang="en">$2</'),
  cdata: xml => xml.replace(/>([^<]+)</g,(_,t) => `><![CDATA[${t}]]><`),

};

const wireAnswers = new Map();
for (const front of ["node", "abap"]) describe(`T12/T13 XML requests ${front} mode=${process.env.OSD_ADT_ONE_RUNTIME ?? "0"}`, function () {
  this.timeout(180000);
  let root, store, server, origin, auth, facade, runtime;
  const workCalls = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "adt-xml-")); mkdirSync(join(root, "src"));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder:["src"], libs:[]}));
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({global:{files:"/src/**/*.*"},syntax:{version:"v702"},rules:{}}));
    writeFileSync(join(root, "src/package.devc.xml"), "<abapGit><DEVC><DEVCLASS>$TMP</DEVCLASS></DEVC></abapGit>");
    writeFileSync(join(root, "src/zxml.prog.abap"), "REPORT zxml.\nWRITE 'active'.\n");
    writeFileSync(join(root, "src/zcl_xml.clas.abap"), "CLASS zcl_xml DEFINITION PUBLIC. ENDCLASS. CLASS zcl_xml IMPLEMENTATION. ENDCLASS.");
    writeFileSync(join(root, "src/zcl_xml.clas.testclasses.abap"), "CLASS ltcl_xml DEFINITION FOR TESTING. PRIVATE SECTION. METHODS test FOR TESTING. ENDCLASS. CLASS ltcl_xml IMPLEMENTATION. METHOD test. ENDMETHOD. ENDCLASS.");
    store = new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    writeFileSync(join(root,"src/zif_xml.intf.abap"),"INTERFACE zif_xml PUBLIC. ENDINTERFACE.");
    writeFileSync(join(root,"src/zincl_xml.prog.abap"),"FORM demo. ENDFORM.");
    writeFileSync(join(root,"src/zincl_xml.prog.xml"),"<abapGit><PROGDIR><SUBC>I</SUBC></PROGDIR></abapGit>");
    writeFileSync(join(root,"src/zddl_xml.ddls.asddls"),"define view entity ZDDL_XML as select from ztable { key id }");
    writeFileSync(join(root,"src/zsrv_xml.srvd.srvdsrv"),"define service ZSRV_XML { expose ZDDL_XML; }");
    store = new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    for(const method of ["activate","check","publish","create","write","read","unit","find"]) {
      const original = store[method];
      store[method] = function (...args) {workCalls.push(method);return original.apply(this,args);};
    }
    store.unit = async () => {workCalls.push("unit");return {classes:() => [],runDetached:async () => ({classes:[]})};};
    let runner;
    if (front === "abap") {
      if (process.env.OSD_ADT_ONE_RUNTIME === "1") {
        runtime = new ServingRuntime({root:process.cwd(),env:{OSD_ADT_ONE_RUNTIME:"1",STG_DB:"sqlite",STG_DB_PATH:"",STG_TLS:"0",NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${new URL("./helpers/adt-xml-child.mjs",import.meta.url).pathname}`].filter(Boolean).join(" ")}});
        runtime.storeDestination = new StoreDestination({store}); await runtime.start(); runner = abapRunner({remote:runtime});
      } else runner = abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep});
    }
    const app = express(); app.set("etag",false); app.use(express.raw({type:"*/*",limit:XML_BODY_LIMIT}));
    app.use(requestXMLBodyError);
    facade = adtRouter({store,watch:false,logMisses:false,transpileOnActivate:false,...(runner ? {abap:runner} : {})});
    app.use(facade.router);
    server = await new Promise(resolve => {const s = app.listen(0,"127.0.0.1",() => resolve(s));}); origin = `http://127.0.0.1:${server.address().port}`;
    const hello = await fetch(origin+base+"core/discovery",{method:"HEAD",headers:{"x-csrf-token":"fetch"}});
    auth = {"content-type":"application/xml",cookie:hello.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),"x-csrf-token":hello.headers.get("x-csrf-token")};
    const locked = await fetch(origin+base+"core/discovery",{method:"HEAD",headers:{"x-csrf-token":"fetch","x-sap-adt-sessiontype":"stateful"}});
    const lockAuth = {cookie:locked.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),"x-csrf-token":locked.headers.get("x-csrf-token"),"x-sap-adt-sessiontype":"stateful"};
    const lock = await fetch(origin+base+"oo/interfaces/zif_xml?_action=LOCK",{method:"POST",headers:lockAuth});
    expect(lock.status,await lock.text()).to.equal(200);
    // An inactive save preserves an active copy: rejection must keep both.
    store.write("PROG","ZXML","REPORT zxml.\nWRITE 'saved'.\n");
  });
  after(async () => {if(server) await new Promise(r => server.close(r)); if(runtime) await runtime.stop(); if(root) rmSync(root,{recursive:true,force:true});});
  const post = async (path,body) => {
    const r = await fetch(origin+base+path,{method:"POST",headers:auth,body});
    return {status:r.status,type:r.headers.get("content-type"),body:await r.text()};
  };
  let sequence = 0;
  const localState = () => dialogStep(async () => {
    const xref = {}, db = abap.context.databaseConnections.DEFAULT;
    for (const table of ["cross","wbcrossgt","wbcrossgtx","d010inc","zosd_adt_sess","zosd_adt_shdl"])
      xref[table] = (await db.select({select:`SELECT * FROM ${table}`})).rows;
    return {enq:locks().read(),contexts:[...locks().sessions],sequence:locks().seq,xref};
  },"XML acceptance snapshot");
  const enqueueSnapshot = () => runtime === undefined ? localState() : new Promise((resolve,reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => finish(new Error("XML state snapshot timeout")),15000);
    const receive = message => {if(message?.type === "adt-xml-state-answer" && message.id === id) finish(message.error ? new Error(message.error) : undefined,message.state);};
    const finish = (error,state) => {clearTimeout(timer);runtime.child.off("message",receive);if(error) reject(error);else resolve(state);};
    runtime.child.on("message",receive);runtime.child.send({type:"adt-xml-state",id});
  });
  const digest = async () => {
    const files = [];
    const walk = dir => {for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir,entry.name); if(entry.isDirectory()) walk(path); else files.push([path.slice(root.length),readFileSync(path).toString("hex")]);
    }};
    walk(root);
    const holders = [];
    for(const [type,name] of [["PROG","ZXML"],["CLAS","ZCL_XML"],["DEVC","$TMP"]]) {
      const h = await facade.sessions.holderOf(type,name);
      holders.push(h ? [type,name,h.session.id,h.handle,[...h.session.locks]] : [type,name]);
    }
    return createHash("sha256").update(JSON.stringify({files,active:store.inactiveSources(),holders,sessions:[...(facade.sessions.byId ?? new Map())].map(([id,s]) => [id,{...s,locks:[...s.locks]}]),enq:await enqueueSnapshot(),generation:liveHash(store.root),epoch:runtime?.epoch,liveGeneration:liveHash(process.cwd())})).digest("hex");
  };
  for(const [path,xml,status] of envelopes) for(const [kind,transform] of Object.entries(variants)) it(`T12 ${path} ${kind}`,async () => {
    const baseline = await post(path,xml); expect(baseline.status,baseline.body).to.equal(status);
    const key = `baseline ${path}`;
    if(front === "node") wireAnswers.set(key,baseline);else expect(baseline).to.deep.equal(wireAnswers.get(key));
    expect(await post(path,transform(xml))).to.deep.equal(baseline);
  });
  for(const [path,xml] of envelopes.filter(([path]) => ["programs/programs","oo/classes","oo/interfaces","programs/includes","ddic/ddl/sources","packages"].includes(path))) it(`T12 ${path} successful create variants`,async () => {
    const types = {"programs/programs":"PROG","oo/classes":"CLAS","oo/interfaces":"INTF","programs/includes":"INCL","ddic/ddl/sources":"DDLS","ddic/srvd/sources":"SRVD",packages:"DEVC"};
    const name = path === "packages" ? "$XML_NEW" : "ZXML_NEW";
    let body = xml.replace(/adtcore:name="[^"]*"/, `adtcore:name="${name}"`);
    if(path !== "packages" && !body.includes("adtcore:packageRef")) body = body.slice(0,-2)+`><adtcore:packageRef adtcore:name="$TMP"/></${/^<([^\s/>]+)/.exec(body)[1]}>`;
    let baseline;
    for(const transform of [x => x,...Object.values(variants)]) {
      const r = await post(path,transform(body));expect(r.status,r.body).to.equal(201);
      if(baseline) expect(r).to.deep.equal(baseline);else baseline = r;
      store.delete(types[path],name);
    }
  });
  it("F1 admission retains source and fields on a host without a raw body parser",async () => {
    const app=express(); app.set("etag",false); app.use(facade.router);
    const bare=await new Promise(resolve => {const s=app.listen(0,"127.0.0.1",() => resolve(s));});
    try {
      const bareOrigin=`http://127.0.0.1:${bare.address().port}`;
      for (const [path,xml] of envelopes) {
        const baseline=await post(path,xml);
        const r=await fetch(bareOrigin+base+path,{method:"POST",headers:auth,body:xml});
        expect({status:r.status,type:r.headers.get("content-type"),body:await r.text()},path).to.deep.equal(baseline);
      }
      const xml=envelopes.find(([p]) => p === "checkruns")[1].replace("REPORT zxml.","REPORT zxml.\nTHIS IS INVALID ABAP.");
      const r=await fetch(bareOrigin+base+"checkruns",{method:"POST",headers:auth,body:xml});
      expect(await r.text()).to.include("THIS");
    } finally {await new Promise(r => bare.close(r));}
  });
  it("F1 xml:space checks invalid inline source instead of valid saved source",async () => {
    store.write("PROG","ZXML","REPORT zxml.\nWRITE 'saved and valid'.\n");
    const xml = envelopes.find(([p]) => p === "checkruns")[1].replace("REPORT zxml.","REPORT zxml.\nTHIS IS INVALID ABAP.");
    const baseline = await post("checkruns",xml);
    expect(baseline.status,baseline.body).to.equal(200);
    expect(baseline.body).to.include("THIS");
    const decorated = xml.replace("<chkrun:content>",'<chkrun:content xml:space="preserve" xml:lang="en">');
    expect(await post("checkruns",decorated)).to.deep.equal(baseline);
  });
  it("F1 nested artifact content retains xml:space and submitted source",async () => {
    const xml=envelopes.find(([p]) => p === "checkruns")[1].replace("REPORT zxml.","REPORT zxml.\nTHIS IS INVALID ABAP.");
    const baseline=await post("checkruns",xml);
    expect(baseline.body).to.include("THIS");
    const nested=xml.replace("<chkrun:content>",'<chkrun:artifacts><chkrun:artifact><chkrun:content xml:space="preserve">')
      .replace("</chkrun:content>","</chkrun:content></chkrun:artifact></chkrun:artifacts>");
    expect(await post("checkruns",nested)).to.deep.equal(baseline);
  });
  it("F4 Unit object URI and selector ignore foreign attributes in either order",async () => {
    const xml=envelopes.find(([p]) => p === "abapunit/testruns")[1];
    const baseline=await post("abapunit/testruns",xml);
    expect(baseline.status,baseline.body).to.equal(200);
    const prefix='xmlns:evil="urn:foreign" evil:uri="/ignored#testclass=LTCL_OTHER" ';
    const before=xml.replace('adtcore:uri="',prefix+'adtcore:uri="');
    const after=xml.replace('adtcore:uri="','xmlns:evil="urn:foreign" adtcore:uri="').replace(' adtcore:name="',' evil:uri="/ignored#testclass=LTCL_OTHER" adtcore:name="');
    for (const variant of [before,after]) expect(await post("abapunit/testruns",variant)).to.deep.equal(baseline);
  });
  it("F4 Unit ignores core URI attributes on elements other than objectReference",async () => {
    const xml=envelopes.find(([p]) => p === "abapunit/testruns")[1];
    const baseline=await post("abapunit/testruns",xml);
    const variant=xml.replace('<aunit:runConfiguration ','<aunit:runConfiguration xmlns:c="http://www.sap.com/adt/core" c:uri="/sap/bc/adt/oo/classes/zcl_other" ');
    expect(await post("abapunit/testruns",variant)).to.deep.equal(baseline);
  });
  it("F6 DOCTYPE in comments and CDATA is ordinary source text",async () => {
    const xml=envelopes.find(([p]) => p === "checkruns")[1].replace("REPORT zxml.","REPORT zxml. WRITE '&lt;!DOCTYPE html&gt;'.");
    const baseline=await post("checkruns",xml);
    expect(baseline.status,baseline.body).to.equal(200);
    const cdata=xml.replace("REPORT zxml. WRITE '&lt;!DOCTYPE html&gt;'.","<![CDATA[REPORT zxml. WRITE '<!DOCTYPE html>'.]]>");
    for (const variant of [cdata,'<!-- <!DOCTYPE ignored> -->'+xml]) expect(await post("checkruns",variant)).to.deep.equal(baseline);
  });
  for (const fresh of [false,true]) for (const uppercase of [false,true]) it(`F3 refused XML preserves ${fresh ? "fresh" : "existing stateless"} session metadata ${uppercase ? "uppercase" : "lowercase"} path`,async () => {
    const before=await digest(); workCalls.length=0;
    const headers={...(fresh ? {"content-type":"application/xml"} : auth),"x-sap-adt-sessiontype":"stateful"};
    const response=await fetch(origin+(uppercase ? base.toUpperCase() : base)+"activation?method=activate",{method:"POST",headers,body:refs+"tail"});
    const text=await response.text();
    expect(response.status,text).to.equal(400);
    expect(response.headers.getSetCookie()).to.deep.equal([]);
    expect(response.headers.get("x-csrf-token")).to.equal(null);
    expect(workCalls).to.deep.equal([]);
    expect(await digest()).to.equal(before);
  });
  const invalid = {
    F2duplicateNamespace: xml => xml.replace(/xmlns:([^=]+)="([^"]*)"/, '$& xmlns:$1="$2"'),
    F2reservedXML: xml => xml.replace(/^<([^ >]+)/,'<$1 xmlns:xml="urn:wrong"'),
    F2emptyPrefix: xml => xml.replace(/^<([^ >]+)/,'<$1 xmlns:q=""'),
    F2xmlnsURI: xml => xml.replace(/^<([^ >]+)/,'<$1 xmlns:q="http://www.w3.org/2000/xmlns/"'),
    F2control: xml => xml.replace(/^<([^ >]+)/,'<$1 extra="\u0001"'),
    F2nullReference: xml => xml.replace(/^<([^ >]+)/,'<$1 extra="&#0;"'),
    F2declaration: xml => '<?xml junk?>'+xml,
    F2attributeName: xml => xml.replace(/^<([^ >]+)/,'<$1 xmlns:q="u" q:a:b="x"'),
    F7namespaceName: xml => xml.replace(/^<([^ >]+)/,'<$1 xmlns:a:b="u"'),
    F7NBSP: xml => '\u00a0'+xml,
    F7PI: xml => '<? ?>'+xml,
    undeclared: xml => xml.replace(/ xmlns:adtcore="[^"]*"/, "").replace(/ xmlns:\w+="[^"]*"/, ""),
    foreign: xml => xml.replace(/http:\/\/www.sap.com\/[^" ]+/, "urn:foreign"),
    trailing: xml => xml+"tail",
    nesting: xml => xml.endsWith("/>") ? xml.slice(0,-2)+"></broken>" : xml.replace(/<\/[^>]+>$/, "</broken>"),
    doctype: xml => `<!DOCTYPE root [<!ENTITY local "value">]>${xml}`,
    depth: xml => {
      const open = /^<([^>]+)>/.exec(xml)[0];
      if(open.endsWith("/>")) return open.slice(0,-2)+">"+"<nest>".repeat(65)+"</nest>".repeat(65)+`</${/^<([^\s/>]+)/.exec(open)[1]}>`;
      return xml.replace(open,open+"<nest>".repeat(65)).replace(/(<\/[^>]+>)$/, "</nest>".repeat(65)+"$1");
    },
    oversized: xml => xml + " ".repeat(16*1024*1024),
  };
  for(const [path,xml] of envelopes) for(const [kind,transform] of Object.entries(invalid)) it(`T13 ${path} ${kind} unchanged digest`,async () => {
    store.write("PROG","ZXML","REPORT zxml.\nWRITE 'rejected save'.\n");
    const before = await digest(); workCalls.length = 0; const r = await post(path,transform(xml));
    expect(workCalls).to.deep.equal([]);
    expect(await digest()).to.equal(before); expect(r.status,r.body.slice(0,500)).to.equal(400);
    const key = `invalid ${path} ${kind}`;
    if(front === "node") wireAnswers.set(key,r);else expect(r).to.deep.equal(wireAnswers.get(key));
    expect(r.type).to.equal("application/xml; charset=utf-8");
    expect(r.body).to.include('exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"');
  });
  it("T13 external entity makes zero loopback connections",async () => {
    let connections = 0;
    const listener = createServer(socket => {connections++;socket.end();});
    await new Promise(r => listener.listen(0,"127.0.0.1",r));
    try {
      const xml = `<!DOCTYPE root [<!ENTITY ext SYSTEM "http://127.0.0.1:${listener.address().port}/secret">]>${refs.replace("ZXML", "&ext;")}`;
      const before = await digest(); workCalls.length = 0; const r = await post("activation?method=activate",xml);
      expect(workCalls).to.deep.equal([]);
      expect(await digest()).to.equal(before);expect(r.status).to.equal(400);expect(connections).to.equal(0);
    } finally {await new Promise(r => listener.close(r));}
  });
});
