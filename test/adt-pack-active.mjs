// Real builds from external inputs: the VSIX globalStorage pack is outside OSD_ROOT.
import {expect} from "chai";
import express from "express";
import {createRequire} from "node:module";
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {build} from "../tools/osd-build.mjs";
import {WarmCompiler} from "../tools/osd-warm.mjs";
import {materializeSourceSnapshot, sourceSnapshotPath, sourceOriginalPath} from "../tools/osd-source-snapshot.mjs";
import {adtRouter} from "../tools/adt-facade.mjs";
import {adtAbap} from "./helpers/adt-abap.mjs";
import {runtimeRootFixture} from "./helpers/runtime-root.mjs";
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
