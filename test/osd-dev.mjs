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
});
