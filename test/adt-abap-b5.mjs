// B5 gate: real Node and ABAP fronts over one store, with ETags disabled
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

describe("ADT B5: package and repository tree Node diff", function () {
  this.timeout(60000);
  let root, node, ported;
  const served = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "osd-b5-"));
    const pkg = (folder, name, text = name) => {
      mkdirSync(join(root,folder), {recursive:true});
      writeFileSync(join(root,folder,"package.devc.xml"), `<abapGit><DEVC><DEVCLASS>${name}</DEVCLASS><CTEXT>${text}</CTEXT></DEVC></abapGit>`);
    };
    pkg("work/root", "$ROOT", "Root &amp; &lt; raw text");
    pkg("work/a", "$ZT_A"); pkg("work/b", "$ZTA"); pkg("work/ns", "/DEMO/PKG");
    pkg("lib", "$LIB");
    pkg("work/order", "$ORDER");
    const source = (folder,name,kind,body) => writeFileSync(join(root,folder,name.toLowerCase()+"."+kind+".abap"),body);
    source("work/root", "ZCL_TREE", "clas", "CLASS zcl_tree DEFINITION PUBLIC. ENDCLASS. CLASS zcl_tree IMPLEMENTATION. ENDCLASS.");
    source("work/root", "ZCL_TREE", "clas.testclasses", ""); source("work/root", "ZCL_TREE", "clas.locals_imp", "");
    source("work/root", "ZT_PROG", "prog", "REPORT zt_prog.");
    source("work/root", "ZT_INCLUDE", "prog", "");
    writeFileSync(join(root,"work/root","zt_include.prog.xml"), "<abapGit><PROGDIR><SUBC>I</SUBC></PROGDIR></abapGit>");
    writeFileSync(join(root,"work/root","zt_ddl.ddls.asddls"), "define view ZT_DDL as select from zt_tab { key id }");
    source("lib", "ZCL_LIBRARY", "clas", "CLASS zcl_library DEFINITION PUBLIC. ENDCLASS. CLASS zcl_library IMPLEMENTATION. ENDCLASS.");
    const store = new ObjectStore({root, libs: ["lib"], roots: [["work/order","$ORDER"],["work/root","$ROOT"],["work/a","$ZT_A"],["work/b","$ZTA"],["work/ns","/DEMO/PKG"]].map(([path,packageName]) => ({path,package:packageName,writable:true,library:false}))});
    store.create("DEVC", "$ROOT_CHILD", {package:"$ROOT", description:"Child & raw text"});
    store.create("PROG", "ZT_USER_A", {package:"$TMP", author:"BUILDER_A"});
    store.create("PROG", "ZT_USER_B", {package:"$TMP", author:"BUILDER_B"});
    store.create("DEVC", "$TMP_KID", {package:"$TMP", author:"BUILDER_A"});
    for (let i = 1; i <= 12; i++) {
      const suffix = String(i).padStart(2, "0");
      store.create("DEVC", "$ORDER_"+suffix, {package:"$ORDER"});
      store.create("PROG", "ZT_ORDER_"+suffix, {package:"$ORDER"});
    }
    let parent = "$ROOT";
    for (let i = 1; i <= 12; i++) {
      const name = parent+"_D";
      store.create("DEVC", name, {package:parent});
      parent = name;
    }
    store.create("PROG", "ZT_DEEP", {package:parent});
    store.write("PROG", "ZT_PROG", "REPORT zt_prog. WRITE 'inactive'.");
    const mount = async (isAbap) => {
      const app = express();
      app.set("etag", false);
      app.use(express.raw({type: "*/*"}));
      const facade = adtRouter({store, data: {}, watch: false, logMisses: false,
        ...(isAbap ? {abap: abapRunner({handler: abap.Classes.ZCL_OSD_ADT_HANDLER, step: dialogStep}),
          abapServed: (by, req) => served.push(`${by} ${req.method} ${req.originalUrl.replace(/\?$/, "")}`)} : {})});
      app.use(facade.router);
      const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
      const warm = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/b5/warmup`, {headers: {"x-csrf-token": "fetch"}});
      await warm.arrayBuffer();
      const users = {};
      for (const user of ["BUILDER_A", "BUILDER_B"]) {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/sap/bc/adt/b5/warmup`, {headers:{"x-csrf-token":"fetch", authorization:"Basic " + Buffer.from(user+":test").toString("base64")}});
        await res.arrayBuffer();
        users[user] = {cookie:res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-csrf-token":res.headers.get("x-csrf-token")};
      }
      return {server, facade, users, auth: {cookie: warm.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
        "x-csrf-token": warm.headers.get("x-csrf-token")}};
    };
    const method = process.env.OSD_ADT_RED;
    if (["package", "path", "tree"].includes(method)) {
      const klass = abap.Classes[method === "package" ? "ZCL_OSD_ADT_PACKAGE" : "ZCL_OSD_ADT_TREE"];
      const member = method === "path" ? "path_document" : "document";
      const original = klass[member];
      klass[member] = async (...args) => {
        const result = await original.apply(klass,args);
        result.set(result.get()+"\n");
        return result;
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
    expect(await wire(ported,path,ask(ported))).to.deep.equal(expected);
    expect(served).to.deep.equal([`ABAP ${method} ${path.replace(/\?$/, "")}`]);
    return expected;
  }
  for (const name of ["%24root", "%24zt_a", "%24zta", "%2Fdemo%2Fpkg", "%24lib", "ZNope"])
    for (const accept of ["*/*", "application/vnd.sap.adt.packages.v2+xml", "PACKAGES.V2+XML"])
      for (const method of ["GET", "HEAD"]) it(`package ${name} ${accept} ${method}`, async () => {
        const res = await diff("/sap/bc/adt/packages/"+name,method,{accept});
        expect(res.status).to.equal(name === "ZNope" ? 404 : 200);
      });
  it("malformed package parameter compares status only", async () => {
    // Express rejects :param decoding before dispatch; its error body is
    // deliberately outside byte parity (see the port plan).
    const path = "/sap/bc/adt/packages/%zz";
    const expected = await fetch(at(node) + path, {headers: node.auth});
    const actual = await fetch(at(ported) + path, {headers: ported.auth});
    await Promise.all([expected.arrayBuffer(), actual.arrayBuffer()]);
    expect(expected.status).to.equal(400);
    expect(actual.status).to.equal(expected.status);
  });
  for (const user of ["BUILDER_A", "BUILDER_B"]) for (const name of ["%24tmp", "%24tmp_kid"])
    it(`local package ${name} ${user}`, async () => { await diff("/sap/bc/adt/packages/"+name,"GET",{},undefined,user); });
  it("literal settings shadows the package parameter, encoded SETTINGS remains a package name", async () => {
    for (const name of ["settings", "SETTINGS", "%73ettings", "%53ETTINGS"]) for (const method of ["GET", "HEAD"]) {
      const path = "/sap/bc/adt/packages/"+name;
      const expected = await wire(node,path,{method,headers:node.auth});
      served.length = 0;
      expect(await wire(ported,path,{method,headers:ported.auth})).to.deep.equal(expected);
      const encoded = name.startsWith("%");
      expect(expected.status).to.equal(encoded ? 404 : 200);
      expect(expected.headers["content-type"]).to.equal(encoded
        ? "application/xml; charset=utf-8"
        : "application/vnd.sap.adt.packages.settings+xml; charset=utf-8");
      if (method === "GET") expect(expected.body.toString()).to.include(encoded
        ? "SETTINGS does not exist" : 'pkcs:showPackageCheckErrors="false"');
      expect(served).to.deep.equal([`ABAP ${method} ${path.replace(/\?$/, "")}`]);
    }
  });
  for (const accept of ["*/*", "application/vnd.sap.adt.packages.v2+xml"])
    it(`12 subpackages package byte order ${accept}`, async () => {
      const res = await diff("/sap/bc/adt/packages/%24order", "GET", {accept});
      expect(res.status).to.equal(200);
      expect((res.body.toString().match(/<pak:packageRef /g) ?? []).length).to.equal(12);
    });
  for (const accept of ["*/*", "dataname=com.sap.adt.RepositoryObjectTreeContent"])
    it(`12 subpackages and 12 objects nodestructure byte order ${accept}`, async () => {
      const res = await diff("/sap/bc/adt/repository/nodestructure?parent_name=%24ORDER", "POST", {accept}, "");
      expect(res.status).to.equal(200);
      const xml = res.body.toString();
      expect((xml.match(/<OBJECT_NAME>\$ORDER_/g) ?? []).length).to.equal(12);
      expect((xml.match(/<OBJECT_NAME>ZT_ORDER_/g) ?? []).length).to.equal(12);
    });
  it("12 ancestor packages nodepath byte order", async () => {
    const res = await diff("/sap/bc/adt/repository/nodepath?uri=/sap/bc/adt/programs/programs/zt_deep", "POST", {}, "");
    expect(res.status).to.equal(200);
    expect((res.body.toString().match(/adtcore:name="\$ROOT_D/g) ?? []).length).to.equal(12);
  });
  it("absent PACKAGE or OBJECT in COMMANDS refuses each route with 501", async () => {
    for (const [command,path,method] of [["PACKAGE","/sap/bc/adt/packages/%24root","GET"],
      ["PACKAGE","/sap/bc/adt/repository/nodestructure?parent_name=%24ROOT","POST"],
      ["OBJECT","/sap/bc/adt/repository/nodepath?uri=/sap/bc/adt/oo/classes/zcl_tree","POST"]]) {
      const index = COMMANDS.indexOf(command);
      COMMANDS.splice(index,1);
      try { expect((await wire(ported,path,{method,headers:ported.auth})).status).to.equal(501); }
      finally { COMMANDS.splice(index,0,command); }
    }
  });
  const uri = "/sap/bc/adt/oo/classes/zcl_tree";
  const uris = [uri,uri+"/includes/testclasses",uri+"/source/main?x#y", "/sap/bc/adt/programs/programs/zt_prog", "/sap/bc/adt/programs/includes/zt_include", "/sap/bc/adt/ddic/ddl/sources/zt_ddl",
    "/sap/bc/adt/packages/%24root", "", "/sap/bc/adt/oo/classes/", "/sap/bc/adt/oo/classes/zcl_missing",uri+"%zz",uri+"%FF",uri.toUpperCase()];
  for (const value of uris) it(`nodepath ${value}`, async () => {
    const res = await diff("/sap/bc/adt/repository/nodepath?uri="+encodeURIComponent(value),"POST",{},"ignored");
    // Node strips /includes/... even inside the INCL collection, yielding its 400.
    const status = value.includes("%zz") || value.includes("%FF") || value.includes("packages/") || value.includes("/programs/includes/") || value === "" || value === value.toUpperCase() ? 400
      : value.endsWith("classes/") || value.includes("zcl_missing") ? 404 : 200;
    expect(res.status).to.equal(status);
  });
  for (const query of ["uri="+encodeURIComponent(uri)+"&uri="+encodeURIComponent(uri), "uri[x]="+encodeURIComponent(uri),"uri[0]="+encodeURIComponent(uri), "%75ri="+encodeURIComponent(uri)+"&uri="+encodeURIComponent(uri), "uri%5b0%5d="+encodeURIComponent(uri)])
    it(`nodepath scalar ${query}`, async () => { expect((await diff("/sap/bc/adt/repository/nodepath?"+query,"POST",{},"")).status).to.equal(400); });
  const queries = ["parent_type=DEVC", "", "parent_name=%24ROOT", "parentName=%24ROOT", "package=%24ROOT",
    "parent_name=&parentName=%24ROOT&parent_type=DEVC", "parent_name=%24ROOT&package=BAD", "parent_name=%24ROOT&parentName=BAD",
    "parent_name=%24ROOT&parent_type=&parentType=CLAS", "parent_name=ZCL_TREE&parentType=CLAS/OC", "parent_name=zcl_missing&parent_type=CLAS",
    "parent_name=ZNope", "parent_name=%24LIB", "parent_name=%2Fdemo%2Fpkg", "parent_name=%24TMP", "parent_name=%24TMP&user_name=",
    "parent_name=%24TMP&user_name=BUILDER_B", "parent_name=%24TMP_KID", "parent_name=%25zz", "parent_name=%24ROOT&parent_name=%24ZTA"];
  for (const query of queries) for (const accept of ["*/*", "dataname=com.sap.adt.RepositoryObjectTreeContent", "DATANAME=COM.SAP.ADT.REPOSITORYOBJECTTREECONTENT", "dataname=Custom.Tree"])
    it(`nodestructure ${query} ${accept}`, async () => { await diff("/sap/bc/adt/repository/nodestructure?"+query,"POST",{accept},"", "BUILDER_A"); });
  it("ordered roots, inactive versions, class includes and user views are real success fixtures", async () => {
    const flat = await diff("/sap/bc/adt/repository/nodestructure?parent_type=DEVC","POST",{},"");
    expect(flat.status).to.equal(200);
    const roots = flat.body.toString();
    expect(roots.indexOf("<OBJECT_NAME>$ZT_A</OBJECT_NAME>")).to.be.greaterThan(-1).and.lessThan(roots.indexOf("<OBJECT_NAME>$ZTA</OBJECT_NAME>"));
    expect(roots).not.to.include("<OBJECT_TYPES>");
    const mixed = await diff("/sap/bc/adt/repository/nodestructure?parent_name=%24ROOT","POST",{},"");
    expect(mixed.status).to.equal(200);
    expect(mixed.body.toString()).to.include("<VERSION>I</VERSION>").and.include("<OBJECT_NAME>ZCL_TREE</OBJECT_NAME>");
    const clas = await diff("/sap/bc/adt/repository/nodestructure?parent_name=ZCL_TREE&parent_type=CLAS","POST",{},"");
    expect(clas.status).to.equal(200);
    expect(clas.body.toString()).to.include("ZCL_TREE.main").and.include("ZCL_TREE.testclasses").and.include("ZCL_TREE.implementations");
    for (const user of ["BUILDER_A", "BUILDER_B"]) {
      const res = await diff("/sap/bc/adt/repository/nodestructure?parent_name=%24TMP","POST",{},"",user);
      expect(res.status).to.equal(200);
      expect(res.body.toString()).to.include(user === "BUILDER_A" ? "ZT_USER_A" : "ZT_USER_B");
      expect(res.body.toString()).not.to.include(user === "BUILDER_A" ? "ZT_USER_B" : "ZT_USER_A");
    }
  });
  it("invalid UTF-8 in a nodestructure body is a request error", async () => {
    expect((await diff("/sap/bc/adt/repository/nodestructure?parent_name=%24ROOT","POST",{},Buffer.from([0xff]))).status).to.equal(400);
  });
  for (const keys of [["000001"],["000002"],["000001","000002"],["000000"],["999999"],["000000","000002"]])
    it(`node keys ${keys}`, async () => {
      const body = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>${keys.map((k) => `<TV_NODEKEY>${k}</TV_NODEKEY>`).join("")}</DATA></asx:values></asx:abap>`;
      expect((await diff("/sap/bc/adt/repository/nodestructure?parent_name=%24ROOT","POST",{},body)).status).to.equal(200);
    });
});

describe("B5 PACKAGE destination envelope", () => {
  const call = async (destination,input) => {
    const signature = {exporting:{iv_command:box("PACKAGE"),iv_json:box(JSON.stringify(input))},
      importing:{ev_json:box("stale"),ev_error:box("stale")}};
    await destination.call("ZOSD_STORE",signature);
    return answerOf(signature);
  };
  for (const mode of ["raw","local"]) it(`${mode} binds store per request and preserves long names and order`, async () => {
    let opens = 0;
    const destination = new StoreDestination({store:() => { opens++; throw new Error("default must not open"); }});
    const bound = (marker) => ({
      package: (name) => ({name,description:marker,library:true, subpackages:["$ZT_A","$ZTA","/DEMO/LONG_PACKAGE_NAME_12345678901234567890"],
        objects:[{type:"PROG",name:marker,library:true,version:"inactive"}]}),
      packages: () => [{name:"$ZT_A",description:"First"},{name:"$ZTA",description:"Second"}],
    });
    const results = await Promise.all(["ONE","TWO"].map((marker) => withSystem(() => ({}),
      () => call(destination,{name:"$test",mode,user:"BUILDER_A"}), {store:bound(marker)})));
    expect(opens).to.equal(0);
    for (const [index,result] of results.entries()) {
      expect(result.EV_ERROR).to.equal("");
      const json = JSON.parse(result.EV_JSON);
      expect(json.name).to.equal("$TEST");
      expect(json.description).to.equal(["ONE","TWO"][index]);
      expect(json.subpackages.map((p) => p.name)).to.deep.equal(["$ZT_A","$ZTA","/DEMO/LONG_PACKAGE_NAME_12345678901234567890"]);
      expect(json.objects[0].version).to.equal("inactive");
    }
  });
  it("invalid modes return a typed error", async () => {
    const destination = new StoreDestination({store:{}});
    const result = await call(destination,{name:"$TEST",mode:"invalid"});
    expect(JSON.parse(result.EV_JSON).error.code).to.equal("INVALID_NAME");
  });
});
