import {expect} from "chai";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {extract} from "../tools/amdp-extract.mjs";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";

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

  it("keeps additive edge states synthetic and non-executable", () => {
    const seed = JSON.parse(readFileSync(join(root, "additive-seed.json"), "utf8"));
    expect(seed.arrayStates).to.deep.equal([null, [], [2], [2, 2], [2, null, 5]]);
    expect(seed.textStates).to.include.members(["amber field", "amber fld", "é", "é", null]);
    expect(seed.filterStateLabels).to.include.members(["empty", "bound_predicate", "malformed", "inert_injection_shape"]);
    expect(seed.errorStateLabels).to.deep.equal(["validation_failure", "shape_mismatch"]);
    expect(seed.optionalCallStates).to.deep.equal(["omitted", "initial", "null", "non_default"]);
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

  it("recognizes the additive syntax categories without asserting runtime meaning", () => {
    const result = extract(source("neutral_additions.clas.abap.txt"), "cl_neutral_additions.clas.abap");
    const byName = new Map(result.methods.map((method) => [method.name, method]));
    expect(byName.get("difference_cells").body).to.match(/\bEXCEPT\b/i);
    expect(byName.get("search_cells").body).to.match(/APPROX_MATCH|MATCH_SCORE|COALESCE|MAP_DEFAULT|WITH HINT/i);
    expect(byName.get("expand_values").body).to.match(/array_expand/i);
    expect(byName.get("identity_cells").body).to.match(/CURRENT_USER|CURRENT_SCHEMA/i);
    expect(source("neutral_additions.clas.abap.txt")).to.match(/iv_seed\) TYPE i OPTIONAL/i);
    expect(byName.get("optional_value").parameters.map((p) => p.direction)).to.deep.equal(["IN", "RETURNING"]);
    expect(byName.get("optional_value").parameters[0].abapType).to.equal("i");
  });

  it("contains no path markers, archive markers, or business identifiers", () => {
    const all = fixtureFiles.map(source).concat(
      readFileSync(join(root, "seed-data.json"), "utf8"),
      readFileSync(join(root, "additive-seed.json"), "utf8"),
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

  it("classifies every synthetic method as a named refusal, never a crash or false success", () => {
    const expected = {
      search_cells: /inputs support only INTEGER scalars/,
      difference_cells: /EXCEPT is parsed/,
      expand_values: /inputs support only INTEGER scalars/,
      identity_cells: /CURRENT_USER is a session value/,
      optional_value: /not a resolved structured table type/,
      transform: /If is outside/,
      mix_rows: /LIMIT over anything but a literal/,
      rank_rows: /neither an aggregate nor one of the GROUP BY columns/,
      control_rows: /only scalar DECLARE/,
      scalar_value: /not a resolved structured table type/,
    };
    const seen = [];
    for (const file of fixtureFiles) {
      const logicalName = file.replace(/\.txt$/, "").replace(/^neutral_/, "cl_neutral_");
      const extracted = extract(source(file), logicalName);
      for (const method of extracted.methods) {
        seen.push(method.name);
        expect(() => compileProcedure(method, extracted.types), method.name)
          .to.throw(UnsupportedSqlScript, expected[method.name]);
      }
    }
    expect(seen.sort()).to.deep.equal(Object.keys(expected).sort());
  });
});
