import {expect} from "chai";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
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

  it("an include activates as itself: the registry files it as a program, and the check follows it there", () => {
    // INCL and PROG share a file and abaplint knows only PROG; asking the
    // registry for INCL found nothing and called every clean include broken
    const verdict = store.activate("INCL", "ZOSD_TEST_DEMO_INC");
    expect(verdict.issues, JSON.stringify(verdict.issues)).to.deep.equal([]);
    expect(verdict.active).to.equal(true);
  });

  it("a dependent of a kind the store does not index is checked, not thrown over", () => {
    // the SEGW project (IWPR) names the MPC_EXT it maps; it is in the
    // registry and not in TYPES, so the dependents walk used to reach
    // find() and 404 the whole activation with "IWPR ... does not exist"
    const kinds = store.dependents("CLAS", "ZCL_ZOSD_TEST_MPC_EXT").map((d) => d.type);
    expect(kinds).to.include("IWPR");
    expect(store.activate("CLAS", "ZCL_ZOSD_TEST_MPC_EXT").active).to.equal(true);
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
    expect(all.filter((p) => p.parent === undefined).map((p) => p.name)).to.include.members(["$STG", "$OPEN_ABAP_CORE", "$ZOSD_TEST"]);
    // the name is the chain joined, so an underscore in a folder invents no
    // parent: src/demo_sadl sits under $STG, not under $STG_DEMO, and the
    // library roots do not sprout a $OPEN above them
    expect(names).to.not.include("$OPEN");
    expect(names).to.not.include("$EXPRESS_ICF");
    expect(all.find((p) => p.name === "$STG_DEMO_SADL").parent).to.equal("$STG");
    expect(all.find((p) => p.name === "$STG_SEGW_DDIC").parent).to.equal("$STG_SEGW");
  });

  it("the tree has a root, which is what a client opens first", () => {
    // Alice's VS Code said "Unable to resolve nonexistent file
    // 'adt://osd/System Library'": the client asks for the node above every
    // package and OSD had nothing to answer with
    const tops = store.rootPackages();
    expect(tops.length).to.be.greaterThan(3);
    expect(tops.map((p) => p.name)).to.include.members(["$STG", "$OSD", "$ZOSD_TEST"]);
    for (const node of tops) {
      expect(node.parent, node.name).to.equal(undefined);
    }

    // and the same thing by the name a client uses for it: no package
    const root = store.package("");
    expect(root.name).to.equal("");
    expect(root.subpackages).to.deep.equal(tops.map((p) => p.name));
    expect(root.objects).to.deep.equal([]);
    // a name that is really missing is still missing
    expect(() => store.package("$NOSUCH")).to.throw(NotFound);
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
    // every entry is counted in exactly one package, except a root
    // package's own object: the package is not something inside itself
    const rootsWithOwnObject = store.rootPackages().filter((r) => store.find("DEVC", r.name) !== undefined).length;
    expect(counted).to.equal(store.list().length - rootsWithOwnObject);
  });

  it("abapGit's file names and object names convert both ways", () => {
    expect(fileOf("/DEMO/ZREPORT")).to.equal("#demo#zreport");
    expect(nameOf("#demo#zreport")).to.equal("/DEMO/ZREPORT");
    expect(nameOf(fileOf("ZCL_X"))).to.equal("ZCL_X");
  });
});

