// The Marketplace reads a .vsix as an OPC package: every part needs a
// content type from [Content_Types].xml, looked up by file extension, and a
// declared asset it cannot type is refused as "not found in the package"
// (the first upload of oisee.open-steamgate failed on extension/LICENSE).
import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {contentTypesXml, stagedExtensions} from "../scripts/build-vsix.mjs";

describe("vsix content types", () => {
  it("types every staged extension, unknown ones as octet-stream", () => {
    const xml = contentTypesXml(["br", "osdnb", "seed-id", "md"]);
    expect(xml).to.contain('<Default Extension="br" ContentType="application/octet-stream"/>');
    expect(xml).to.contain('<Default Extension="seed-id" ContentType="application/octet-stream"/>');
    expect(xml).to.contain('<Default Extension="md" ContentType="text/markdown"/>');
    expect(xml.match(/Extension="md"/g)).to.have.length(1);
  });

  it("reads the extensions of a staged tree, dot-files included", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-ct-"));
    try {
      mkdirSync(join(dir, "osd"), {recursive: true});
      writeFileSync(join(dir, "LICENSE.txt"), "x");
      writeFileSync(join(dir, "osd", "seed.tar.br"), "x");
      writeFileSync(join(dir, "osd", ".seed-id"), "x");
      expect(stagedExtensions(dir).sort()).to.deep.equal(["br", "seed-id", "txt"]);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });

  it("refuses a file with no extension, which no Default entry can type", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-ct-"));
    try {
      writeFileSync(join(dir, "LICENSE"), "x");
      expect(() => stagedExtensions(dir)).to.throw("has no file extension");
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
});
