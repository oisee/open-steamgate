// The dev loop: a change on disk becomes a check, a build and a recycle —
// or a report and nothing else. The build is injected, because the real
// one is ten seconds and this is about the rule, not the transpiler.
import {expect} from "chai";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ObjectStore} from "../tools/osd-store.mjs";
import {devLoop} from "../tools/osd-dev.mjs";

const CLEAN = (name) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS run.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n`;
const CALLER = (name, callee) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS go.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\n  METHOD go.\n    DATA lo TYPE REF TO ${callee}.\n    CREATE OBJECT lo.\n    lo->run( ).\n  ENDMETHOD.\nENDCLASS.\n`;

describe("tools/osd-dev: a save is a check, a build and a recycle", function () {
  this.timeout(60000);
  let root;
  let store;
  let published;
  let loop;
  const lines = [];

  before(() => {
    root = mkdtempSync(join(tmpdir(), "osd-dev-"));
    mkdirSync(join(root, "src", "osd"), {recursive: true});
    writeFileSync(join(root, "abaplint.jsonc"), JSON.stringify({syntax: {version: "v702", errorNamespace: "^(Z|Y)"}}));
    writeFileSync(join(root, "src/osd/zcl_dev_a.clas.abap"), CLEAN("zcl_dev_a"));
    writeFileSync(join(root, "src/osd/zcl_dev_b.clas.abap"), CALLER("zcl_dev_b", "zcl_dev_a"));
    store = new ObjectStore({root, libs: []});
    published = [];
    loop = devLoop({
      store,
      watch: false,
      log: (m) => lines.push(m),
      publish: async () => {
        published.push(Date.now());
        return {ok: true, transpile: {hash: "deadbeefdeadbeef", objects: 2, ms: 1, cached: false}, recycled: false};
      },
    });
  });
  after(() => {
    loop.stop();
    rmSync(root, {recursive: true, force: true});
  });

  it("a clean change is checked and then built", async () => {
    const r = await loop.touch("src/osd/zcl_dev_a.clas.abap");
    expect(r.ok).to.equal(true);
    expect(r.stage).to.equal("live");
    expect(published.length).to.equal(1);
    expect(lines.join("\n")).to.match(/check clean/).and.match(/built deadbeefdeadbeef/);
  });

  it("a change that breaks a dependent is reported and nothing is built", async () => {
    // a renames the method its caller uses; a itself is fine, b is not
    writeFileSync(join(root, "src/osd/zcl_dev_a.clas.abap"), CLEAN("zcl_dev_a").replace(/run/g, "walk"));
    store.index = undefined;
    store.parsed = undefined; // not watching, so the store is told the disk moved
    const before = published.length;
    const r = await loop.touch("src/osd/zcl_dev_a.clas.abap");
    expect(r.ok).to.equal(false);
    expect(r.stage).to.equal("check");
    expect(published.length, "no build after a failed check").to.equal(before);
    expect(r.broken.map((b) => b.name)).to.include("ZCL_DEV_B");
    expect(lines.join("\n")).to.match(/nothing built, the running system is untouched/);
  });

  it("a file that is not an object still triggers a pass, with nothing to check", async () => {
    writeFileSync(join(root, "src/osd/zcl_dev_a.clas.abap"), CLEAN("zcl_dev_a"));
    store.index = undefined;
    store.parsed = undefined;
    const before = published.length;
    const r = await loop.touch("src/osd/readme.txt");
    expect(r.ok).to.equal(true);
    expect(published.length).to.equal(before + 1);
  });

  // vsp-i7 on 0.6.1511 (OSD_WARM=1 STG_DEV=1): every create and every PUT
  // through the ADT façade was a cold build and a recycle of the dev loop's
  // own, besides the activation's -- 21 recycles, 1.52x the wall time, and
  // an activation that timed out behind them. A save is not an activation:
  // a file still holding its saved-inactive version is never built here,
  // and this is the store's persistent inactive set, not a record of the
  // write that a time, an event or a publish could end.
  describe("a saved, not activated version is never built by the dev loop", () => {
    const touched = async (file) => {
      store.index = undefined;
      store.parsed = undefined;
      return loop.touch(file);
    };
    const external = (file, text) => writeFileSync(join(root, file), text);

    before(() => {
      // a package the store can create into: a folder with its devc file
      mkdirSync(join(root, "src", "own"), {recursive: true});
      writeFileSync(join(root, "src/own/package.devc.xml"), "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<abapGit version=\"v1.0.0\" serializer=\"LCL_OBJECT_DEVC\" serializer_version=\"v1.0.0\">\n <asx:abap xmlns:asx=\"http://www.sap.com/abapxml\" version=\"1.0\">\n  <asx:values>\n   <DEVC>\n    <CTEXT>own</CTEXT>\n   </DEVC>\n  </asx:values>\n </asx:abap>\n</abapGit>\n");
      store.index = undefined;
    });

    it("a create and a save through the store build nothing", async () => {
      const before = published.length;
      const home = store.packages().find((p) => p.file === "src/own/package.devc.xml" || /OWN$/.test(p.name));
      const made = store.create("CLAS", "ZCL_DEV_OWN", {package: home.name});
      expect(await touched(made.file)).to.include({ok: true, stage: "inactive"});
      const saved = store.write("CLAS", "ZCL_DEV_OWN", CLEAN("zcl_dev_own"));
      expect(await touched(saved.file)).to.include({ok: true, stage: "inactive"});
      expect(published.length, "no build for a save").to.equal(before);
      expect(store.stateOf(store.find("CLAS", "ZCL_DEV_OWN")).version).to.equal("inactive");
      expect(lines.join("\n")).to.match(/saved and not activated; left to its activation/);
    });

    it("an identical external save of an inactive B is skipped, and B stays inactive", async () => {
      const saved = store.write("CLAS", "ZCL_DEV_A", CLEAN("zcl_dev_a") + "* b\n");
      external(saved.file, CLEAN("zcl_dev_a") + "* b\n");
      const before = published.length;
      expect(await touched(saved.file)).to.include({stage: "inactive"});
      expect(published.length).to.equal(before);
      expect(store.stateOf(store.find("CLAS", "ZCL_DEV_A")).version).to.equal("inactive");
    });

    it("a checkout to the same bytes is skipped", async () => {
      const saved = store.write("CLAS", "ZCL_DEV_A", CLEAN("zcl_dev_a") + "* co\n");
      // a checkout: away and back, both by somebody else, seen only at the end
      external(saved.file, CLEAN("zcl_dev_a") + "* elsewhere\n");
      external(saved.file, CLEAN("zcl_dev_a") + "* co\n");
      const before = published.length;
      expect(await touched(saved.file)).to.include({stage: "inactive"});
      expect(published.length).to.equal(before);
    });

    it("B, C, B: C is another editor's change and is built (and activated); B after it is a change too", async () => {
      const saved = store.write("CLAS", "ZCL_DEV_A", CLEAN("zcl_dev_a") + "* B\n");
      external(saved.file, CLEAN("zcl_dev_a") + "* C\n");
      const before = published.length;
      expect(await touched(saved.file)).to.include({ok: true, stage: "live"});
      expect(store.stateOf(store.find("CLAS", "ZCL_DEV_A")).version, "C activated").to.equal("active");
      external(saved.file, CLEAN("zcl_dev_a") + "* B\n");
      expect(await touched(saved.file)).to.include({ok: true, stage: "live"});
      expect(published.length).to.equal(before + 2);
    });

    it("a watcher event that comes late never activates a saved-only file", async () => {
      const saved = store.write("CLAS", "ZCL_DEV_A", CLEAN("zcl_dev_a") + "* late\n");
      await new Promise((r) => setTimeout(r, 2500));
      const before = published.length;
      expect(await touched(saved.file)).to.include({stage: "inactive"});
      expect(published.length).to.equal(before);
      expect(store.stateOf(store.find("CLAS", "ZCL_DEV_A")).version).to.equal("inactive");
    });

    it("a failed activation, then an identical save: still inactive, and the dev loop does not activate it", async () => {
      const saved = store.write("CLAS", "ZCL_DEV_A", CLEAN("zcl_dev_a") + "* failed\n");
      const transpile = store.transpile;
      store.transpile = async () => ({ok: false, error: "the activation failed"});
      try {
        expect(await store.publish({activate: [{type: "CLAS", name: "ZCL_DEV_A"}]})).to.include({ok: false});
      } finally {
        store.transpile = transpile;
      }
      external(saved.file, CLEAN("zcl_dev_a") + "* failed\n");
      const before = published.length;
      expect(await touched(saved.file)).to.include({stage: "inactive"});
      expect(published.length).to.equal(before);
      expect(store.stateOf(store.find("CLAS", "ZCL_DEV_A")).version).to.equal("inactive");
    });

    it("a burst with a saved file and another editor's file is a pass for the other file", async () => {
      const saved = store.write("CLAS", "ZCL_DEV_B", CALLER("zcl_dev_b", "zcl_dev_a"));
      external("src/osd/zcl_dev_a.clas.abap", CLEAN("zcl_dev_a"));
      const before = published.length;
      const [, r] = await Promise.all([loop.touch(saved.file), touched("src/osd/zcl_dev_a.clas.abap")]);
      expect(r).to.include({ok: true, stage: "live"});
      expect(published.length).to.equal(before + 1);
      expect(lines.slice(-3).join("\n")).to.match(/^1 file changed: CLAS ZCL_DEV_A\n/);
    });
  });
});
