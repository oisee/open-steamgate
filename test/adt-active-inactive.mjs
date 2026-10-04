import {once} from "node:events";
import {expect} from "chai";
import express from "express";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import {ObjectStore} from "../tools/osd-store.mjs";
import {build, liveHash} from "../tools/osd-build.mjs";
import {HotLoader} from "../tools/osd-hot.mjs";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";

const REPO = resolve(".");
const main = `CLASS zcl_t05 DEFINITION PUBLIC. PUBLIC SECTION.
CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
INTERFACES if_oo_adt_classrun.
ENDCLASS.
CLASS zcl_t05 IMPLEMENTATION. METHOD run.
rv = lcl_value=>get( ).
ENDMETHOD.
METHOD if_oo_adt_classrun~main. out->write( run( ) ). ENDMETHOD.
ENDCLASS.\n`;
const def = 'CLASS lcl_value DEFINITION. PUBLIC SECTION. CLASS-METHODS get RETURNING VALUE(rv) TYPE string. ENDCLASS.\n';
const imp = value => `CLASS lcl_value IMPLEMENTATION. METHOD get. rv = '${value}'. ENDMETHOD. ENDCLASS.\n`;
const prog = value => `REPORT zt05.\n\nWRITE '${value}'.\n`;

for (const front of ["node", "abap"]) describe(`ADT active/inactive: ${front} source routes`, function () {
  this.timeout(180000);
  let root, store, server, base, headers, hot, warm, savedClasses;
  before(async () => {
    await import("./start.mjs");
    savedClasses = Object.fromEntries(["CX_ROOT", "IF_OO_ADT_CLASSRUN", "IF_OO_ADT_CLASSRUN_OUT"].map(name => [name, abap.Classes[name]]));
    root = realpathSync(mkdtempSync(join(tmpdir(), "adt-t05-")));
    mkdirSync(join(root, "src"));
    const files = {"zt05.prog.abap": prog("stub"), "zcl_t05.clas.abap": main,
      "zcl_t05.clas.locals_def.abap": def, "zcl_t05.clas.locals_imp.abap": imp("stub"),
      // The compiler emits this import for reports even in a minimal tree.
      "if_oo_adt_classrun.intf.abap": "INTERFACE if_oo_adt_classrun PUBLIC. METHODS main IMPORTING out TYPE REF TO if_oo_adt_classrun_out. ENDINTERFACE.\n",
      "if_oo_adt_classrun_out.intf.abap": "INTERFACE if_oo_adt_classrun_out PUBLIC. METHODS write IMPORTING data TYPE any RETURNING VALUE(output) TYPE REF TO if_oo_adt_classrun_out. ENDINTERFACE.\n",
      "cx_root.clas.abap": "CLASS cx_root DEFINITION PUBLIC. ENDCLASS. CLASS cx_root IMPLEMENTATION. ENDCLASS.\n"};
    for (const [file, source] of Object.entries(files)) writeFileSync(join(root, "src", file), source);
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
    writeFileSync(join(root, "package.json"), '{}');
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({global: {files: "/src/**/*.*"}, syntax: {version: "v702"}, rules: {check_syntax: true}}));
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src", libs: [], output_folder: "output",
      options: {ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true, unknownTypes: "compileError"}, write_source_map: true}));
    await build({root, generators: false});
    store = new ObjectStore({root, libs: [], build: {generators: false}});
    const app = express(); app.use(express.raw({type: "*/*"}));
    app.use(adtRouter({store, watch: false, transpileOnActivate: true, abap: front === "abap" ? await adtAbap() : undefined}).router);
    server = await new Promise(resolve => {const s = app.listen(0, () => resolve(s));});
    base = `http://localhost:${server.address().port}/sap/bc/adt`;
    const hello = await fetch(base + "/core/discovery", {method: "HEAD", headers: {"x-csrf-token": "fetch"}});
    headers = {"x-sap-adt-sessiontype": "stateful", "x-csrf-token": hello.headers.get("x-csrf-token"), cookie: hello.headers.getSetCookie().map(c => c.split(";")[0]).join("; ")};
  });
  after(async () => {
    if (store?.warmState) {store.warmState.next = undefined; store.warmState.on = false;}
    const verifying = warm?.verifying;
    if (verifying && verifying.exitCode === null) {warm.cancelVerify(undefined, "test complete"); await once(verifying, "exit");}
    await store?.warmState?.verifying;
    warm?.drop();
    Object.assign(abap.Classes, savedClasses); clearTimeout(store?.warmState?.timer); clearTimeout(store?.warmState?.reprime);
    if (server) await new Promise(resolve => server.close(resolve));
    rmSync(root, {recursive: true, force: true});
  });
  const classrun = async () => {
    const out = await new abap.Classes.ZCL_OSD_CLASSRUN_OUT().constructor_();
    const instance = await new abap.Classes.ZCL_T05().constructor_();
    await instance.if_oo_adt_classrun$main({out});
    return (await out.text()).get();
  };
  const activate = async (object, method = "activate") => {
    const res = await fetch(base + "/activation?method=" + method, {method: "POST", headers: {...headers, "content-type": "application/xml"},
      body: `<adtcore:objectReference xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="/sap/bc/adt${object}"/>`});
    expect(res.status).to.equal(200); return await res.text();
  };
  const save = async (object, sourcePath, source) => {
    const lock = await fetch(base + object + "?_action=LOCK&accessMode=MODIFY", {method: "POST", headers});
    const xml = await lock.text(); const handle = /<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/.exec(xml)?.[1];
    expect(handle, xml).to.be.a("string");
    try {
      const saved = await fetch(base + sourcePath + "?lockHandle=" + encodeURIComponent(handle), {method: "PUT", headers, body: source});
      expect(saved.status, await saved.text()).to.equal(200);
    } finally {await fetch(base + object + "?_action=UNLOCK&lockHandle=" + encodeURIComponent(handle), {method: "POST", headers});}
  };
  const versions = async (object, path, active, inactive, state) => {
    const tags = {};
    for (const version of ["", "active", "inactive"]) {
      const res = await fetch(base + path + (version ? "?version=" + version : ""), {headers});
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal(version === "active" ? active : inactive);
      tags[version] = res.headers.get("etag");
    }
    expect(tags.active).to.not.equal(tags.inactive); expect(tags['']).to.equal(tags.inactive);
    const conditional = await fetch(base + path + "?version=active", {headers: {...headers, "if-none-match": tags.inactive}});
    expect(conditional.status).to.equal(200);
    const cached = await fetch(base + path + "?version=active", {headers: {...headers, "if-none-match": tags.active}});
    expect(cached.status).to.equal(304);
    const doc = await fetch(base + object, {headers});
    expect(await doc.text()).to.include(`adtcore:version="${state}"`);
    const feed = await fetch(base + (path.includes("/includes/") ? path.replace(/\/source\/main$/, "") : path) + "/versions", {headers});
    const uri = /src="([^"]+\/00000\/content)"/.exec(await feed.text())?.[1];
    expect(uri).to.be.a("string");
    expect(await (await fetch(new URL(uri, base), {headers})).text()).to.equal(active);
  };
  it("program: stub → save P1 → activate → invalid P2 → failed/unknown activation → P3, cold builds", async () => {
    const object = "/programs/programs/zt05", path = object + "/source/main";
    await save(object, path, prog("P1"));
    await versions(object, path, prog("stub"), prog("P1"), "inactive");
    expect(await activate(object)).to.include('activationExecuted="true"');
    await versions(object, path, prog("P1"), prog("P1"), "active");
    const p2 = "REPORT zt05.\n\nTHIS is invalid.\n";
    await save(object, path, p2);
    await versions(object, path, prog("P1"), p2, "inactive");
    const before = liveHash(root);
    expect(await activate(object)).to.include('activationExecuted="false"');
    await versions(object, path, prog("P1"), p2, "inactive");
    expect(await activate(object, "unknown")).to.equal("");
    await versions(object, path, prog("P1"), p2, "inactive");
    expect(liveHash(root)).to.equal(before);
    // A cold rebuild with the inactive overlay still runs P1.
    await build({root, generators: false, overlay: store.overlay(), force: true});
    await versions(object, path, prog("P1"), p2, "inactive");
    const code = `import {ABAP} from '@abaplint/runtime'; globalThis.abap = new ABAP(); await import(${JSON.stringify(pathToFileURL(join(root, "output", "zt05.prog.mjs")).href)}); process.stdout.write(abap.console.get());`;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", code], {cwd: root, encoding: "utf8"})).to.equal("P1");
    await save(object, path, prog("P3"));
    expect(await activate(object)).to.include('activationExecuted="true"');
    await versions(object, path, prog("P3"), prog("P3"), "active");
  });
  it("class include: the same sequence with a real warm swap; failed activation still executes P1", async () => {
    const object = "/oo/classes/zcl_t05", path = object + "/includes/implementations/source/main";
    await import(pathToFileURL(join(root, "output", "zcl_t05.clas.mjs")).href);
    hot = new HotLoader(root);
    warm = new WarmCompiler({root, overlay: activating => store.overlay(activating),
      keyOf: file => store.objectKeyOf(file), inactiveSources: activating => store.inactiveSources(activating)});
    await warm.prime();
    store.warmState = {on: true, compiler: warm};
    store.served = {running: true, generation: hot.generation, epoch: 1,
      hot: async msg => {const r = await hot.swap(msg); store.served.generation = hot.generation; return r;},
      recycle: async () => {throw new Error("this class edit must swap warm");}};
    await save(object, path, imp("P1"));
    await versions(object, path, imp("stub"), imp("P1"), "inactive");
    expect(await activate(object)).to.include('activationExecuted="true"');
    expect(hot.swaps).to.equal(1);
    await versions(object, path, imp("P1"), imp("P1"), "active");
    const p2 = imp("P2").replace("rv = 'P2'.", "THIS is invalid.");
    await save(object, path, p2);
    await versions(object, path, imp("P1"), p2, "inactive");
    const before = hot.generation;
    expect(await activate(object)).to.include('activationExecuted="false"');
    await versions(object, path, imp("P1"), p2, "inactive");
    expect(await activate(object, "unknown")).to.equal("");
    await versions(object, path, imp("P1"), p2, "inactive");
    expect(hot.generation).to.equal(before); expect(hot.swaps).to.equal(1);
    expect(await classrun()).to.equal("P1");
    await save(object, path, imp("P3"));
    expect(await activate(object)).to.include('activationExecuted="true"');
    expect(hot.swaps).to.equal(2);
    await versions(object, path, imp("P3"), imp("P3"), "active");
    expect(await classrun()).to.equal("P3");
  });
});

