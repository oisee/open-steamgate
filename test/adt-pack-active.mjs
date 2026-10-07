// Real builds from external inputs: the VSIX globalStorage pack is outside OSD_ROOT.
import {expect} from "chai";
import express from "express";
import {createRequire} from "node:module";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, lstatSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter, join, relative, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {build, gc} from "../tools/osd-build.mjs";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {materializeSourceSnapshot, sourceSnapshotPath, sourceOriginalPath} from "../tools/osd-source-snapshot.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {copyRuntimeRoot, runtimeRootFixture} from "./helpers/runtime-root.mjs";
import {ServingRuntime} from "../tools/osd-runtime.mjs";
import {StoreDestination} from "../tools/osd-store-destination.mjs";
import {abapRunner} from "../tools/adt-abap-front.mjs";
const {Osd} = createRequire(import.meta.url)("../editors/vscode/lib.js");
const REPO = resolve(".");
const source = (name, value) => `CLASS ${name} DEFINITION PUBLIC. PUBLIC SECTION. CLASS-METHODS run RETURNING VALUE(rv) TYPE string. ENDCLASS.
CLASS ${name} IMPLEMENTATION. METHOD run. rv = '${value}'. ENDMETHOD. ENDCLASS.
`;
describe("source snapshot keys", () => {
  it("round-trips external, Windows and reserved paths inside the snapshot directory", () => {
    for (const key of ["../globalStorage/src/zcl_live.clas.abap", "../../outside/%2E/src/zcl_live.clas.abap",
      "/foreign/src/zcl_live.clas.abap", "D:/workspace/src/zcl_live.clas.abap", ".external/outside/src/zcl_live.clas.abap", "src/zcl_live.clas.abap"]) {
      const stored = sourceSnapshotPath(key);
      expect(stored.split("/")).not.to.include("..");
      expect(sourceOriginalPath(stored)).to.equal(key);
    }
  });
});
const runtimeFixture = runtimeRootFixture();
for (const location of ["in-root pack", "external pack", "workspace layer"]) for (const front of ["node", "abap"]) {
  describe(`ADT active source: ${location}, ${front} front`, function () {
    this.timeout(180000);
    let scratch, root, input, store, server, url, warm, runtime, hash, priorPacks;
    const name = "ZCL_PACK_LIVE", other = "ZCL_PACK_OTHER";
    const object = {type: "CLAS", name, base: name.toLowerCase()};
    const mainFile = () => join(input, "src/zcl_pack_live.clas.abap");
    const generation = () => join(root, "build/by-input", hash);
    before(async () => {
      if (front === "abap") expect(process.env.OSD_ADT, "ABAP source tests require the ABAP front; OSD_ADT=js would test Node twice").not.to.equal("js");
      priorPacks = process.env.OSD_PACKS;
      scratch = mkdtempSync(join(tmpdir(), "adt-pack-active-"));
      root = join(scratch, "system");
      input = location === "in-root pack" ? join(root, "packs", "fixture") : join(scratch, "globalStorage", "workspace");
      mkdirSync(join(root, "src"), {recursive: true});
      mkdirSync(join(input, "src"), {recursive: true});
      writeFileSync(mainFile(), source(name, "P1"));
      writeFileSync(join(input, "src/zcl_pack_other.clas.abap"), source(other, "unchanged"));
      writeFileSync(join(input, "src/zcl_pack_live.clas.testclasses.abap"), "* active tests\n");
      writeFileSync(join(input, "src/zcl_pack_live.clas.macros.abap"), "");
      // Neither an unrelated file nor an unrelated foreign tree is a source snapshot.
      writeFileSync(join(input, "private.txt"), "unrelated foreign bytes");
      const config = {input_folder: ["src"], output_folder: "output", libs: [],
        options: {ignoreSyntaxCheck: false, addCommonJS: true, unknownTypes: "compileError"}};
      if (location === "workspace layer") config.input_folder.push(relative(root, join(input, "src")));
      else writeFileSync(join(input, "osd-pack.json"), JSON.stringify({name: "fixture", abap: ["src"]}));
      if (location === "external pack") process.env.OSD_PACKS = input;
      else delete process.env.OSD_PACKS;
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify(config));
      writeFileSync(join(root, "package.json"), "{}");
      symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
      ({hash} = await build({root, generators: false}));
      store = new ObjectStore({root, libs: []});
      let runner;
      if (front === "abap") {
        if (process.env.OSD_ADT_ONE_RUNTIME === "1") {
          runtime = new ServingRuntime({root: runtimeFixture.root, watch: false, stdio: "pipe",
            env: {OSD_ADT_ONE_RUNTIME: "1", OSD_PACKS: "", STG_DB: "sqlite", STG_DB_PATH: "", STG_TLS: "0"}});
          runtime.storeDestination = new StoreDestination({store});
          await runtime.start();
          runner = abapRunner({remote: runtime});
        } else runner = await adtAbap();
      }
      const app = express();
      app.use(adtRouter({store, watch: false, logMisses: false, abap: runner}).router);
      server = await new Promise(done => {const s = app.listen(0, "127.0.0.1", () => done(s));});
      url = `http://127.0.0.1:${server.address().port}`;
    });
    after(async () => {
      await warm?.close();
      if (server) await new Promise(done => server.close(done));
      await runtime?.stop();
      if (priorPacks === undefined) delete process.env.OSD_PACKS; else process.env.OSD_PACKS = priorPacks;
      if (scratch) rmSync(scratch, {recursive: true, force: true});
    });
    const active = async (include = "main", status = 200) => {
      const suffix = include === "main" ? "source/main" : `includes/${include}/source/main`;
      const response = await fetch(`${url}/sap/bc/adt/oo/classes/${object.base}/${suffix}?version=active`);
      if (front === "abap") expect(response.headers.get("x-osd-served-by"), suffix).to.equal("ABAP");
      expect(response.status).to.equal(status);
      return response.text();
    };
    it("cold build proves pack/layer source and the VS Code activeSource read", async () => {
      expect(await active()).to.equal(source(name, "P1"));
      expect(await new Osd(url).activeSource(object)).to.equal(source(name, "P1"));
      const inputs = JSON.parse(readFileSync(join(generation(), "source-inputs.json"), "utf8"));
      expect(inputs[relative(root, mainFile()).replaceAll("\\", "/")]).to.match(/^[a-f0-9]{64}$/);
      expect(Object.keys(inputs).some(p => p.endsWith("private.txt"))).to.equal(false);
      expect(store.stateOf(store.find("CLAS", name)).version).to.equal("active");
      expect(await (await fetch(`${url}/sap/bc/adt/oo/classes/${object.base}/source/main/versions/19700101000000/00000/content`)).text())
        .to.equal(source(name, "P1"));
    });
    it("cache hits repair snapshots omitted by older builders", async () => {
      const record = join(generation(), "source-inputs.json");
      writeFileSync(record, "{}");
      rmSync(join(generation(), "source"), {recursive: true, force: true});
      mkdirSync(join(generation(), "source"));
      writeFileSync(join(generation(), "source/.complete"), "1\n");
      const cached = await build({root, generators: false});
      expect(cached.cached).to.equal(true);
      expect(new ObjectStore({root, libs: []}).read("CLAS", name, "main", "active").source).to.equal(source(name, "P1"));
    });
    it("retained nonempty and empty active includes survive removed working files", async () => {
      for (const [include, suffix, expected] of [["testclasses", "testclasses", "* active tests\n"], ["macros", "macros", ""]]) {
        rmSync(join(input, `src/zcl_pack_live.clas.${suffix}.abap`));
        expect(await active(include)).to.equal(expected);
        expect(store.read("CLAS", name, include, "active").empty).to.equal(false);
        expect(await new Osd(url).activeSource(object, include)).to.equal(expected);
      }
    });
    it("pre-save copies stay in build and a warm promotion retains external proof", async () => {
      // Restore the includes before priming the exact cold view.
      writeFileSync(join(input, "src/zcl_pack_live.clas.testclasses.abap"), "* active tests\n");
      writeFileSync(join(input, "src/zcl_pack_live.clas.macros.abap"), "");
      store.write("CLAS", name, source(name, "P2"));
      expect(await active()).to.equal(source(name, "P1"));
      const reopened = new ObjectStore({root, libs: []});
      expect(reopened.read("CLAS", name, "main", "active").source).to.equal(source(name, "P1"));
      expect(reopened.overlay()).to.deep.equal(store.overlay());
      expect(existsSync(join(root, "build/inactive/active"))).to.equal(true);
      warm = new WarmCompiler({root, overlay: keys => store.overlay(keys), keyOf: file => store.objectKeyOf(file),
        inactiveSources: keys => store.inactiveSources(keys)});
      await warm.prime();
      const built = await warm.build(new Set([`CLAS ${name}`]));
      expect(built.ok).to.equal(true);
      hash = built.hash;
      store.served = {running: true, generation: hash};
      expect(await active()).to.equal(source(name, "P2"));
      expect(store.read("CLAS", other, "main", "active").source).to.equal(source(other, "unchanged"));
      const key = relative(root, mainFile()).replaceAll("\\", "/");
      const retained = join(generation(), "source", sourceSnapshotPath(key));
      materializeSourceSnapshot(root, generation());
      expect(readFileSync(retained, "utf8")).to.equal(source(name, "P2"));
      expect(relative(join(generation(), "source"), retained).startsWith("..")).to.equal(false);
      // Every retained file stays beneath the generation or the inactive folder.
      expect(existsSync(join(root, "build/by-input/globalStorage"))).to.equal(false);
    });
    it("unknown active source is a precise ADT 404 and remains readable as working source", async () => {
      await warm.close(); warm = undefined;
      rmSync(join(root, "build"), {recursive: true, force: true});
      expect(await active("main", 404)).to.include(`${name} active version (main) does not exist`);
      expect(store.read("CLAS", name).source).to.equal(source(name, "P2"));
      expect(store.read("CLAS", name, "testclasses", "active").empty).to.equal(true);
      expect(await active("testclasses", 404)).to.equal("No suitable resource found");
      const missingInclude = await fetch(`${url}/sap/bc/adt/oo/classes/${object.base}/includes/testclasses?version=active`);
      expect(missingInclude.status).to.equal(404);
      const body = await missingInclude.text();
      expect(body).to.include("ExceptionResourceNotFound");
      expect(body).to.include("ED").and.to.include("170");
      const history = await fetch(`${url}/sap/bc/adt/oo/classes/${object.base}/source/main/versions`);
      expect(history.status).to.equal(200);
      const unknown = await fetch(`${url}/sap/bc/adt/oo/classes/${object.base}/source/main/versions/19700101000000/00000/content`);
      expect(unknown.status).to.equal(404);
      expect(await unknown.text()).to.include("active version (main)");
    });
  });
}

