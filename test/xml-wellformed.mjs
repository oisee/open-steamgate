// Every tracked *.xml is well-formed XML. The transpiler, abaplint and this
// runtime read abapGit XML leniently, so a file missing its closing
// </abapGit> or </asx:values> built, served and passed every suite here; the
// abapGit on a real system refuses it ("XML parser error ... Line 1 Col. 1"),
// which is how two such files were found (A4H import of the L2 demo,
// 2026-10-01). This is the check a system would make, made here first.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
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
