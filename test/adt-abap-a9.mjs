import {expect} from "chai";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import "./start.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {Data} from "../tools/osd-data.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {WarmCompiler} from "../tools/osd-warm.mjs";
const base = "/sap/bc/adt/core/http/xref/";
const clean = s => s.replace(/\?$/, "");
const str = s => new abap.types.String().set(s);
for (const remote of [false, true]) describe(`A9 ${remote ? "OSD_ADT_ONE_RUNTIME=1 serving child" : "inline"} live Node byte diff`, function () {
  this.timeout(120000);
  let root, store, runtime, data, node, ported;
  const servers = [], served = [];
  let sequence = 0;
  async function childSQL(sql) {
    const id = ++sequence;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => finish(new Error("A9 child SQL timeout")), 15000);
      const receive = m => {if (m?.type === "a9-answer" && m.id === id) finish(m.error ? new Error(m.error) : undefined, m.value);};
      const finish = (error, value) => {clearTimeout(timer);runtime.child.off("message", receive);error ? fail(error) : done(value);};
      runtime.child.on("message", receive);runtime.child.send({type:"a9-sql", id, sql});
    });
  }
  const execute = async sql => {
    if (!remote) return dialogStep(() => abap.context.databaseConnections.DEFAULT.execute(sql), "A9 fixture");
    const answer = await childSQL(sql);
    expect(answer.pid).to.equal(runtime.child.pid);expect(answer.pid).not.to.equal(process.pid);
    return answer;
  };
  async function mount(isAbap, limit) {
    const app = express();app.set("etag", false);
    const facade = adtRouter({store, data, watch:false, logMisses:false, xrefLimit:limit,
      ...(isAbap ? {abap:remote ? abapRunner({remote:runtime}) : abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER, step:dialogStep}),
        abapServed:(by, req) => served.push(`${by} ${clean(req.originalUrl)}`)} : {})});
    app.use(facade.router);
    const server = await new Promise(done => {const s = app.listen(0, "127.0.0.1", () => done(s));});servers.push(server);
    return {url:`http://127.0.0.1:${server.address().port}`, facade};
  }
  async function wire(side, path, method="GET") {
    const r = await fetch(side.url + base + path, {method});
    return {status:r.status, type:r.headers.get("content-type"), length:r.headers.get("content-length"), etag:r.headers.get("etag"), body:Buffer.from(await r.arrayBuffer())};
  }
  async function diff(path, status=200, method="GET", sides=[node,ported]) {
    const expected = await wire(sides[0], path, method);served.length = 0;
    const actual = await wire(sides[1], path, method);
    expect(actual.body.toString(), path).to.equal(expected.body.toString());
    expect(actual, path).to.deep.equal(expected);
    expect(actual.status, actual.body.toString()).to.equal(status);
    expect(served).to.deep.equal([`ABAP ${base}${clean(path)}`]);
    return method === "HEAD" ? undefined : status === 200 ? JSON.parse(actual.body) : actual.body.toString();
  }
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-a9-"));mkdirSync(join(root,"src"));
    writeFileSync(join(root,"abaplint.jsonc"), JSON.stringify({syntax:{version:"v702"}, rules:{}}));
    writeFileSync(join(root,"abap_transpile.json"), JSON.stringify({input_folder:["src"], exclude_filter:[]}));
    for (const name of ["zcl_a9_root","zcl_a9_a","zcl_a9_b","zcl_a9_c","zcl_a9_dpc","zcl_a9_mpc"]) {
      writeFileSync(join(root,"src",name+".clas.abap"), `CLASS ${name} DEFINITION PUBLIC. ENDCLASS. CLASS ${name} IMPLEMENTATION. ENDCLASS.`);
    }
    writeFileSync(join(root,"src","zif_a9.intf.abap"), "INTERFACE zif_a9 PUBLIC. ENDINTERFACE.");
    writeFileSync(join(root,"src","zcl_a9_b.clas.testclasses.abap"), "CLASS ltcl_a9 DEFINITION FOR TESTING. ENDCLASS. CLASS ltcl_a9 IMPLEMENTATION. ENDCLASS.");
    writeFileSync(join(root,"src","za9.iwsv.xml"), '<abapGit><IWSV><TECHNICAL_NAME>ZA9</TECHNICAL_NAME><EXTERNAL_NAME>ZA9_SRV</EXTERNAL_NAME><CLASS_NAME>ZCL_A9_DPC</CLASS_NAME><_-IWBEP_-I_MGW_SRG><MODEL_TECH_NAME>ZA9_MODEL</MODEL_TECH_NAME><MODEL_VERSION>0001</MODEL_VERSION></_-IWBEP_-I_MGW_SRG></IWSV></abapGit>');
    writeFileSync(join(root,"src","za9_model.iwmo.xml"), '<abapGit><IWMO><TECHNICAL_NAME>ZA9_MODEL</TECHNICAL_NAME><VERSION>0001</VERSION><CLASS_NAME>ZCL_A9_MPC</CLASS_NAME></IWMO></abapGit>');
    for(const [file,service,external] of [["za9_second","ZA9_SECOND","ZA9_SECOND_SRV"],["za9_winner","ZA9_WINNER","ZA9_SRV"]]) {
      writeFileSync(join(root,"src",file+".iwsv.xml"), `<abapGit><IWSV><TECHNICAL_NAME>${service}</TECHNICAL_NAME><EXTERNAL_NAME>${external}</EXTERNAL_NAME><CLASS_NAME>ZCL_A9_DPC</CLASS_NAME><_-IWBEP_-I_MGW_SRG><MODEL_TECH_NAME>ZA9_MODEL</MODEL_TECH_NAME><MODEL_VERSION>0001</MODEL_VERSION></_-IWBEP_-I_MGW_SRG></IWSV></abapGit>`);
    }
    store = new ObjectStore({root, libs:[], roots:[{path:"src",package:"$TMP",writable:true}]});
    if (remote) {
      runtime = new ServingRuntime({root:process.cwd(), env:{OSD_ADT_ONE_RUNTIME:"1", STG_DB:"sqlite", STG_DB_PATH:"", STG_TLS:"0",
        NODE_OPTIONS:[process.env.NODE_OPTIONS, `--import=${resolve("test/helpers/a9-child.mjs")}`].filter(Boolean).join(" ")}});
      runtime.storeDestination = new StoreDestination({store});await runtime.start();
      data = new Data({runtime});
    } else data = new Data({client:abap.context.databaseConnections.DEFAULT});
    for (const table of ["wbcrossgt","wbcrossgtx"]) await execute(`DELETE FROM ${table} WHERE name LIKE 'Z%A9%'`);
    for (const [table,name,include] of [
      ["wbcrossgt","ZCL_A9_ROOT","ZCL_A9_ROOT"], ["wbcrossgt","ZCL_A9_ROOT","ZCL_A9_A"],
      ["wbcrossgtx","ZCL_A9_ROOT","ZCL_A9_A"], ["wbcrossgtx","ZCL_A9_ROOT","zcl_a9_b"],
      ["wbcrossgt","ZCL_A9_ROOT","ZCL_A9_DPC"], ["wbcrossgt","ZCL_A9_ROOT","ZUNKNOWN"],
      ["wbcrossgt","ZCL_A9_A","ZCL_A9_C"], ["wbcrossgt","ZCL_A9_C","ZCL_A9_ROOT"],
      ["wbcrossgt","ZIF_A9","ZCL_A9_A"],
    ]) await execute(`INSERT INTO ${table} (otype,name,include) VALUES ('TY','${name.padEnd(120)}','${include.padEnd(40)}')`);
    node = await mount(false);ported = await mount(true);
  });
  after(async () => {
    for (const s of servers) await new Promise(done => s.close(done));
    if(runtime) await runtime.stop();
    else for(const table of ["wbcrossgt","wbcrossgtx"]) await execute(`DELETE FROM ${table} WHERE name LIKE 'Z%A9%'`);
    if(root) rmSync(root,{recursive:true,force:true});
  });
  for (const route of ["readers","closure"]) {
    for (const [query,status] of [["type=CLAS&name=zcl_a9_root",200],["type=INTF&name=zif_a9",200],["type=PROG&name=zcl_a9_root",400],["type=CLAS",400],["type=CLAS&name=ZNOPE",404],["",400]])
      it(`${route} ${query || "empty"} (${status})`, async () => {await diff(`${route}?${query}`,status);});
    it(`${route} case, trailing slash and repeated query`, async () => {
      await diff(`${route.toUpperCase()}/?type=clas&name=zcl_a9_root`);
      await diff(`${route}?type=CLAS&type=INTF&name=ZCL_A9_ROOT`,400);
    });
    it(`${route} HEAD`, async () => {await diff(`${route}?type=CLAS&name=ZCL_A9_ROOT`,200,"HEAD");});
    it(`${route} empty graph`, async () => {await diff(`${route}?type=CLAS&name=ZCL_A9_MPC`);});
    if(!remote) it(`${route} red proof`, async () => {
      const proto = abap.Classes.ZCL_OSD_ADT_XREF.prototype, original = proto.zif_osd_adt_route$handle;
      proto.zif_osd_adt_route$handle = async function(input) {const r=await original.call(this,input);r.get().body.set(r.get().body.get()+" ");return r;};
      try {
        if(process.env.OSD_ADT_RED === route) await diff(`${route}?type=CLAS&name=ZCL_A9_ROOT`);
        else {let error;try {await diff(`${route}?type=CLAS&name=ZCL_A9_ROOT`);} catch(e) {error=e;}expect(error?.message).to.contain("to equal");}
      } finally {proto.zif_osd_adt_route$handle=original;}
      await diff(`${route}?type=CLAS&name=ZCL_A9_ROOT`);
    });
  }
  it("closure cycle, test classification and cap seam", async () => {
    const result=await diff("closure?type=CLAS&name=ZCL_A9_ROOT");
    expect(result.source).to.equal("xref");expect(result.tests).to.deep.equal(["ZCL_A9_B"]);
    expect(result.closure.map(o=>o.name)).to.include("ZCL_A9_C");expect(result.truncated).to.equal(false);
    const sides=[await mount(false,3),await mount(true,3)];
    const capped=await diff("closure?type=CLAS&name=ZCL_A9_ROOT",200,"GET",sides);
    expect(capped.truncated).to.equal(true);expect(capped.counts.objects).to.equal(5);
    const chain=await diff("closure?type=INTF&name=ZIF_A9",200,"GET",sides);
    expect(chain.counts.objects).to.equal(3);expect(chain.truncated).to.equal(true);
    const smallest=[await mount(false,1),await mount(true,1)];
    const rootOnly=await diff("closure?type=CLAS&name=ZCL_A9_ROOT",200,"GET",smallest);
    expect(rootOnly.counts.objects).to.equal(1);expect(rootOnly.truncated).to.equal(true);
  });
  it("readers dedupe, self exclusion, UNKNOWN and registered service", async () => {
    const r=await diff("readers?type=CLAS&name=ZCL_A9_ROOT");
    expect(r.readers.map(o=>o.name)).to.deep.equal(["ZCL_A9_A","ZCL_A9_B","ZCL_A9_DPC","ZUNKNOWN"]);
    expect(r.readers.at(-1).type).to.equal("UNKNOWN");expect(r.counts.tests).to.equal(1);
    expect(r.readers.find(o=>o.name==="ZCL_A9_DPC").services).to.deep.equal(["ZA9_SRV","ZA9_SECOND_SRV"]);
    expect(r.counts.services).to.equal(2);
  });
  for (const route of ["readers","closure"]) it(`${route} host fact failure keeps com.sap.adt namespace`, async () => {
    const original=store.list;
    store.list=()=>{throw new Error('xref <failure> & "detail"');};
    try {expect(await diff(`${route}?type=CLAS&name=ZCL_A9_ROOT`,500)).to.include('com.sap.adt');}
    finally {store.list=original;}
  });
  it("real primed compiler answers both warm routes", async () => {
    const compiler=new WarmCompiler({root:process.cwd()});
    const previous=store, warm=process.env.OSD_WARM;
    process.env.OSD_WARM="1";
    try {
      await compiler.prime();
      store=new ObjectStore({root:process.cwd()});store.warm().compiler=compiler;
      const sides=[await mount(false),await mount(true)];
      for(const route of ["readers","closure"]) {
        const result=await diff(`${route}?type=CLAS&name=ZCL_ZSTG_DEMO_MPC_EXT`,200,"GET",sides);
        expect(result.source).to.equal("warm");
      }
    } finally {compiler.close();store=previous;if(warm === undefined) delete process.env.OSD_WARM;else process.env.OSD_WARM=warm;}
  });
  it("readers count direct DPC and MPC registrations without readers", async () => {
    for(const name of ["ZCL_A9_DPC","ZCL_A9_MPC"]) {
      const result=await diff(`readers?type=CLAS&name=${name}`);
      expect(result.counts).to.deep.equal({readers:0,tests:0,services:2});
    }
  });
  if(remote) it("runtime identity: child seeded tables answer both routes while parent reads are poisoned", async () => {
    const client=abap.context.databaseConnections.DEFAULT, original=client.select;
    client.select=function(input) {if(/wbcrossgt/i.test(input.select)) throw new Error("parent xref must not be read");return original.call(this,input);};
    try {
      for (const route of ["readers","closure"]) await diff(`${route}?type=CLAS&name=ZCL_A9_ROOT`);
      expect((await data.query("SELECT include FROM wbcrossgt WHERE name = 'ZCL_A9_A'")).rows).to.have.length(1);
      const previous=store;
      try {
        store=new ObjectStore({root:process.cwd()});
        const sides=[await mount(false),await mount(true)];
        for(const route of ["readers","closure"]) {
          const result=await diff(`${route}?type=CLAS&name=ZCL_ZSTG_DEMO_MPC_EXT`,200,"GET",sides);
          expect(result.source).to.equal("xref");
          expect(result.counts[route === "readers" ? "readers" : "objects"]).to.be.greaterThan(0);
        }
      } finally {store=previous;}
    } finally {client.select=original;}
  });
});
describe("A9 COLLATE V8 conformance", function() {
  this.timeout(60000);
  it("every demo store.list name and punctuation cases", async () => {
    const store=new ObjectStore({root:process.cwd()});
    const names=[...new Set([...store.list().map(o=>o.name),"ZCL_A_B","ZCL_AB","ZCL_A1","/NS/ZCL_X","ZCL_A=","zcl_a","ZCL_A"])];
    const keys=await Promise.all(names.map(async name=>({name,key:(await abap.Classes.ZCL_OSD_ADT_JS.collate({iv_text:str(name)})).get()})));
    expect(keys.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(o=>o.name)).to.deep.equal([...names].sort((a,b)=>a.localeCompare(b)));
  });
});

describe("A9 switch off in the reduced parent", function() {
  this.timeout(60000);
  it("delegates both xref routes through the catch-all over child tables", async () => {
    const result=await promisify(execFile)(process.execPath,["test/helpers/a9-switch-off.mjs"],
      {env:{...process.env,OSD_ADT_ONE_RUNTIME:"0"},timeout:55000});
    expect(result.stdout).to.include("A9 switch-off: reduced parent delegates both routes to Node over child tables");
  });
});
