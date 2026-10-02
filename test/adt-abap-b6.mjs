// B6 gate: real Node and ABAP fronts over one store, with ETags disabled
// as in production. A route falling back to Node must fail this gate.
import {expect} from "chai";
import express from "express";
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import "./start.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {StoreDestination, withSystem, COMMANDS} from "../tools/osd-store-destination.mjs";
import {box, answerOf} from "./helpers/destination.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const at = (side) => `http://127.0.0.1:${side.server.address().port}`;

async function wire(side, path, options = {}) {
  const res = await fetch(at(side) + path, options);
  const headers = Object.fromEntries(["content-type", "content-length", "etag", "location"].map((h) => [h, res.headers.get(h)]));
  // Each facade mints its own session; compare cookie order/attributes after
  // checking the random identifier's format and the two cookies' agreement.
  const cookies = res.headers.getSetCookie();
  const ids = cookies.map((c) => /^[^=]+=([0-9a-f]{24});/.exec(c)?.[1]);
  if (cookies.length) {
    expect(ids.every((id) => id !== undefined)).to.equal(true);
    expect(new Set(ids).size).to.equal(1);
  }
  headers["set-cookie"] = cookies.map((c) => c.replace(/=([0-9a-f]{24});/, "=<session>;"));
  expect(res.headers.get("x-osd-miss")).to.equal(null);
  return {status: res.status, headers, body: Buffer.from(await res.arrayBuffer())};
}

