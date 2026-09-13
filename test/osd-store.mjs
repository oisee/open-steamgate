import {expect} from "chai";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NotFound, ObjectStore, ReadOnly, fileOf, nameOf} from "../tools/osd-store.mjs";

// The object store behind the ADT façade: what a client reads, writes,
// checks and activates when it talks to OSD. The repository itself is the
// content, and the open-abap clones beside it are the standard objects, so
// the store is tested against what is actually on disk.
describe("tools/osd-store: the objects of the local system", function () {
  // a check parses the whole system, and the system grows when a repository
  // is imported into local/
  this.timeout(120000);
  const store = new ObjectStore();

  it("indexes this repository and the libraries beside it", () => {
    const all = store.list();
    expect(all.length).to.be.greaterThan(500);
    const types = new Set(all.map((o) => o.type));
    for (const type of ["CLAS", "INTF", "TABL", "DTEL", "DDLS"]) {
      expect(types, type).to.include(type);
    }
    // ours is writable, a library's is not
    expect(store.find("CLAS", "ZCL_STG_SEGW_EXPORT")).to.include({writable: true, library: false});
    expect(store.find("CLAS", "CL_ABAP_ZIP")).to.include({writable: false, library: true});
  });

  it("reads the source of a class, ours and the library's", () => {
    expect(store.read("CLAS", "ZCL_STG_SEGW_EXPORT").source).to.contain("CLASS zcl_stg_segw_export DEFINITION");
    expect(store.read("CLAS", "CL_ABAP_ZIP").source).to.contain("CLASS cl_abap_zip DEFINITION");
    // the name arrives in any case
    expect(store.read("CLAS", "zcl_stg_segw_export").source).to.contain("zcl_stg_segw_export");
  });

  it("reads the includes of a class, and an absent one is empty rather than an error", () => {
    const tests = store.read("CLAS", "ZCL_STG_SEGW_TEST", "testclasses");
    expect(tests.source).to.contain("CLASS ltcl_");
    const macros = store.read("CLAS", "ZCL_STG_SEGW_EXPORT", "macros");
    expect(macros).to.include({empty: true});
    expect(macros.source).to.equal("");
  });

  it("an object that is not there says so, by type and name", () => {
    expect(() => store.read("CLAS", "ZCL_NOBODY_HOME")).to.throw(NotFound, "CLAS ZCL_NOBODY_HOME does not exist");
    expect(store.exists("CLAS", "ZCL_NOBODY_HOME")).to.equal(false);
  });

  it("tells a structure from a table, which abapGit writes into the same file", () => {
    // IHTTPNVP is INTTAB, so ADT would ask for it under ddic/structures
    expect(store.find("STRU", "IHTTPNVP")).to.not.equal(undefined);
    expect(store.find("TABL", "IHTTPNVP")).to.not.equal(undefined);
    // ZSTG_DEMO is a transparent table, so it is not a structure
    expect(store.find("TABL", "ZSTG_DEMO")).to.not.equal(undefined);
    expect(store.find("STRU", "ZSTG_DEMO")).to.equal(undefined);
  });

  it("finds objects by name and by what is in the source", () => {
    const byName = store.search("SEGW_GEN");
    expect(byName.map((o) => o.name)).to.include("ZCL_STG_SEGW_GEN");
    const bySource = store.search("maxEditMode", {source: true, type: "CLAS", max: 5});
    expect(bySource.map((o) => o.name)).to.include("ZCL_STG_SEGW_GEN_DPC");
  });

  it("checks an object against the whole registry, not against itself", () => {
    const good = store.check("CLAS", "ZCL_STG_SEGW_EXPORT");
    expect(good.issues, JSON.stringify(good.issues.slice(0, 2))).to.deep.equal([]);
    const active = store.activate("CLAS", "ZCL_STG_SEGW_GEN");
    expect(active.active).to.equal(true);
  });

  it("packages come from the tree, and every parent is one a folder really has", () => {
    const all = store.packages();
    expect(all.length).to.be.greaterThan(50);
    const names = new Set(all.map((p) => p.name));
    // a root has no parent, everyone else has one that exists
    for (const node of all) {
      if (node.parent !== undefined) {
        expect(names, `${node.name} -> ${node.parent}`).to.include(node.parent);
      }
    }
    expect(all.filter((p) => p.parent === undefined).map((p) => p.name)).to.include.members(["$STG", "$OPEN_ABAP_CORE"]);
    // the name is the chain joined, so an underscore in a folder invents no
    // parent: src/demo_sadl sits under $STG, not under $STG_DEMO, and the
    // library roots do not sprout a $OPEN above them
    expect(names).to.not.include("$OPEN");
    expect(names).to.not.include("$EXPRESS_ICF");
    expect(all.find((p) => p.name === "$STG_DEMO_SADL").parent).to.equal("$STG");
    expect(all.find((p) => p.name === "$STG_SEGW_DDIC").parent).to.equal("$STG_SEGW");
  });

  it("a package holds its objects and names its subpackages", () => {
    const segw = store.package("$STG_SEGW");
    expect(segw.subpackages).to.deep.equal(["$STG_SEGW_DDIC"]);
    expect(segw.objects.map((o) => o.name)).to.include("ZCL_STG_SEGW_GEN");
    // an object of the subpackage is not in the parent's list
    expect(segw.objects.map((o) => o.name)).to.not.include("ZSTG_SBD_PR");
    expect(store.package("$STG_SEGW_DDIC").objects.map((o) => o.name)).to.include("ZSTG_SBD_PR");
    expect(store.package("$stg_segw").name).to.equal("$STG_SEGW");
    expect(() => store.package("$NOBODY")).to.throw(NotFound, "DEVC $NOBODY");
  });

  it("an object knows its package, and a library package says so", () => {
    expect(store.find("CLAS", "ZCL_STG_SEGW_GEN").package).to.equal("$STG_SEGW");
    expect(store.find("CLAS", "CL_ABAP_ZIP").package).to.contain("$OPEN_ABAP_CORE");
    expect(store.package("$OPEN_ABAP_CORE").library).to.equal(true);
    expect(store.package("$STG_SEGW").library).to.equal(false);
    // every object of the system is in exactly one package
    const counted = store.packages().reduce((n, p) => n + p.objects, 0);
    expect(counted).to.equal(store.list().length);
  });

  it("abapGit's file names and object names convert both ways", () => {
    expect(fileOf("/DEMO/ZREPORT")).to.equal("#demo#zreport");
    expect(nameOf("#demo#zreport")).to.equal("/DEMO/ZREPORT");
    expect(nameOf(fileOf("ZCL_X"))).to.equal("ZCL_X");
  });
});

