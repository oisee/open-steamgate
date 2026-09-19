import {expect} from "chai";
import {mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {ObjectStore, exclusionsOf} from "../tools/osd-store.mjs";

// **An exclusion has to reach the store as well, or it is not an exclusion.**
//
// CLAUDE.md says the `input_folder` list is the layer order "for the
// transpiler, the builder and the object store alike". It says nothing about
// the exclusions, and they were not alike: `gen/segw-editor/` is written by
// the SEGW editor's "Save to gen/" button and left out of the build on
// purpose, and the store indexed it anyway — so the ADT façade and the cross
// reference described objects the system does not contain. On this tree,
// which had been used, that was four classes (fable-osd found the symptom in
// `test/osd-xref.mjs`, which named one of them).
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
  const folder = join("gen", "segw-editor");
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

  it("keeps the fixture program the ADT tests read, which is in an excluded folder too", () => {
    // `/test/fixtures/` is excluded from the build and its program is read by
    // the ADT façade as a system object. That is the second direction this
    // was wrong in: a folder-shaped rule removed it
    const store = new ObjectStore({root: process.cwd()});
    expect(store.list().map((o) => o.name), "the ADT tests read this one")
      .to.include("ZDEMO_EDITOR");
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
