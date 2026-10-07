// B2a compares the live Node routes and ABAP rows over one bound store.
import {expect} from "chai";
import express from "express";
import {request} from "node:http";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {classIncludeTemplates} from "../tools/adt-documents.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination, withSystem, currentSystemAnswers, COMMANDS} from "../tools/osd-store-destination.mjs";
import {harnessEntries, runAll} from "../tools/osd-unit-all.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {activeFixture} from "./helpers/source-snapshot.mjs";
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";

const runtimeFixture = runtimeRootFixture();

const base = "/sap/bc/adt/";
const collections = ["oo/classes", "oo/interfaces", "programs/programs", "ddic/ddl/sources", "ddic/srvd/sources", "programs/includes"];
const names = ["zcl_read", "zif_read", "zread", "zddl_read", "zsrv_read", "zinc_read"];
const source = '\uFEFF* Привет 😀\u0000\r\nREPORT zread.\r\n* no final newline';
const reportBoundaries = [
  ["CR", "zreport_cr", "* c\rREPORT z."],
  ["U+2028", "zreport_ls", "* c\u2028REPORT z."],
  ["U+2029", "zreport_ps", "* c\u2029REPORT z."],
  ["leading Unicode spaces", "zreport_spaces", "\u00a0\uFEFF\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u3000REPORT z."],
];
const stripQuery = (s) => s.replace(/\?$/, "");
const xmlAccept = "application/vnd.sap.adt.oo.classes.includes.v2+xml";

// Runtime-only mutants never alter a tracked file. They are restored in after().
function mutants(store) {
  const undo = [], red = process.env.OSD_ADT_B2A_RED;
  const wrap = (cls, method, change) => {
    const original = cls[method];
    cls[method] = async function (args) {return change(await original.call(this,args),args);};
    undo.push(() => {cls[method] = original;});
  };
  const entity = abap.Classes.ZCL_OSD_ADT_ENTITY;
  if (red === "charset200" || red === "charset304") wrap(entity,"send",(r) => {
    const v = r.get();
    if (v.status.get() === (red === "charset200" ? 200 : 304)) v.content_type.set(red === "charset200"
      ? v.content_type.get().replace("; charset=utf-8", "") : v.content_type.get()+"; charset=utf-8");
    return r;
  });
  if (red === "etag") wrap(entity,"tag",r => r.set('"'+r.get()+'"'));
  if (red === "miss-name") {
    const cls = abap.Classes.ZCL_OSD_ADT_SOURCE, original = cls.read;
    cls.read = async function (args) {try {return await original.call(this,args);} catch(e) {
      if (e.message_text) e.message_text.set(e.message_text.get().replace("zCl_NoPe", "ZCL_NOPE")); throw e;
    }};
    undo.push(() => {cls.read = original;});
  }
  if (red === "include-case") {
    const cls = abap.Classes.ZCL_OSD_ADT_HOST, original = cls.read;
    cls.read = async function (args) {
      if (red === "include-case") args.iv_include.set(args.iv_include.get().toLowerCase());
      return original.call(this,args);
    };
    undo.push(() => {cls.read = original;});
  }
  if (red === "unbound") {
    const original=StoreDestination.prototype.execute, unbound=new ObjectStore({root:process.cwd()});
    StoreDestination.prototype.execute=async function(parameters) {
      const command=parameters.iv_command ?? parameters.IV_COMMAND;
      if ((command?.get?.() ?? command) === "READ") return withSystem(currentSystemAnswers(),() => original.call(this,parameters),{store:unbound});
      return original.call(this,parameters);
    };
    undo.push(() => {StoreDestination.prototype.execute=original;});
  }
  if (red === "include-empty") wrap(abap.Classes.ZCL_OSD_ADT_HOST,"object",(r) => {
    r.get().includes.set(r.get().includes.array().filter(i => store.read("CLAS",r.get().name.get(),i.get()).source.length)); return r;
  });
  if (red === "property-state") wrap(abap.Classes.ZCL_OSD_ADT_OBJECT,"properties",r => r.set(r.get().replaceAll('version="active"','version="inactive"')));
  if (red === "report-space") wrap(abap.Classes.ZCL_OSD_ADT_OBJECT,"report_source",(r,args) => {
    if (/^[\uFEFF\u00a0]/.test(args.iv_source.get())) r.set(""); return r;
  });
  if (red === "report-lf-only") wrap(abap.Classes.ZCL_OSD_ADT_OBJECT,"report_source",(r,args) => {
    r.set(args.iv_source.get().split("\n").some(line => /^report\b/i.test(line.trim())) ? "X" : ""); return r;
  });
  if (red === "host") wrap(abap.Classes.ZCL_OSD_ADT_ROUTER,"routes",r => {
    for (const row of r.array()) if (["ZCL_OSD_ADT_SOURCE","ZCL_OSD_ADT_OBJECT"].includes(row.get().handler.get())) row.get().served_by.set("HOST"); return r;
  });
  return () => undo.reverse().forEach(fn => fn());
}

