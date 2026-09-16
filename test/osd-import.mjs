import {expect} from "chai";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Import, NotARepository, objectOf, repositoryConfig} from "../tools/osd-import.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

// abapGit in a box, the half that matters: a repository's objects become
// objects of the local system, because here an object already is a file in
// abapGit's format.
describe("tools/osd-import: a repository becomes objects of OSD", function () {
  this.timeout(60000);
  let root;
  let store;
  let repo;

  const CLASS = `CLASS zcl_imported DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.

CLASS zcl_imported IMPLEMENTATION.
  METHOD run.
  ENDMETHOD.
ENDCLASS.
`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "osd-system-"));
    mkdirSync(join(root, "src"), {recursive: true});
    store = new ObjectStore({root, roots: [{path: "src", writable: true, library: false},
                                           {path: "local", writable: true, library: false, imported: true}], libs: []});

    // a repository the way abapGit writes one
    repo = mkdtempSync(join(tmpdir(), "osd-repo-"));
    mkdirSync(join(repo, "src", "sub"), {recursive: true});
    writeFileSync(join(repo, ".abapgit.xml"), `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
  </DATA>
 </asx:values>
</asx:abap>
`);
    writeFileSync(join(repo, "src", "zcl_imported.clas.abap"), CLASS);
    writeFileSync(join(repo, "src", "zcl_imported.clas.xml"), "<abapGit><CLSNAME>ZCL_IMPORTED</CLSNAME></abapGit>");
    writeFileSync(join(repo, "src", "zcl_imported.clas.testclasses.abap"), "CLASS ltcl DEFINITION FOR TESTING.\nENDCLASS.\n");
    writeFileSync(join(repo, "src", "package.devc.xml"), "<abapGit><DEVC><CTEXT>The imported package</CTEXT></DEVC></abapGit>");
    writeFileSync(join(repo, "src", "sub", "zif_imported.intf.abap"), "INTERFACE zif_imported PUBLIC.\nENDINTERFACE.\n");
    writeFileSync(join(repo, "src", "sub", "package.devc.xml"), "<abapGit><DEVC><CTEXT>Below it</CTEXT></DEVC></abapGit>");
    writeFileSync(join(repo, "README.md"), "not an object");
    writeFileSync(join(repo, "src", "notes.txt"), "not an object either");
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
    rmSync(repo, {recursive: true, force: true});
  });

  it("reads the repository's own layout rather than assuming one", () => {
    expect(repositoryConfig(repo)).to.include({startingFolder: "/src/", folderLogic: "PREFIX", declared: true});
    // a folder with no .abapgit.xml is read as abapGit would guess it
    expect(repositoryConfig(root)).to.include({startingFolder: "/src/", declared: false});
    expect(() => new Import(store).fromFolder(join(root, "src"))).to.throw(NotARepository);
  });

  it("the objects arrive, and so does everything that belongs to them", () => {
    const result = new Import(store).fromFolder(repo, {name: "demo"});
    expect(result.objects).to.equal(2);
    expect(store.list().map((o) => `${o.type} ${o.name}`)).to.include.members(["CLAS ZCL_IMPORTED", "INTF ZIF_IMPORTED"]);
    // the class's source, its metadata and its test classes all came
    expect(store.read("CLAS", "ZCL_IMPORTED").source).to.equal(CLASS);
    expect(store.read("CLAS", "ZCL_IMPORTED", "testclasses").source).to.contain("ltcl");
    expect(existsSync(join(root, "local", "demo", "zcl_imported.clas.xml"))).to.equal(true);
    // and what belongs to no object stayed behind
    expect(result.skipped.map((s) => s.file)).to.deep.equal(["notes.txt"]);
  });

  // the folder joins the layers: an import that the build never saw was
  // the shadow copy of tools/osd-inputs.mjs, and 2026-09-16 the tree held
  // three of them. Listed last, so what was there first still wins
  it("lists the repository's folder as the last transpiler input, once", () => {
    const config = join(root, "abap_transpile.json");
    writeFileSync(config, JSON.stringify({input_folder: ["src"], exclude_filter: ["\\.mjs$"]}, null, 2) + "\n");
    const first = new Import(store).fromFolder(repo, {name: "demo"});
    expect(first.listed).to.equal(true);
    expect(JSON.parse(readFileSync(config, "utf8"))).to.deep.equal({input_folder: ["src", "local/demo"], exclude_filter: ["\\.mjs$"]});
    const again = new Import(store).fromFolder(repo, {name: "demo", overwrite: true});
    expect(again.listed).to.equal(false);
    expect(JSON.parse(readFileSync(config, "utf8")).input_folder).to.deep.equal(["src", "local/demo"]);
  });

  it("a tree without the config is imported all the same", () => {
    const result = new Import(store).fromFolder(repo, {name: "demo"});
    expect(result.listed).to.equal(false);
    expect(existsSync(join(root, "abap_transpile.json"))).to.equal(false);
  });

  it("an imported object is writable but marked as not ours", () => {
    new Import(store).fromFolder(repo, {name: "demo"});
    const entry = store.find("CLAS", "ZCL_IMPORTED");
    expect(entry.imported).to.equal(true);
    expect(entry.writable).to.equal(true);
    expect(entry.library).to.equal(false);
  });

  it("the repository's packages become packages, with their texts", () => {
    new Import(store).fromFolder(repo, {name: "demo"});
    const packages = store.packages();
    const top = packages.find((p) => p.name === "$OSD_DEMO");
    expect(top.description).to.equal("The imported package");
    expect(top.subpackages).to.deep.equal(["$OSD_DEMO_SUB"]);
    expect(packages.find((p) => p.name === "$OSD_DEMO_SUB").description).to.equal("Below it");
    expect(store.package("$OSD_DEMO_SUB").objects.map((o) => o.name)).to.deep.equal(["ZIF_IMPORTED"]);
  });

  it("our own object is not overwritten by an import, unless it is asked for", () => {
    store.write("CLAS", "ZCL_IMPORTED", "CLASS zcl_imported DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_imported IMPLEMENTATION.\nENDCLASS.\n");
    const guarded = new Import(store).fromFolder(repo, {name: "demo"});
    expect(guarded.skipped.map((s) => s.why)).to.include("CLAS ZCL_IMPORTED is ours already");
    expect(store.read("CLAS", "ZCL_IMPORTED").source).to.not.contain("METHODS run");

    const forced = new Import(store).fromFolder(repo, {name: "demo", overwrite: true});
    expect(forced.objects).to.equal(2);
  });

  it("one type can be asked for on its own", () => {
    const result = new Import(store).fromFolder(repo, {name: "demo", types: ["INTF"]});
    expect(result.objects).to.equal(1);
    expect(store.exists("INTF", "ZIF_IMPORTED")).to.equal(true);
    expect(store.exists("CLAS", "ZCL_IMPORTED")).to.equal(false);
  });

  it("a file name in abapGit's shape says which object it is", () => {
    expect(objectOf("zcl_x.clas.abap")).to.deep.equal({type: "CLAS", name: "ZCL_X"});
    expect(objectOf("#demo#zreport.prog.abap")).to.deep.equal({type: "PROG", name: "/DEMO/ZREPORT"});
    expect(objectOf("readme.md")).to.equal(undefined);
  });
});
