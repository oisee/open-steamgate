import {expect} from "chai";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {extract} from "../tools/amdp-extract.mjs";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";

const root = fileURLToPath(new URL("fixtures/amdp-cleanroom/", import.meta.url));
const fixtureFiles = readdirSync(root).filter((name) => name.endsWith(".clas.abap.txt")).sort();
const source = (name) => readFileSync(join(root, name), "utf8");

describe("independent AMDP clean-room corpus", () => {
  it("has a provenance manifest that records exclusions and omissions", () => {
    const manifest = JSON.parse(readFileSync(join(root, "provenance.json"), "utf8"));
    expect(manifest.construction).to.match(/independently authored/i);
    expect(manifest.source_exclusions).to.be.an("array").with.length.greaterThan(2);
    expect(manifest.omitted_categories).to.be.an("array").with.length.greaterThan(2);
  });

  it("keeps the seed palette independent and edge-focused", () => {
    const seed = JSON.parse(readFileSync(join(root, "seed-data.json"), "utf8"));
    expect(seed.leftRows).to.have.length(5);
    expect(seed.rightRows.filter((row) => row.key_id === 4)).to.have.length(2);
    expect(seed.leftRows[3].key_id).to.equal(null);
    expect(seed.leftRows[4]).to.deep.equal(seed.leftRows[2]);
    expect(seed.edgeCases).to.include.members(["empty", "ranking_tie", "multibyte_text"]);
  });

  for (const file of fixtureFiles) {
    it(`extracts and parses ${file}`, () => {
      const logicalName = file.replace(/\.txt$/, "").replace(/^neutral_/, "cl_neutral_");
      const result = extract(source(file), logicalName);
      expect(result.className).to.match(/^CL_NEUTRAL_/);
      expect(result.methods.length, file).to.be.greaterThan(0);
      for (const method of result.methods) {
        expect(method.body, `${file}:${method.name}`).to.be.a("string").and.not.empty;
        expect(method.body.toUpperCase()).to.not.include("ENDMETHOD");
        expect(() => parse(new Body(), lex(method.body)), `${file}:${method.name}`).not.to.throw();
      }
    });
  }

  it("exposes both procedure and function metadata", () => {
    const result = extract(source("neutral_matrix.clas.abap.txt"), "cl_neutral_matrix.clas.abap");
    expect(result.methods.map((method) => method.dbKind)).to.include.members(["PROCEDURE", "FUNCTION"]);
    expect(result.methods.find((method) => method.name === "scalar_value").readOnly).to.equal(true);
    expect(result.methods.find((method) => method.name === "rank_rows").usings)
      .to.deep.equal(["cl_neutral_alpha", "cl_neutral_beta"]);
    expect(result.methods.find((method) => method.name === "mix_rows").parameters.map((p) => p.direction))
      .to.deep.equal(["IN", "IN", "IN", "OUT"]);
  });

  it("contains no path markers, archive markers, or business identifiers", () => {
    const all = fixtureFiles.map(source).concat(
      readFileSync(join(root, "seed-data.json"), "utf8"),
      readFileSync(join(root, "provenance.json"), "utf8"),
    ).join("\n");
    const forbidden = [
      /(?:^|[\\/])(?:mnt|home|tmp|workspace|devux)(?:[\\/]|\b)/i,
      /\.(?:zip|7z|tar|tgz)(?:\b|$)/i,
      /\b(?:customer|employee|invoice|account|company|production|business|travel|booking|flight)\b/i,
      /\b(?:sap|hana|abaplint|osd|iwbep)_[a-z0-9_]+\b/i,
    ];
    for (const pattern of forbidden) expect(all, pattern.toString()).to.not.match(pattern);
  });
});