describe("ADT B2a source reads and bare documents: live Node byte diff", function () {
  this.timeout(120000);
  let root, store, node, ported, other, runtime, restore;
  const served = [], servers = [];
  async function mount(boundStore, isAbap) {
    const app = express(); app.set("etag",false); app.use(express.raw({type:"*/*"}));
    const facade = adtRouter({store:boundStore,data:{},watch:false,logMisses:false,
      ...(isAbap ? {abap:runtime ? abapRunner({remote:runtime}) : abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
        abapServed:(by,req) => served.push(`${by} ${req.method} ${stripQuery(req.originalUrl)}`)} : {})});
    app.use(facade.router);
    const server = await new Promise(done => {const s=app.listen(0,"127.0.0.1",() => done(s));}); servers.push(server);
    const side={server,facade,base:`http://127.0.0.1:${server.address().port}`};
    const warm = await fetch(side.base+base+"b2a/warm",{headers:{"x-csrf-token":"fetch"}});
    await warm.arrayBuffer();
    side.auth={cookie:warm.headers.getSetCookie().map(c => c.split(";")[0]).join("; "),"x-csrf-token":warm.headers.get("x-csrf-token")};
    return side;
  }
  // node:http also exercises a truly absent Accept header.
  async function wire(side,path,method="GET",headers={},body) {
    return new Promise((resolve,reject) => {
      const req=request(side.base+path,{method,headers:{...side.auth,...headers}},res => {
        const chunks=[]; res.on("data",d => chunks.push(d)); res.on("end",() => resolve({status:res.statusCode,
          headers:Object.fromEntries(["content-type","content-length","etag"].map(h => [h,res.headers[h] ?? null])),body:Buffer.concat(chunks)}));
      }); req.on("error",reject); req.end(body);
    });
  }
  async function diff(path,method="GET",headers={}) {
    const expected=await wire(node,path,method,headers); served.length=0;
    const actual=await wire(ported,path,method,headers);
    expect(actual.body.toString(),`${method} ${path} body`).to.equal(expected.body.toString());
    expect(actual,`${method} ${path}`).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${stripQuery(path)}`]); return expected;
  }
  before(async () => {
    root=mkdtempSync(join(tmpdir(),"osd-b2a-")); mkdirSync(join(root,"src"));
    const file=(name,suffix,text) => writeFileSync(join(root,"src",name.toLowerCase().replaceAll("/","#")+suffix),text);
    for (const [name,suffix] of [[names[0],".clas.abap"],[names[1],".intf.abap"],[names[2],".prog.abap"],[names[3],".ddls.asddls"],[names[4],".srvd.srvdsrv"],[names[5],".prog.abap"]]) file(name,suffix,source);
    file(names[5],".prog.xml","<abapGit><PROGDIR><SUBC>I</SUBC></PROGDIR></abapGit>");
    file(names[0],".clas.locals_def.abap","* definitions\r\n"); file(names[0],".clas.testclasses.abap","");
    file("/DEMO/ZREAD",".clas.abap",source); file("zcl_plain",".clas.abap",source);
    for(const [name,text] of [["zreport","REPORT z."],["zbom","\uFEFFreport z."],["znbsp","\u00a0report z."],["zreports","reports z."],["zcomment","* report z."],["zline","* comment\r\n\tRePoRt-z."]]) file(name,".prog.abap",text);
    for(const [,name,text] of reportBoundaries) file(name,".prog.abap",text);
    for(const [name,text] of [["zentity","define\r\nroot\tview\nentity zentity as select from t {}"],["zclassic","define view zclassic as select from t {}"],["zboundary","redefine view entity2"],["zpunct","define,view entity"]]) file(name,".ddls.asddls",text);
    file("ztf_source",".ddls.asddls","define table function ZTF_ENTITY returns { id: abap.int4; } implemented by method zcl_read=>run;");
    activeFixture(root);
    store=new ObjectStore({root,libs:[],roots:[{path:"src",package:"$TMP",writable:true}]});
    store.create("CLAS","ZCL_AUTHOR",{package:"$TMP",author:"BUILDER_A"});
    store.write("PROG","ZREPORT","REPORT z.");
    restore=mutants(store);
    // Mutants run inline so they change the real methods the route calls.
    if(process.env.OSD_ADT_ONE_RUNTIME === "1" && !process.env.OSD_ADT_B2A_RED) {
      runtime=new ServingRuntime({root:runtimeFixture.root,watch:false,stdio:"pipe",env:{OSD_ADT_ONE_RUNTIME:"1",STG_DB:"sqlite",STG_DB_PATH:"",STG_TLS:"0"}});
      runtime.storeDestination=new StoreDestination({store});
      await runtime.start();
    }
    node=await mount(store,false); ported=await mount(store,true);
    const second=join(root,"second"); mkdirSync(join(second,"src"),{recursive:true});
    writeFileSync(join(second,"src/zcl_read.clas.abap"),"* SECOND STORE");
    other=await mount(new ObjectStore({root:second,libs:[]}),true);
  });
  after(async () => {restore?.(); for(const s of servers) await new Promise(r => s.close(r)); await runtime?.stop(); if(root) rmSync(root,{recursive:true,force:true});});

  for(const [i,coll] of collections.entries()) for(const suffix of ["/source/main","/includes/definitions","/includes/definitions/source/main"]) {
    it(`row ${coll}${suffix} GET/HEAD, upper-case collection and trailing slash`,async () => {
      const status=suffix.startsWith("/includes") && i!==0 ? 404 : 200;
      for(const method of ["GET","HEAD"]) for(const path of [base+coll+"/"+names[i]+suffix,base+coll.toUpperCase()+"/"+names[i]+suffix+"/?"]) {
        const r=await diff(path,method); expect(r.status).to.equal(status);
        if(method === "GET" && suffix === "/source/main") {expect(r.body).to.deep.equal(Buffer.from(source)); expect(r.headers.etag).to.match(/^[0-9a-f]{32}$/);}
      }
    });
  }
  for(const i of [0,1,2,3]) it(`bare row ${collections[i]} GET/HEAD and URL variants`,async () => {
    for(const method of ["GET","HEAD"]) for(const path of [base+collections[i]+"/"+names[i],base+collections[i].toUpperCase()+"/"+names[i]+"/?"]) expect((await diff(path,method)).status).to.equal(200);
  });
  for(const suffix of ["/source/main","","/includes/definitions"]) for(const variant of ["exact","quoted","weak","list","miss","star"]) it(`conditional ${suffix || "class"} ${variant}`,async () => {
    const path=base+collections[0]+"/"+names[0]+suffix, headers=suffix.startsWith("/includes") ? {accept:xmlAccept} : {};
    const tag=(await wire(node,path,"GET",headers)).headers.etag;
    const none={exact:tag,quoted:`"${tag}"`,weak:`W/"${tag}"`,list:`other, "${tag}"`,miss:"other",star:"*"}[variant];
    const r=await diff(path,"GET",{...headers,"if-none-match":none});
    // node:http sends no Cache-Control. Express freshness therefore handles '*'.
    expect(r.status).to.equal(variant === "miss" ? 200 : 304);
    if(r.status === 304) expect(r.headers["content-type"]).to.equal(variant === "star" ? null : suffix === "/source/main" ? "text/plain; charset=utf-8" : suffix ? xmlAccept : "application/vnd.sap.adt.oo.classes.v4+xml");
  });
  for(const i of [0,1,2,3,4,5]) it(`missing ${collections[i]} preserves request case and miss record`,async () => {
    const path=base+collections[i]+"/zCl_NoPe/source/main";
    const r=await diff(path); expect(r.status).to.equal(404); expect(r.body.toString()).to.include("zCl_NoPe does not exist");
    const actualMiss=ported.facade.missed.get(`object GET ${path}`), expectedMiss=node.facade.missed.get(`object GET ${path}`);
    expect(actualMiss?.detail).to.equal(expectedMiss.detail); expect(actualMiss?.kind).to.equal("object");
  });
  for(const suffix of ["/source/main",""]) it(`DDLS table-function entity fallback ${suffix}`,async () => {
    const r=await diff(base+collections[3]+"/ztf_entity"+suffix); expect(r.status).to.equal(200); if(!suffix) expect(r.body.toString()).to.include('adtcore:name="ZTF_SOURCE"');
  });
  for(const include of ["macros","Definitions","constructor"]) for(const suffix of ["","/source/main"]) it(`class include ${include}${suffix}`,async () => {
    const r=await diff(base+collections[0]+"/"+names[0]+"/includes/"+include+suffix); expect(r.status).to.equal(include === "macros" ? 200 : 404);
    if(include === "macros") {expect(r.body.toString()).to.equal(classIncludeTemplates.macros); expect(r.headers.etag).to.equal(createHash("sha256").update(classIncludeTemplates.macros).digest("hex").slice(0, 32));}
  });
  it("generated and empty includes GET/HEAD keep Content-Length and wildcard freshness",async () => {
    for(const include of ["macros","testclasses"]) for(const method of ["GET","HEAD"]) {
      const path=base+collections[0]+"/"+names[0]+"/includes/"+include;
      const first=await diff(path,method); expect(first.headers["content-length"]).to.equal(String(include === "macros" ? Buffer.byteLength(classIncludeTemplates.macros) : 0));
      for(const tag of [first.headers.etag,"*"]) {
        const conditional=await diff(path,method,{"if-none-match":tag}); expect(conditional.status).to.equal(304);
        expect(conditional.headers["content-type"]).to.equal(tag === "*" ? null : "text/plain; charset=utf-8");
      }
    }
  });
  for(const i of [1,2,4]) for(const suffix of ["","/source/main"]) it(`include refusal before missing object ${collections[i]}${suffix}`,async () => {
    const r=await diff(base+collections[i]+"/missing/includes/x"+suffix); expect(r.status).to.equal(404); expect(r.body.toString()).to.include("missing include x does not exist");
  });
  for(const accept of [undefined,"*/*",xmlAccept,xmlAccept.toUpperCase()]) it(`namespaced include Accept ${accept}`,async () => {
    const path=base+collections[0]+"/%2Fdemo%2Fzread/includes/macros";
    const r=await diff(path,"GET",accept === undefined ? {} : {accept}); expect(r.status).to.equal(200);
    if(accept === xmlAccept) expect(r.body.toString()).to.include('/%2Fdemo%2Fzread/includes/macros/source/main'); else expect(r.body.toString()).to.equal(classIncludeTemplates.macros);
  });
  for(const suffix of ["","/source/main"]) for(const method of ["GET","HEAD"]) it(`namespaced class ${suffix} ${method}`,async () => {
    expect((await diff(base+collections[0]+"/%2Fdemo%2Fzread"+suffix,method)).status).to.equal(200);
  });
  for(const i of [0,1,2,3]) it(`bare missing ${collections[i]} keeps case`,async () => {
    const r=await diff(base+collections[i]+"/zCl_NoPe"); expect(r.status).to.equal(404); expect(r.body.toString()).to.include("zCl_NoPe does not exist");
  });
  for(const i of [1,2,3]) it(`property conditional MIME ${collections[i]}`,async () => {
    const path=base+collections[i]+"/"+names[i], first=await diff(path);
    const r=await diff(path,"GET",{"if-none-match":first.headers.etag}); expect(r.status).to.equal(304);
    expect(r.headers["content-type"]).to.equal([null,"application/vnd.sap.adt.oo.interfaces.v2+xml","application/vnd.sap.adt.programs.programs.v3+xml","application/vnd.sap.adt.ddlSource+xml"][i]);
  });
  it("missing class include keeps the object refusal ahead of the include refusal",async () => {
    const r=await diff(base+collections[0]+"/zCl_NoPe/includes/Definitions"); expect(r.status).to.equal(404);
    expect(r.body.toString()).to.include("CLAS zCl_NoPe does not exist").and.not.include("include Definitions");
  });
  it("class includes are existing files, including an empty testclasses file",async () => {
    const r=await diff(base+collections[0]+"/"+names[0]); expect(r.body.toString()).to.include('includeType="testclasses"').and.include('includeType="definitions"').and.not.include('includeType="macros"');
    expect((await diff(base+collections[0]+"/zcl_plain")).body.toString().match(/<class:include /g)).to.have.length(1);
  });
  it("$TMP author appears on the class document",async () => {expect((await diff(base+collections[0]+"/zcl_author")).body.toString()).to.include('changedBy="BUILDER_A"');});
  for(const name of ["zreport","zbom","znbsp","zreports","zcomment","zline"]) it(`PROG report scan ${name}, properties keep 1970 and equal source stays active`,async () => {
    const r=await diff(base+collections[2]+"/"+name), body=r.body.toString();
    expect(body.includes('programType="executableProgram"')).to.equal(!["zreports","zcomment"].includes(name));
    expect(body).to.include('changedAt="1970-01-01T00:00:00Z"').and.include('version="active"');
  });
  it("a changed saved program reports inactive, and reverting to active bytes reports active",async () => {
    const path=base+collections[2]+"/zreport";
    store.write("PROG","ZREPORT","REPORT z.\n* changed");
    expect((await diff(path)).body.toString()).to.include('version="inactive"');
    store.write("PROG","ZREPORT","REPORT z.");
    expect((await diff(path)).body.toString()).to.include('version="active"');
  });
  for(const [label,name] of reportBoundaries) it(`PROG report scan ${label} is executable and byte-equal`,async () => {
    const r=await diff(base+collections[2]+"/"+name); expect(r.status).to.equal(200);
    expect(r.body.toString()).to.include('programType="executableProgram"');
  });
  it("version content matching ETag keeps explicit charset on 304",async () => {
    const path=base+collections[0]+"/"+names[0]+"/source/main/versions/19700101101123/00000/content";
    const first=await diff(path); expect(first.status).to.equal(200);
    expect(first.headers["content-type"]).to.equal("text/plain; charset=utf-8");
    expect(first.headers.etag).to.match(/^[0-9a-f]{32}$/);
    const r=await diff(path,"GET",{"if-none-match":first.headers.etag}); expect(r.status).to.equal(304);
    expect(r.headers["content-type"]).to.equal("text/plain; charset=utf-8"); expect(r.body.length).to.equal(0);
  });
  for(const name of ["zentity","zclassic","zboundary","zpunct"]) it(`DDLS view entity tokenizer ${name}`,async () => {
    const r=await diff(base+collections[3]+"/"+name); expect(r.body.toString().includes('ddl:source_type="view entity"')).to.equal(name === "zentity");
  });
  it("READ binds each facade's store",async () => {
    const path=base+collections[0]+"/"+names[0]+"/source/main";
    expect((await diff(path)).body).to.deep.equal(Buffer.from(source)); served.length=0;
    const r=await wire(other,path); expect(r.body.toString()).to.equal("* SECOND STORE"); expect(served).to.deep.equal([`ABAP GET ${path}`]);
  });
  for(const command of ["READ","OBJECT"]) it(`older host without ${command} refuses B2a through require`,async () => {
    const index=COMMANDS.indexOf(command); COMMANDS.splice(index,1);
    try {const r=await wire(ported,base+collections[0]+"/"+names[0]+"/source/main"); expect(r.status).to.equal(501);}
    finally {COMMANDS.splice(index,0,command);}
  });
  it("throwing READ yields the same internal error document",async () => {
    const original=store.read; store.read=() => {throw new Error('READ refused & <fault>');};
    try {const r=await diff(base+collections[0]+"/"+names[0]+"/source/main"); expect(r.status).to.equal(500); expect(r.body.toString()).to.include("READ refused &amp; &lt;fault&gt;");} finally {store.read=original;}
  });
  it("ABAP Unit of B2a and shared helpers",async () => {
    const classes=["ZCL_OSD_ADT_SOURCE","ZCL_OSD_ADT_OBJECT","ZCL_OSD_ADT_ENTITY","ZCL_OSD_ADT_HOST","ZCL_OSD_ADT_ROUTER"];
    const entries=harnessEntries(readFileSync("output/index.mjs","utf8")).filter(e => classes.includes(e.objectName));
    expect(new Set(entries.map(e => e.objectName)).size).to.equal(classes.length);
    const result=await runAll(entries,file => import("../output/"+file)); expect(result.failed).to.have.length(0);
  });
  it("Node PUT then ABAP conditional GET shares the PUT ETag and updates class state",async () => {
    const path=base+collections[0]+"/"+names[0], headers={"x-sap-adt-sessiontype":"stateful","content-type":"text/plain"};
    const before=await diff(path);
    const locked=await wire(node,path+"?_action=LOCK&accessMode=MODIFY","POST",headers);
    expect(locked.status).to.equal(200); const handle=/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(locked.body.toString())?.[1]; expect(handle).to.be.a("string");
    try {
      const saved=await wire(node,path+"/source/main?lockHandle="+encodeURIComponent(handle),"PUT",headers,source+"\r\n* saved"); expect(saved.status).to.equal(200);
      served.length=0; const r=await wire(ported,path+"/source/main","GET",{"if-none-match":saved.headers.etag}); expect(r.status).to.equal(304); expect(r.headers.etag).to.equal(saved.headers.etag); expect(served).to.deep.equal([`ABAP GET ${path}/source/main`]);
      const doc=await diff(path); expect(doc.body.toString()).to.include('version="inactive"'); expect(doc.headers.etag).not.to.equal(before.headers.etag);
    } finally {await wire(node,path+"?_action=UNLOCK&lockHandle="+encodeURIComponent(handle),"POST",headers);}
  });
});