// writing happens in a temporary system, so a test never touches the
// repository it runs in
describe("tools/osd-store: writing to the local system", function () {
  // one of these waits for a transpile, which is seconds rather than the
  // two mocha allows by default. It passed until now because the transpile
  // failed fast in a temporary root, which is luck rather than a test.
  this.timeout(120000);

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

  it("a new object joins the package tree without rebuilding the index", () => {
    expect(store.packages()).to.deep.equal([]);

    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);

    const packages = store.packages();
    expect(packages.map((pkg) => pkg.name)).to.deep.equal(["$STG", "$STG_OSD"]);
    expect(packages.find((pkg) => pkg.name === "$STG_OSD").objects).to.equal(1);
    expect(store.rootPackages().map((pkg) => pkg.name)).to.deep.equal(["$STG"]);
    expect(store.package("$STG_OSD").objects).to.deep.include({
      type: "CLAS",
      name: "ZCL_OSD_PROBE",
      library: false,
      writable: true,
      // just written, and so not activated yet
      version: "inactive",
    });
  });

  it("writing again replaces the source, and the includes go beside it", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS.replace("hello", "goodbye"));
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.contain("goodbye");
    store.write("CLAS", "ZCL_OSD_PROBE", "CLASS ltcl DEFINITION FOR TESTING.\nENDCLASS.\n", "testclasses");
    expect(store.read("CLAS", "ZCL_OSD_PROBE", "testclasses").source).to.contain("ltcl");
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.contain("goodbye");
  });

  it("a created object lands in the folder of its package, with the abapGit header beside it", () => {
    // a package is a folder: the parent's header names the folder
    mkdirSync(join(root, "src", "demo"), {recursive: true});
    writeFileSync(join(root, "src", "demo", "package.devc.xml"), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DEVC><CTEXT>demo</CTEXT></DEVC></asx:values></asx:abap>
</abapGit>
`);
    const made = store.create("CLAS", "zcl_osd_made", {description: "made by a test", package: "$STG_DEMO"});
    expect(made.file).to.equal("src/demo/zcl_osd_made.clas.abap");
    expect(made.package).to.equal("$STG_DEMO");
    expect(made.version, "a created object is inactive until activated").to.equal("inactive");
    expect(existsSync(join(root, "src/demo/zcl_osd_made.clas.xml"))).to.equal(true);
    expect(readFileSync(join(root, "src/demo/zcl_osd_made.clas.xml"), "utf8")).to.contain("<DESCRIPT>made by a test</DESCRIPT>");
    expect(store.read("CLAS", "ZCL_OSD_MADE").source).to.contain("CLASS zcl_osd_made DEFINITION PUBLIC");
    expect(store.package("$STG_DEMO").objects.map((o) => o.name)).to.include("ZCL_OSD_MADE");
    // the skeleton checks clean, so the next save is the first real source
    expect(store.check("CLAS", "ZCL_OSD_MADE").issues).to.deep.equal([]);

    // twice is a conflict, a package that is not there is not found
    expect(() => store.create("CLAS", "ZCL_OSD_MADE", {package: "$STG_DEMO"})).to.throw(/already exists/);
    expect(() => store.create("INTF", "ZIF_X", {package: "$NOWHERE"})).to.throw(/does not exist/);
    expect(() => store.create("FUGR", "ZFG", {package: "$STG_DEMO"})).to.throw(/not supported/);

    // a package is a folder under its parent's, named after its last link
    const sub = store.create("DEVC", "$STG_DEMO_SUB", {description: "a subpackage", package: "$STG_DEMO"});
    expect(sub.file).to.equal("src/demo/sub/package.devc.xml");
    expect(store.packages().map((p) => p.name)).to.include("$STG_DEMO_SUB");
    expect(() => store.create("DEVC", "$OTHER", {package: "$STG_DEMO"})).to.throw(/named \$STG_DEMO_<FOLDER>/);
    const prog = store.create("PROG", "ZOSD_MADE_PROG", {description: "a report", package: "$STG_DEMO_SUB"});
    expect(prog.file).to.equal("src/demo/sub/zosd_made_prog.prog.abap");
    expect(readFileSync(join(root, "src/demo/sub/zosd_made_prog.prog.xml"), "utf8")).to.contain("<ENTRY>a report</ENTRY>");
    const incl = store.create("INCL", "ZOSD_MADE_INC", {package: "$STG_DEMO_SUB"});
    expect(readFileSync(join(root, incl.file.replace(/\.abap$/, ".xml")), "utf8")).to.contain("<SUBC>I</SUBC>");
    expect(store.find("INCL", "ZOSD_MADE_INC")).to.not.equal(undefined);
  });

  it("a deleted object takes its header with it, and a package goes only once it is empty", () => {
    mkdirSync(join(root, "src", "demo"), {recursive: true});
    writeFileSync(join(root, "src", "demo", "package.devc.xml"), "<abapGit><asx:abap><asx:values><DEVC><CTEXT>demo</CTEXT></DEVC></asx:values></asx:abap></abapGit>");
    const sub = store.create("DEVC", "$STG_DEMO_SUB", {package: "$STG_DEMO"});
    const made = store.create("CLAS", "ZCL_OSD_GONE", {package: "$STG_DEMO_SUB"});
    expect(() => store.delete("DEVC", "$STG_DEMO_SUB")).to.throw(/still holds 1 object/);
    expect(store.delete("CLAS", "ZCL_OSD_GONE")).to.deep.include({deleted: true});
    expect(existsSync(join(root, made.file))).to.equal(false);
    expect(existsSync(join(root, made.file.replace(/\.abap$/, ".xml"))), "the header went too").to.equal(false);
    expect(store.find("CLAS", "ZCL_OSD_GONE")).to.equal(undefined);
    expect(store.delete("DEVC", "$STG_DEMO_SUB")).to.deep.include({deleted: true});
    expect(existsSync(join(root, sub.file))).to.equal(false);
    expect(() => store.delete("CLAS", "ZCL_OSD_GONE")).to.throw(/does not exist/);
  });

  it("a file that appears on disk is an object here, once the store watches", async () => {
    store.watch();
    try {
      expect(store.find("CLAS", "ZCL_OSD_FROM_DISK")).to.equal(undefined);
      mkdirSync(join(root, "src", "osd"), {recursive: true});
      writeFileSync(join(root, "src/osd/zcl_osd_from_disk.clas.abap"), CLASS.replaceAll("zcl_osd_probe", "zcl_osd_from_disk"));
      // the watcher is an event away, not a call away
      for (let i = 0; i < 50 && store.find("CLAS", "ZCL_OSD_FROM_DISK") === undefined; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(store.find("CLAS", "ZCL_OSD_FROM_DISK")?.file).to.equal("src/osd/zcl_osd_from_disk.clas.abap");
      expect(store.check("CLAS", "ZCL_OSD_FROM_DISK").issues, "the registry saw it too").to.deep.equal([]);
      // and a change on disk is the source the next read gets, and the registry checks
      writeFileSync(join(root, "src/osd/zcl_osd_from_disk.clas.abap"), "CLASS zcl_osd_from_disk DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_osd_from_disk IMPLEMENTATION.\n  METHOD nope.\n  ENDMETHOD.\nENDCLASS.\n");
      for (let i = 0; i < 50 && store.check("CLAS", "ZCL_OSD_FROM_DISK").issues.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(store.check("CLAS", "ZCL_OSD_FROM_DISK").issues.length, "a broken edit on disk is a broken object here").to.be.greaterThan(0);
    } finally {
      store.unwatch();
    }
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

  it("a write drops the parse, because an update does not reach the callers", () => {
    // the fast path was built, measured and taken out again: telling
    // abaplint what changed is twenty milliseconds against four seconds,
    // and the object that changed then checks correctly while its callers
    // do not. A rename that breaks a caller came back clean, which is the
    // exact case activation exists to catch.
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    store.registry();
    expect(store.parsed).to.not.equal(undefined);

    store.write("CLAS", "ZCL_OSD_PROBE", CLASS.replace("'hello'", "'goodbye'"));
    expect(store.parsed, "a write buys a reparse rather than an update").to.equal(undefined);
    expect(store.check("CLAS", "ZCL_OSD_PROBE").issues).to.deep.equal([]);
    expect(store.read("CLAS", "ZCL_OSD_PROBE").source).to.contain("'goodbye'");
  });

  it("rebuilding the index drops the parse, because files changed under it", () => {
    store.write("CLAS", "ZCL_OSD_PROBE", CLASS);
    store.registry();
    expect(store.parsed).to.not.equal(undefined);
    // what an import does: many files at once, none of them through write()
    store.build();
    expect(store.parsed, "a parse that predates the objects it would check").to.equal(undefined);
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


  // An editor on Windows sends CRLF. Stored as it came, a saved comment
  // became a diff of every line in the file, with the comment nowhere in it.
  it("stores what an editor saves with the repository's line endings", async () => {
    const {mkdtempSync, mkdirSync, copyFileSync, readFileSync} = await import("node:fs");
    const {join} = await import("node:path");
    const {tmpdir} = await import("node:os");
    const root = mkdtempSync(join(tmpdir(), "osd-crlf-"));
    mkdirSync(join(root, "osd"));
    copyFileSync("abaplint.jsonc", join(root, "abaplint.jsonc"));
    const store = new ObjectStore({root});
    store.write("PROG", "ZOSD_CRLF", "REPORT zosd_crlf.\r\n* typed on Windows\r\nWRITE 1.\r\n");
    const onDisk = readFileSync(join(root, store.find("PROG", "ZOSD_CRLF").file), "utf8");
    expect(onDisk).to.equal("REPORT zosd_crlf.\n* typed on Windows\nWRITE 1.\n");
    expect(store.read("PROG", "ZOSD_CRLF").source).to.not.contain("\r");
  });
  // The roots are the transpiler's inputs, in the transpiler's order, so the
  // object ADT opens is the object that runs. Before 2026-09-16 the store
  // walked src, local, test, gen and the transpiler src, test, gen, local/*,
  // and local/ as a whole put 677 objects in the tree that no build had.
  describe("roots are the layers of abap_transpile.json", () => {
    let tree;
    const write = (file, text = "") => {
      mkdirSync(join(tree, file, ".."), {recursive: true});
      writeFileSync(join(tree, file), text);
    };
    const CLASS = (name, method) => `CLASS ${name} DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS ${method}.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\n  METHOD ${method}.\n  ENDMETHOD.\nENDCLASS.\n`;

    beforeEach(() => {
      tree = mkdtempSync(join(tmpdir(), "osd-layers-"));
      writeFileSync(join(tree, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "gen", "local/used"]}, null, 2) + "\n");
      write("src/zcl_ours.clas.abap", CLASS("zcl_ours", "first"));
      write("gen/zcl_ours.clas.abap", CLASS("zcl_ours", "generated"));
      write("local/used/zcl_ours.clas.abap", CLASS("zcl_ours", "imported"));
      write("local/used/zcl_theirs.clas.abap", CLASS("zcl_theirs", "run"));
      write("local/shadow/zcl_shadow.clas.abap", CLASS("zcl_shadow", "run"));
    });

    afterEach(() => rmSync(tree, {recursive: true, force: true}));

    it("reads the inputs in their order, and the later one wins, as in the build", () => {
      const own = new ObjectStore({root: tree, libs: []});
      expect(own.roots.map((r) => r.path)).to.deep.equal(["src", "gen", "local/used"]);
      expect(own.find("CLAS", "ZCL_OURS")).to.include({file: "local/used/zcl_ours.clas.abap", writable: true, imported: true});
      expect(own.find("CLAS", "ZCL_THEIRS")).to.include({file: "local/used/zcl_theirs.clas.abap", writable: true, imported: true});
      expect(own.find("CLAS", "ZCL_SHADOW"), "a folder that is not an input is not the system").to.equal(undefined);
      // gen is generated, never edited; an imported repository is a package under $OSD
      expect(own.roots.find((r) => r.path === "gen").writable).to.equal(false);
      expect(own.find("CLAS", "ZCL_THEIRS").packages).to.deep.equal(["$OSD", "$OSD_USED"]);
      // a library is not a layer: it fills only what no root has
      const withLib = new ObjectStore({root: tree, roots: [{path: "src", writable: true, library: false}], libs: ["local/used"]});
      expect(withLib.find("CLAS", "ZCL_OURS")).to.include({file: "src/zcl_ours.clas.abap", library: false});
      expect(withLib.find("CLAS", "ZCL_THEIRS")).to.include({file: "local/used/zcl_theirs.clas.abap", library: true});
    });

    it("rereads the list when told, and keeps roots a caller chose", () => {
      const own = new ObjectStore({root: tree, libs: []});
      writeFileSync(join(tree, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "gen", "local/used", "local/shadow"]}));
      expect(own.find("CLAS", "ZCL_SHADOW")).to.equal(undefined);
      own.reroot();
      expect(own.find("CLAS", "ZCL_SHADOW")).to.include({file: "local/shadow/zcl_shadow.clas.abap"});
      const chosen = new ObjectStore({root: tree, roots: [{path: "gen", writable: false, library: false}], libs: []});
      chosen.reroot();
      expect(chosen.roots.map((r) => r.path)).to.deep.equal(["gen"]);
      expect(chosen.find("CLAS", "ZCL_OURS")).to.include({file: "gen/zcl_ours.clas.abap"});
    });

    it("a tree without the config is read the old way", () => {
      rmSync(join(tree, "abap_transpile.json"));
      const own = new ObjectStore({root: tree, libs: []});
      expect(own.roots.map((r) => r.path)).to.deep.equal(["src", "local", "test", "gen"]);
      expect(own.find("CLAS", "ZCL_SHADOW")).to.include({file: "local/shadow/zcl_shadow.clas.abap"});
    });
  });
});