describe("ADT B6: search and virtual folders Node diff", function () {
  this.timeout(60000);
  let root, node, ported;
  const served = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-b6-"));
    const pkg = (folder, name, text = name) => {
      mkdirSync(join(root,folder), {recursive:true});
      writeFileSync(join(root,folder,"package.devc.xml"), `<abapGit><DEVC><DEVCLASS>${name}</DEVCLASS><CTEXT>${text}</CTEXT></DEVC></abapGit>`);
    };
    pkg("work/root", "$ROOT", "Root &amp; &lt; raw text\tline\n\\n");
    pkg("work/a", "$ZT_A"); pkg("work/b", "$ZTA"); pkg("work/ns", "/DEMO/PKG");
    pkg("lib", "$LIB");
    const source = (folder,name,kind,body) => writeFileSync(join(root,folder,name.toLowerCase()+"."+kind+".abap"),body);
    source("work/root", "ZCL_TREE", "clas", "CLASS zcl_tree DEFINITION PUBLIC. ENDCLASS. CLASS zcl_tree IMPLEMENTATION. ENDCLASS.");
    source("work/root", "ZCL_TREE", "clas.testclasses", ""); source("work/root", "ZCL_TREE", "clas.locals_imp", "");
    source("work/root", "ZT_PROG", "prog", "REPORT zt_prog.");
    source("work/root", "ZT_INCLUDE", "prog", "");
    writeFileSync(join(root,"work/root","zt_include.prog.xml"), "<abapGit><PROGDIR><SUBC>I</SUBC></PROGDIR></abapGit>");
    writeFileSync(join(root,"work/root","zt_ddl.ddls.asddls"), "define view ZT_DDL as select from zt_tab { key id }");
    source("lib", "ZCL_LIBRARY", "clas", "CLASS zcl_library DEFINITION PUBLIC. ENDCLASS. CLASS zcl_library IMPLEMENTATION. ENDCLASS.");
    for (let i=0;i<12;i++) source("work/root", `ZSEED_B_${String(i).padStart(2,"0")}`, "prog", "REPORT zseed.");
    source("work/root", "ZSEED_END_B", "prog", "REPORT zseed.");
    const store = new ObjectStore({root, libs: ["lib"], roots: [["work/root","$ROOT"],["work/a","$ZT_A"],["work/b","$ZTA"],["work/ns","/DEMO/PKG"]].map(([path,packageName]) => ({path,package:packageName,writable:true,library:false}))});
    store.create("DEVC", "$ROOT_CHILD", {package:"$ROOT", description:"Child & raw text\tline\n\\t"});
    store.create("PROG", "ZT_USER_A", {package:"$TMP", author:"BUILDER_A"});
    store.create("PROG", "ZT_USER_B", {package:"$TMP", author:"BUILDER_B"});
    store.create("DEVC", "$TMP_KID", {package:"$TMP", author:"BUILDER_A"});
    store.write("PROG", "ZT_PROG", "REPORT zt_prog. WRITE 'inactive'.");
    const mount = async (isAbap) => {
      const app = express();
      app.set("etag", false);
      app.use(express.raw({type: "*/*"}));
      const facade = adtRouter({store, data: {}, watch: false, logMisses: false,
        ...(isAbap ? {abap: abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep}),
          abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl}`)} : {})});
      app.use(facade.router);
      const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      const warm = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/b6/warmup`, {headers: {"x-csrf-token": "fetch"}});
      await warm.arrayBuffer();
      const users = {};
      for (const user of ["BUILDER_A", "BUILDER_B"]) {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/b6/warmup`, {headers:{"x-csrf-token":"fetch", authorization:"Basic " + Buffer.from(user+":test").toString("base64")}});
        await res.arrayBuffer();
        users[user] = {cookie:res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token":res.headers.get("x-csrf-token")};
      }
      return {server, facade, store, users, auth: {cookie: warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
        "x-csrf-token": warm.headers.get("x-csrf-token")}};
    };
    const red = process.env.OSD_ADT_RED;
    if (["search", "vfs", "search-order", "vfs-order"].includes(red)) {
      const klass = abap.Classes[red.startsWith("search") ? "ZCL_OSD_ADT_SEARCH" : "ZCL_OSD_ADT_VFS"];
      const original = klass.document;
      klass.document = async (...args) => {
        const result = await original.apply(klass,args);
        if (red.endsWith("-order")) {
          // Model array member enumeration as string keys: 1,10,11,12,2,...
          // Mutate only the ABAP boundary; the live Node oracle stays intact.
          const pattern = red.startsWith("search") ? /<adtcore:objectReference [^>]*\/>/g : /<vfs:object [\s\S]*?<\/vfs:object>/g;
          const rows = [...result.get().matchAll(pattern)].map((m, i) => ({key:String(i+1), xml:m[0]}));
          rows.sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
          let i = 0;
          result.set(result.get().replace(pattern, () => rows[i++].xml));
        } else result.set(result.get()+"\n");
        return result;
      };
    }
    if (["seed", "nan"].includes(red)) {
      const original = StoreDestination.prototype.call;
      StoreDestination.prototype.call = async function (name, signature) {
        if (signature.exporting.iv_command?.get() === "SEARCH") {
          const input = JSON.parse(signature.exporting.iv_json.get());
          if (red === "seed" && input.limit !== null) input.limit = String(Number(input.limit)/4);
          if (red === "nan" && input.limit === null) input.limit = "0";
          signature.exporting.iv_json.set(JSON.stringify(input));
        }
        return original.call(this, name, signature);
      };
    }
    node = await mount(false);
    ported = await mount(true);
  });
  after(async () => {
    for (const side of [node, ported]) if (side) await new Promise((resolve) => side.server.close(resolve));
    if (root) rmSync(root, {recursive: true, force: true});
  });
  async function diff(path, method = "GET", headers = {}, body, user) {
    const ask = (side) => ({method,headers:{...(user ? side.users[user] : side.auth),...headers},...(body === undefined ? {} : {body})});
    const expected = await wire(node,path,ask(node));
    served.length = 0;
    const actual = await wire(ported,path,ask(ported));
    expect(actual.body.toString()).to.equal(expected.body.toString());
    expect(actual).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${path}`]);
    return expected;
  }
  const base = "/sap/bc/adt/repository/informationsystem/";
  const searches = ["", "query=ZCL*", "query=*B", "query=*", "query=", "search=ZCL", "query=ZT+PROG", "query=ZT%20PROG", "query=50%", "query=%zz",
    "query=ZCL&objectType=CLAS/OC", "objectType=DEVC/K", "type=PROG", "objectType=&type=CLAS", "objectType=/K", "query=LIBRARY", "query=ZCL&query=TREE"];
  for (const query of searches) for (const max of [undefined,"", "0", "1", "3", "-1", "2.5", "abc", "NaN", "1e1", " 7 ", "Infinity", "-Infinity", "0x10", "-1e100"])
    it(`search ${query} max=${max}`, async () => {
      const path = base+"search?"+query+(max === undefined ? "" : "&maxResults="+encodeURIComponent(max));
      expect((await diff(path)).status).to.equal(200);
    });
  it("search preserves Node byte order for 12 hits", async () => {
    const res = await diff(base+"search?query=ZSEED_B_*&objectType=PROG&maxResults=12");
    const names = [...res.body.toString().matchAll(/(?:adtcore:)?name="(ZSEED_B_[^"]+)"/g)].map((m) => m[1]);
    expect(names).to.deep.equal(Array.from({length:12}, (_,i) => `ZSEED_B_${String(i).padStart(2,"0")}`));
  });
  it("seed max*4 retains a suffix hit after more than max index entries", async () => {
    const res = await diff(base+"search?query=*B&objectType=PROG&maxResults=4");
    expect(res.body.toString()).to.include("ZSEED_END_B");
  });
  for(const method of ["GET","HEAD"]) it(`search ${method} uppercase and trailing slash`, async () => {
    expect((await diff((base+"search/").toUpperCase(),method)).status).to.equal(200);
  });
  const request = (selected,order=[],pattern) => '<vfs:request'+(pattern === undefined ? '' : ` objectSearchPattern="${pattern}"`)+'>'+
    selected.map(([facet,values]) => `<vfs:preselection facet="${facet}">${values.map((v)=>`<vfs:value>${v}</vfs:value>`).join('')}</vfs:preselection>`).join('')+
    order.map((f)=>`<vfs:facet>${f}</vfs:facet>`).join('')+'</vfs:request>';
  it("VFS preserves Node byte order for 12 objects", async () => {
    const res = await diff(base+"virtualfolders/contents", "POST", {}, request([["package",["$ROOT"]]], [], "ZSEED_B_*"));
    const names = [...res.body.toString().matchAll(/(?:adtcore:)?name="(ZSEED_B_[^"]+)"/g)].map((m) => m[1]);
    expect(names).to.deep.equal(Array.from({length:12}, (_,i) => `ZSEED_B_${String(i).padStart(2,"0")}`));
  });
  const selections = [[], [["package",["$ROOT"]]], [["package",["..$ROOT"]]], [["package",["$ZT_A","$ZTA"]]], [["package",["$UNKNOWN"]]],
    [["package",["$ROOT_CHILD"]]], [["package",["$LIB"]]], [["package",["$ROOT"]],["type",["REPO"]]],
    [["package",["$LIB"]],["type",["CLAS"]],["package",["$ROOT"]]], [["package",["A&amp;B"]]], [["PACKAGE",["$ROOT"]]],
    [["group",["CORE_DATA_SERVICES"]]], [["api",["RELEASED"]]], [["fav",["X"]]]];
  for(const selected of selections) for(const order of [[],["package"],["group","type"],["type","group"],["api"],["fav"],["other"]])
    for(const pattern of [undefined,"", "ZCL*", "*X*"])
      it(`vfs ${JSON.stringify(selected)} ${order} ${pattern}`, async () => {
        expect((await diff(base+"virtualfolders/contents","POST",{},request(selected,order,pattern))).status).to.equal(200);
      });
  it("VFS bulk channel never delegates rendering or parses the tree through ajson", async () => {
    const original=abap.Classes.ZCL_AJSON.parse;
    const call=StoreDestination.prototype.call;
    StoreDestination.prototype.call=async function(name,signature) {
      expect(signature.exporting.iv_type?.get()).not.to.equal("VFS");
      return call.call(this,name,signature);
    };
    abap.Classes.ZCL_AJSON.parse=async function(input) {
      expect(input.iv_json.get().length).to.be.lessThan(1000);
      return original.call(this,input);
    };
    try {expect((await diff(base+"virtualfolders/contents","POST",{},"")).status).to.equal(200);}
    finally {abap.Classes.ZCL_AJSON.parse=original;StoreDestination.prototype.call=call;}
  });
  it("VFS invalid UTF-8 and case-sensitive captures", async () => {
    for(const body of [Buffer.from([255]), '<vfs:preselection FACET="package"><vfs:value>$UNKNOWN</vfs:value></vfs:preselection>', '<vfs:facet></vfs:facet>'])
      expect((await diff(base+"virtualfolders/contents","POST",{},body)).status).to.equal(200);
  });
  it("VFS host throw is a byte-equal 500, never a hanging request", async () => {
    const store = node.store;
    // Both fronts bind the same store; capture it through the facade below.
    const original = store.packages;
    store.packages = () => {throw new Error("B6 synthetic store fault");};
    try { expect((await diff(base+"virtualfolders/contents","POST",{},"")).status).to.equal(500); }
    finally {store.packages=original;}
  });
  it("missing PACKAGES and SEARCH capabilities refuse with 501", async () => {
    for(const [command,path,method] of [["PACKAGES",base+"search","GET"],["SEARCH",base+"search?objectType=CLAS","GET"],["PACKAGES",base+"virtualfolders/contents","POST"]]) {
      const i=COMMANDS.indexOf(command); COMMANDS.splice(i,1);
      try {expect((await wire(ported,path,{method,headers:ported.auth,...(method==='POST'?{body:''}:{})})).status).to.equal(501);}
      finally {COMMANDS.splice(i,0,command);}
    }
  });
});

