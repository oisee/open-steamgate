import {expect} from "chai";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {build} from "../tools/osd-build.mjs";
import {transpile} from "../tools/osd-transpile.mjs";

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

  // N3: the transpile is a library call. The CLI is the oracle, run over the
  // same tree into a folder of its own, and the two outputs are compared
  // file by file. The transpiler numbers its temporaries as it goes, so
  // that counter is the one thing allowed to differ.
  it("transpiles through the library and writes what the CLI writes", async function () {
    this.timeout(120000);
    const CLASS = (name, method) => `CLASS ${name} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS ${method}.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\n  METHOD ${method}.\n  ENDMETHOD.\nENDCLASS.\n`;
    write("src/zcl_one.clas.abap", CLASS("zcl_one", "first"));
    write("src/zcl_one.clas.xml", "");
    write("src/zosd_report.prog.abap", "REPORT zosd_report.\nWRITE 'hi'.\n");
    write("local/used/zcl_two.clas.abap", CLASS("zcl_two", "second"));
    const config = {input_folder: ["src", "local/used"], output_folder: "output-cli", write_unit_tests: true, write_source_map: true,
                    options: {addFilenames: true, addCommonJS: true, unknownTypes: "compileError"}};
    writeFileSync(join(root, "abap_transpile.json"), JSON.stringify(config));
    execFileSync(join(root, "node_modules", ".bin", "abap_transpile"), [], {cwd: root, stdio: "pipe"});
    const made = await transpile({root, config: {...config, output_folder: "output-lib"}});
    expect(made.objects).to.equal(3);
    const list = (dir) => readdirSync(join(root, dir)).sort();
    expect(list("output-lib")).to.deep.equal(list("output-cli"));
    const norm = (dir, name) => readFileSync(join(root, dir, name), "utf8").replace(/unique\d+/g, "uniqueN");
    for (const name of list("output-cli")) {
      expect(norm("output-lib", name), name).to.equal(norm("output-cli", name));
    }
    // and the map names its source the way the CLI names it, relative to the output
    expect(readFileSync(join(root, "output-lib", "zcl_one.clas.mjs.map"), "utf8")).to.contain("../src/zcl_one.clas.abap");
  });
});
