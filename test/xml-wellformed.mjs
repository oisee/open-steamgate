// Every tracked *.xml is well-formed XML. The transpiler, abaplint and this
// runtime read abapGit XML leniently, so a file missing its closing
// </abapGit> or </asx:values> built, served and passed every suite here; the
// abapGit on a real system refuses it ("XML parser error ... Line 1 Col. 1"),
// which is how two such files were found (A4H import of the L2 demo,
// 2026-10-01). This is the check a system would make, made here first.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {XMLValidator} from "fast-xml-parser";

describe("every tracked XML file is well-formed", () => {
  const files = execFileSync("git", ["ls-files", "-z", "*.xml"], {encoding: "utf8"}).split("\0").filter(Boolean);

  it("finds the XML files", () => {
    expect(files.length).to.be.greaterThan(100);
  });

  it("parses each one strictly", () => {
    const bad = files.map((file) => {
      // a UTF-8 byte order mark is legal and abapGit writes one
      const result = XMLValidator.validate(readFileSync(file, "utf8").replace(/^﻿/, ""));
      return result === true ? undefined : `${file}:${result.err.line}:${result.err.col} ${result.err.msg}`;
    }).filter(Boolean);
    expect(bad, bad.join("\n")).to.deep.equal([]);
  });

  it("would catch a file missing its closing tag", () => {
    expect(XMLValidator.validate("<abapGit><asx:abap></asx:abap>")).to.not.equal(true);
  });
});

// A class with local test classes says so in its VSEOCLASS: abapGit on a system
// writes the test include (CCAU) only when WITH_UNIT_TESTS is X, so without it
// the class arrives with no tests at all, while here the transpiler reads the
// .testclasses.abap file anyway and every test runs (A4H, 2026-10-01: eight
// L2 rule classes imported with ccau_lines=0 and ABAP Unit found no classes).
// Checked for what ships: src/, packs/, deploy/.
describe("every shipped class with test classes carries WITH_UNIT_TESTS", () => {
  const tests = execFileSync("git", ["ls-files", "-z", "src/*.clas.testclasses.abap", "packs/*.clas.testclasses.abap",
    "deploy/*.clas.testclasses.abap"], {encoding: "utf8"}).split("\0").filter(Boolean);

  it("finds the classes with test classes", () => {
    expect(tests.length).to.be.greaterThan(10);
  });

  it("flags each one whose clas.xml exists", () => {
    const missing = tests.map((file) => file.replace(/\.testclasses\.abap$/, ".xml"))
      .filter((xml) => existsSync(xml) && !/<WITH_UNIT_TESTS>X<\/WITH_UNIT_TESTS>/.test(readFileSync(xml, "utf8")));
    expect(missing, missing.join("\n")).to.deep.equal([]);
  });
});

// F3 is a test-only continuation fixture, so the shipped-class scan excludes it.
describe("F3 continuation fixture metadata", () => {
  it("carries WITH_UNIT_TESTS for its local ABAP Unit tests", () => {
    const xml = readFileSync("test/unit/zcl_osd_adt_route_f3.clas.xml", "utf8");
    expect(xml).to.include("<WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>");
  });
});
