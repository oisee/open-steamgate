import {expect} from "chai";
import {mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {ObjectStore, exclusionsOf} from "../tools/osd-store.mjs";

// **An exclusion has to reach the store as well, or it is not an exclusion.**
//
// CLAUDE.md says the `input_folder` list is the layer order "for the
// transpiler, the builder and the object store alike". It says nothing about
// the exclusions, and they were not alike: `gen/segw-editor/` (written by the
// SEGW editor's "Save to gen/" button until that was removed, 2026-09-25) was
// left out of the build on purpose, and the store indexed it anyway — so the
// ADT façade and the cross reference described objects the system does not
// contain. On this tree, which had been used, that was four classes
// (fable-osd found the symptom in `test/osd-xref.mjs`, which named one of
// them). The probe below now sits under `test/fixtures/`, the entry that is
// left.
//
// **Three attempts at inferring which exclusions meant "not ours" were wrong
// in three different directions**, which is why this reads a named list
// instead. Applying every entry removed 22 objects, 13 of them CDS views,
// because `\.ddls\.` stops the transpiler reading a file it cannot compile
// and a CDS view is very much an object here. Applying the folder-shaped
// ones removed the program in `test/fixtures/` that the ADT façade tests
// read. The build asks "can the transpiler read this file"; the store asks
// "is this an object of the system"; no amount of looking at the pattern
// turns one question into the other. So it is stated in the config, and the
// last test here keeps the two lists from drifting.
describe("what the build leaves out, the store leaves out — and no more", () => {
  const folder = join("test", "fixtures", "store-exclusion-probe");
  const file = join(folder, "zcl_exclusion_probe.clas.abap");
  const xml = join(folder, "zcl_exclusion_probe.clas.xml");
  let made = false;

  before(() => {
    made = !existsSync(folder);
    mkdirSync(folder, {recursive: true});
    writeFileSync(file, `CLASS zcl_exclusion_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_exclusion_probe IMPLEMENTATION.
ENDCLASS.
`);
    writeFileSync(xml, `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><VSEOCLASS>
<CLSNAME>ZCL_EXCLUSION_PROBE</CLSNAME><LANGU>E</LANGU><DESCRIPT>probe</DESCRIPT><STATE>1</STATE><CLSCCINCL>X</CLSCCINCL><FIXPT>X</FIXPT><UNICODE>X</UNICODE>
</VSEOCLASS></asx:values></asx:abap></abapGit>
`);
  });

  after(() => {
    rmSync(file, {force: true});
    rmSync(xml, {force: true});
    if (made) rmSync(folder, {recursive: true, force: true});
  });

  it("a class in a folder the build excludes is not an object of the system", () => {
    const store = new ObjectStore({root: process.cwd()});
    const names = store.list().map((o) => o.name);
    expect(names, "the file is there and the object is not").to.not.include("ZCL_EXCLUSION_PROBE");
  });

  it("but a CDS view is, even though the transpiler is told to skip its file", () => {
    // `\.ddls\.` keeps the transpiler from reading a file it cannot compile.
    // It says nothing about whether the object exists, and the store answers
    // a different question than the build does.
    const store = new ObjectStore({root: process.cwd()});
    const views = store.list().filter((o) => o.type === "DDLS");
    expect(views.length, "the CDS views are objects of this system").to.be.greaterThan(5);
  });

  it("and a fixture is NOT an object of the system, however useful it is to a test", () => {
    // This test used to assert the opposite, and the reason it changed is
    // the point. `/test/fixtures/` was kept in the store because one façade
    // test read `ZDEMO_EDITOR` through it as a system object -- so the
    // system contained an object the build had never compiled, and a check
    // of it was right about the object and wrong about the system: it
    // selects from a table the system does not have (fable-osd, running her
    // CDS check over the whole tree instead of over its own fixture,
    // 2026-09-19).
    //
    // The fix is the rule, not a second place: the folder joined
    // `not_in_system`, and the one test that needed a plain program now
    // reads `ZOSD_TEST_DEMO_PLAIN`, which is in the system. A test's need
    // for a subject is not a reason for the system to contain one.
    const store = new ObjectStore({root: process.cwd()});
    const names = store.list().map((o) => o.name);
    expect(names, "a fixture the build never compiles is not an object").to.not.include("ZDEMO_EDITOR");
    expect(names, "and the subject that replaced it is one").to.include("ZOSD_TEST_DEMO_PLAIN");
  });

  it("every entry of not_in_system is also an exclusion of the build", () => {
    // the two lists cannot drift into disagreeing: a folder the store hides
    // and the build compiles would be worse than either mistake alone
    const config = JSON.parse(readFileSync("abap_transpile.json", "utf8"));
    for (const entry of config.not_in_system ?? []) {
      expect(config.exclude_filter ?? [], `${entry} is hidden from the store`)
        .to.include(entry);
    }
    expect((config.not_in_system ?? []).length, "and there is at least one").to.be.greaterThan(0);
  });
});