describe("B6 PACKAGES and SEARCH bound destination envelopes", () => {
  const call = async (destination,command,input) => {
    const signature = {exporting:{iv_command:box(command),iv_json:box(JSON.stringify(input))},
      importing:{ev_source:box("stale"),ev_json:box("stale"),ev_error:box("stale"),et_object:box([])}};
    await destination.call("ZOSD_STORE",signature);
    return answerOf(signature);
  };
  const long = '/DEMO/LONG_PACKAGE_NAME_123456789012345678901234567890';
  for(const format of [undefined,"lines","vfs-lines"]) it(`PACKAGES format=${format} keeps order and full names from bound stores`, async () => {
    let opens=0;
    const destination=new StoreDestination({store:()=>{opens++;throw new Error('default must not open');}});
    const results=await Promise.all(['ONE','TWO'].map((marker)=>withSystem(()=>({}),()=>call(destination,'PACKAGES',{format}),{store:{
      packages:()=>[{name:'$ZT_A',description:marker+'\tline\n\\t',subpackages:[long]},{name:'$ZTA'},{name:long}],
      package:()=>({objects:[{type:'CLAS',name:long+marker,library:true,description:'escaped\tline\n\\n'}]})
    }})));
    expect(opens).to.equal(0);
    for(const [i,result] of results.entries()) {
      expect(result.EV_ERROR).to.equal(''); expect(result.ET_OBJECT).to.deep.equal([]);
      if(format === undefined) {
        const rows=JSON.parse(result.EV_JSON);
        expect(rows.map((r)=>r.name)).to.deep.equal(['$ZT_A','$ZTA',long]);
        expect(rows[0]).not.to.have.property('objects');
      } else {
        expect(result.EV_JSON).to.equal('');
        const rows=result.EV_SOURCE.split('\n');
        expect(rows.filter((r)=>r.startsWith('P\t')).map((r)=>r.split('\t')[1])).to.deep.equal(['$ZT_A','$ZTA',long]);
        expect(rows[0].split('\t')[3]).to.equal(['ONE','TWO'][i]+'\\tline\\n\\\\t');
        if(format==='vfs-lines') {
          expect(rows[1]).to.equal('C\t$ZT_A\t'+long);
          expect(rows[2].split('\t')).to.deep.equal(['O','$ZT_A','CLAS',long+['ONE','TWO'][i],'escaped\\tline\\n\\\\n','X']);
        } else expect(rows).to.have.length(3);
      }
    }
  });
  for(const format of [undefined,'lines']) for(const limit of ['16',null,'-4','0','10','Infinity']) it(`SEARCH ${format} limit ${limit} preserves index order and NaN`, async () => {
    let options;
    const destination=new StoreDestination({store:()=>{throw new Error('default must not open');}});
    const rows=[{type:'CLAS',name:long},{type:'CLAS',name:'$ZT_A'}];
    const result=await withSystem(()=>({}),()=>call(destination,'SEARCH',{seed:'B',type:'CLAS',limit,format}),{store:{
      search:(seed,asked)=>{expect(seed).to.equal('B');options=asked;return rows;}
    }});
    if(format === "lines") {
      expect(result.EV_JSON).to.equal("");
      expect(result.EV_SOURCE).to.equal("CLAS\t"+long+"\t\nCLAS\t$ZT_A\t");
    } else expect(JSON.parse(result.EV_JSON)).to.deep.equal(rows);
    expect(options.type).to.equal('CLAS');
    if(limit===null) expect(Number.isNaN(options.max)).to.equal(true);
    else expect(options.max).to.equal(Number(limit));
    expect(result.ET_OBJECT).to.deep.equal([]);
  });
  it('typed faults retain the raw message',async()=>{
    const result=await withSystem(()=>({}),()=>call(new StoreDestination({store:{}}),'PACKAGES',{}),{store:{packages:()=>{throw new Error('B6 synthetic fault');}}});
    expect(JSON.parse(result.EV_JSON)).to.deep.equal({error:{code:'INTERNAL',message:'B6 synthetic fault'}});
  });
});