describe("external generator inputs", function () {
  this.timeout(180000);
  let root, scratch, priorPacks;
  after(async () => {
    if (priorPacks === undefined) delete process.env.OSD_PACKS; else process.env.OSD_PACKS = priorPacks;
    if (root) rmSync(root, {recursive: true, force: true});
    if (scratch) rmSync(scratch, {recursive: true, force: true});
  });
  it("keeps an inactive external CDS's ACTIVE generated objects during an unrelated cold activation", async () => {
    priorPacks = process.env.OSD_PACKS;
    root = copyRuntimeRoot();
    scratch = mkdtempSync(join(tmpdir(), "external-cds-"));
    const input = join(scratch, "pack");
    mkdirSync(join(input, "src"), {recursive: true});
    writeFileSync(join(input, "osd-pack.json"), JSON.stringify({name: "external-cds", abap: ["src"]}));
    const cds = field => `@AbapCatalog.sqlViewName: 'ZVEXTPACK'\n@EndUserText.label: 'External pack'\n` +
      `define view ZC_EXT_PACK as select from zstg_demo { key travel_id as TravelId, description as ${field} }\n`;
    const original = cds("ActiveDescription");
    writeFileSync(join(input, "src/zc_ext_pack.ddls.asddls"), original);
    process.env.OSD_PACKS = input;
    await build({root});
    const generated = ["gen/cds/zvextpack.view.xml", "gen/cds/zc_ext_pack.view.xml", "gen/cds/zcl_stg_cds_zvextpack.clas.abap"];
    const before = generated.map(file => readFileSync(join(root, file), "utf8"));
    const store = new ObjectStore({root});
    store.write("DDLS", "ZC_EXT_PACK", cds("InactiveDescription"));
    const metadata = readFileSync(join(root, "build/inactive/inactive.json"), "utf8");
    store.write("CLAS", "ZCL_ZSTG_DEMO_DPC_EXT", store.read("CLAS", "ZCL_ZSTG_DEMO_DPC_EXT").source + "\n* unrelated activation\n");
    const activation = store.activate("CLAS", "ZCL_ZSTG_DEMO_DPC_EXT");
    expect(activation.active).to.equal(true);
    const built = await store.transpile({force: true, activating: new Set(["CLAS ZCL_ZSTG_DEMO_DPC_EXT"])});
    expect(built.ok, built.output).to.equal(true);
    expect(built.warm).not.to.equal(true);
    expect(store.completeActivation(activation, built.built)).to.equal(true);
    expect(generated.map(file => readFileSync(join(root, file), "utf8"))).to.deep.equal(before);
    expect(readFileSync(join(root, "gen/cds/zcl_stg_cds_registry.clas.abap"), "utf8"))
      .to.include("ZC_EXT_PACK").and.include("ACTIVEDESCRIPTION").and.not.include("INACTIVEDESCRIPTION");
    expect(existsSync(join(root, "output/zcl_stg_cds_zvextpack.clas.mjs"))).to.equal(true);
    const reopened = new ObjectStore({root});
    expect(reopened.read("DDLS", "ZC_EXT_PACK", "main", "active").source).to.equal(original);
    expect(reopened.stateOf(reopened.find("DDLS", "ZC_EXT_PACK")).version).to.equal("inactive");
    expect(JSON.parse(readFileSync(join(root, "build/inactive/inactive.json"), "utf8")).inactive["DDLS ZC_EXT_PACK"])
      .to.deep.equal(JSON.parse(metadata).inactive["DDLS ZC_EXT_PACK"]);
  });
});