// All source-bearing types share the generation snapshot selector. Keep the
// compiled tree small: these additional resources need no executable module.
describe("ADT source selector: every source type", () => {
  let root, store;
  const fixtures = {
    CLAS: ["zcl_all.clas.abap", "CLASS zcl_all DEFINITION PUBLIC. ENDCLASS. CLASS zcl_all IMPLEMENTATION. ENDCLASS.\n"],
    INTF: ["zif_all.intf.abap", "INTERFACE zif_all PUBLIC. ENDINTERFACE.\n"],
    PROG: ["zall.prog.abap", "REPORT zall. WRITE 'active'.\n"],
    INCL: ["zinc.prog.abap", "FORM run. WRITE 'active'. ENDFORM.\n"],
    DDLS: ["zddl.ddls.asddls", "define view entity ZAll as select from ztable { key id }\n"],
    SRVD: ["zsrv.srvd.srvdsrv", "define service ZAll { expose ZAll; }\n"],
  };
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "adt-all-sources-")); mkdirSync(join(root, "src"));
    for (const [file, source] of Object.values(fixtures)) writeFileSync(join(root, "src", file), source);
    writeFileSync(join(root, "src", "zinc.prog.xml"), '<abapGit><PROGDIR><SUBC>I</SUBC></PROGDIR></abapGit>');
    const {keepSourceInputs, completeSourceSnapshot} = await import("../tools/osd-source-snapshot.mjs");
    const {createHash} = await import("node:crypto");
    const digests = new Map(Object.values(fixtures).map(([file, source]) => [join(root, "src", file), createHash("sha256").update(source).digest("hex")]));
    const generation = join(root, "build", "by-input", "fixture");
    keepSourceInputs(root, generation, digests);
    completeSourceSnapshot(generation);
    symlinkSync(join("by-input", "fixture"), join(root, "build", "live"));
    store = new ObjectStore({root, libs: [], roots: [{path: "src", writable: true}]});
    store.served = {running: false, generation: "a-stopped-runtime"};
  });
  after(() => rmSync(root, {recursive: true, force: true}));
  for (const [type, [file, source]] of Object.entries(fixtures)) it(`${type}: saved/default and active bytes, validators, restart, and equal-source state`, () => {
    const name = file.split('.')[0].toUpperCase();
    expect(store.read(type, name, "main", "active").source).to.equal(source);
    // A checkout/editor may change a file before STORE sees a save. The
    // active source must still come from the generation, never that file.
    writeFileSync(join(root, "src", file), source + "\n");
    store.write(type, name, source + "\n\n");
    for (const reader of [store, new ObjectStore({root, libs: [], roots: [{path: "src", writable: true}]})]) {
      expect(reader.read(type, name).source).to.equal(source + "\n\n");
      expect(reader.read(type, name, "main", "inactive").source).to.equal(source + "\n\n");
      expect(reader.read(type, name, "main", "active").source).to.equal(source);
      expect(reader.stateOf(reader.find(type, name)).version).to.equal("inactive");
    }
    store.write(type, name, source);
    expect(store.stateOf(store.find(type, name)).version).to.equal("active");
    expect(store.read(type, name, "main", "active").etag).not.to.equal(store.read(type, name).etag);
  });
});