// writing happens in a temporary system, so a test never touches the
// repository it runs in
describe("tools/osd-store: writing to the local system", () => {
  let root;
  let store;

  const CLASS = `CLASS zcl_osd_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.

CLASS zcl_osd_probe IMPLEMENTATION.
  METHOD run.
    rv_text = 'hello'.
  ENDMETHOD.
ENDCLASS.
`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osd-"));
    mkdirSync(join(root, "src"), {recursive: true});
    writeFileSync(join(root, "abaplint.jsonc"), readFileSync("abaplint.jsonc", "utf8"));
    store = new ObjectStore({root, libs: []});
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("a new object lands as a file and reads back", () => {
    const written = store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    expect(written.file).to.equal("src/osd/zcl_osd_probe.clas.abap");
    expect(readFileSync(join(root, written.file), "utf8")).to.equal(CLASS);
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.equal(CLASS);
    expect(store.list("CLAS").map((o) => o.name)).to.deep.equal(["ZCL_OSD_PROBE"]);
  });

  it("writing again replaces the source, and the includes go beside it", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS.replace("hello", "goodbye"));
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.contain("goodbye");
    store.write("CLAS", "ZCL_OSD_PROBE", "CLASS ltcl DEFINITION FOR TESTING.\nENDCLASS.\n", "testclasses");
    expect(store.read("CLAS", "ZCL_OSD_PROBE", "testclasses").source).to.contain("ltcl");
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.contain("goodbye");
  });

  it("a namespaced name becomes an abapGit file name", () => {
    const written = store.write("PROG", "/DEMO/ZREPORT", "REPORT zreport.\nWRITE 'x'.\n");
    expect(written.file).to.equal("src/osd/#demo#zreport.prog.abap");
    expect(store.read("PROG", "/demo/zreport").source).to.contain("REPORT");
  });

  it("deleting takes the object and its includes", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    store.write("CLAS", "ZCL_OSD_PROBE", "CLASS ltcl DEFINITION FOR TESTING.\nENDCLASS.\n", "testclasses");
    expect(store.delete("CLAS", "ZCL_OSD_PROBE")).to.include({deleted: true});
    expect(store.exists("CLAS", "ZCL_OSD_PROBE")).to.equal(false);
    expect(() => store.read("CLAS", "ZCL_OSD_PROBE")).to.throw(NotFound);
  });

  it("a library object cannot be written or deleted", () => {
    const withLibs = new ObjectStore();
    expect(() => withLibs.write("CLAS", "CL_ABAP_ZIP", "nope")).to.throw(ReadOnly);
    expect(() => withLibs.delete("CLAS", "CL_ABAP_ZIP")).to.throw(ReadOnly);
  });

  it("the transpile behind an activation is a separate call, so the verdict is fast", async () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    const before = Date.now();
    const verdict = store.activate("CLAS", "ZCL_OSD_PROBE");
    expect(Date.now() - before, "the verdict waits for no transpile").to.be.lessThan(9000);
    expect(verdict.active).to.equal(true);
    // the same promise while it runs, so two activations do not transpile twice
    const first = store.transpile();
    expect(store.transpile()).to.equal(first);
    expect(await first).to.include.keys(["ok", "ms", "objects"]);
  });

  it("activation holds or fails on the syntax check, with the line and the rule", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    expect(store.activate("CLAS", "ZCL_OSD_PROBE").active).to.equal(true);

    store.write("CLAS", "ZCL_OSD_PROBE", CLASS.replace("rv_text = 'hello'.", "rv_text = lv_missing."));
    const broken = store.activate("CLAS", "ZCL_OSD_PROBE");
    expect(broken.active).to.equal(false);
    expect(broken.issues.length).to.be.greaterThan(0);
    expect(broken.issues[0]).to.include.keys(["severity", "rule", "message", "file", "line", "column"]);
    expect(broken.issues[0].message).to.contain("lv_missing");
    expect(broken.issues[0].line).to.be.greaterThan(1);
  });

  it("a check can be given the source, and the file on disk is not touched", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    const stored = store.read("CLAS", "ZCL_OSD_PROBE").source;

    const asked = store.check("CLAS", "ZCL_OSD_PROBE", {source: CLASS.replace("rv_text = 'hello'.", "rv_text = lv_missing.")});
    expect(asked.issues.length).to.be.greaterThan(0);
    expect(asked.issues[0]).to.include.keys(["severity", "rule", "message", "file", "line", "column"]);
    expect(asked.issues[0].message).to.contain("lv_missing");

    // what was asked about is gone; what is stored is what answers again
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.equal(stored);
    expect(store.check("CLAS", "ZCL_OSD_PROBE").issues).to.deep.equal([]);
  });

  it("source in the request goes to the include the caller named", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    const answer = store.check("CLAS", "ZCL_OSD_PROBE", {include: "testclasses", source: "this is not ABAP"});
    expect(answer.issues.length).to.be.greaterThan(0);
    expect(answer.issues[0].file).to.contain(".clas.testclasses.abap");
    expect(() => store.read("CLAS", "ZCL_OSD_PROBE", "testclasses")).to.not.throw();
    expect(store.read("CLAS", "ZCL_OSD_PROBE", "testclasses").empty).to.equal(true);
  });

  it("an object that is not there yet can be checked, which is what a client asks before it creates one", () => {
    const answer = store.check("CLAS", "ZCL_OSD_UNBORN", {source: CLASS.replaceAll("zcl_osd_probe", "zcl_osd_unborn")});
    expect(answer).to.include({type: "CLAS", name: "ZCL_OSD_UNBORN"});
    expect(answer.issues, JSON.stringify(answer.issues)).to.deep.equal([]);
    // nothing was created by asking
    expect(store.exists("CLAS", "ZCL_OSD_UNBORN")).to.equal(false);
    expect(() => store.check("CLAS", "ZCL_OSD_UNBORN")).to.throw(NotFound);
  });

});