describe("external snapshot retention", function () {
  this.timeout(120000);
  it("distinguishes matching pack paths, copies source symlink bytes and collects only unreferenced external digests", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "external-snapshots-"));
    const root = join(scratch, "system"), priorPacks = process.env.OSD_PACKS;
    try {
      mkdirSync(join(root, "src"), {recursive: true});
      const packs = [join(scratch, "first"), join(scratch, "second")];
      for (const [i, pack] of packs.entries()) {
        mkdirSync(join(pack, "src"), {recursive: true});
        writeFileSync(join(pack, "osd-pack.json"), JSON.stringify({name: `external-${i}`, order: i, abap: ["src"]}));
      }
      const filename = "src/zcl_pack_live.clas.abap", target = join(scratch, "linked-source");
      writeFileSync(join(packs[0], filename), source("ZCL_PACK_LIVE", "first"));
      writeFileSync(target, source("ZCL_PACK_LIVE", "second"));
      symlinkSync(target, join(packs[1], filename));
      process.env.OSD_PACKS = packs.join(delimiter);
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src"], libs: [], options: {addCommonJS: true}}));
      writeFileSync(join(root, "package.json"), "{}");
      symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
      const first = await build({root, generators: false});
      const generation = join(root, "build/by-input", first.hash);
      const inputs = JSON.parse(readFileSync(join(generation, "source-inputs.json"), "utf8"));
      const keys = packs.map(pack => relative(root, join(pack, filename)).replaceAll("\\", "/"));
      expect(keys[0]).not.to.equal(keys[1]);
      expect(inputs[keys[0]]).to.match(/^[a-f0-9]{64}$/).and.not.to.equal(inputs[keys[1]]);
      for (const [i, key] of keys.entries()) {
        const retained = join(generation, "source", sourceSnapshotPath(key));
        expect(lstatSync(retained).isSymbolicLink()).to.equal(false);
        expect(readFileSync(retained, "utf8")).to.equal(source("ZCL_PACK_LIVE", i === 0 ? "first" : "second"));
      }
      writeFileSync(target, source("ZCL_PACK_LIVE", "third"));
      expect(readFileSync(join(generation, "source", sourceSnapshotPath(keys[1])), "utf8")).to.equal(source("ZCL_PACK_LIVE", "second"));
      const second = await build({root, generators: false});
      const latest = JSON.parse(readFileSync(join(root, "build/by-input", second.hash, "source-inputs.json"), "utf8"));
      expect(gc(root, {keep: 0})).to.include(first.hash).and.not.include(second.hash);
      expect(existsSync(join(root, "build/source-by-digest", inputs[keys[1]]))).to.equal(false);
      for (const key of keys) expect(existsSync(join(root, "build/source-by-digest", latest[key]))).to.equal(true);
      materializeSourceSnapshot(root, join(root, "build/by-input", second.hash));
      expect(new ObjectStore({root, libs: []}).read("CLAS", "ZCL_PACK_LIVE", "main", "active").source).to.equal(source("ZCL_PACK_LIVE", "third"));
    } finally {
      if (priorPacks === undefined) delete process.env.OSD_PACKS; else process.env.OSD_PACKS = priorPacks;
      rmSync(scratch, {recursive: true, force: true});
    }
  });
});
