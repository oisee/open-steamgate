import {expect} from "chai";
import {existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {build} from "../tools/osd-build.mjs";

// The builder over a tree of its own. What is cheap to check here is what
// it refuses before it does anything: a full generation takes the real
// transpiler and lives in test/osd-child.mjs and the workbench.
describe("tools/osd-build: the layers, refused before a lock is taken", function () {
  this.timeout(30000);
  let root;
  const write = (file, text = "") => {
    mkdirSync(join(root, file, ".."), {recursive: true});
    writeFileSync(join(root, file), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osd-build-"));
    // the config loader is the transpiler's own, resolved from the tree
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "local/used"], output_folder: "output"}));
  });

  afterEach(() => rmSync(root, {recursive: true, force: true}));

  it("refuses a name twice inside one input, naming both files, and builds nothing", async () => {
    write("src/a/zcl_two.clas.abap", "");
    write("src/b/zcl_two.clas.abap", "");
    let refused;
    try {
      await build({root});
    } catch (error) {
      refused = error;
    }
    expect(refused?.code).to.equal("DUPLICATE");
    expect(refused.message).to.contain("src/a/zcl_two.clas.abap, src/b/zcl_two.clas.abap");
    expect(refused.duplicates).to.deep.equal([{object: "CLAS ZCL_TWO", folder: "src", files: ["src/a/zcl_two.clas.abap", "src/b/zcl_two.clas.abap"]}]);
    // nothing was started: no lock, no tmp, no generation
    expect(existsSync(join(root, "build"))).to.equal(false);
  });
});
