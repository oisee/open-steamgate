import {expect} from "chai";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {extract} from "../tools/amdp-extract.mjs";
import {lex} from "../tools/sqlscript/lexer.mjs";
import {parse} from "../tools/sqlscript/combi.mjs";
import {Body} from "../tools/sqlscript/expressions/index.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";
import {refTo, seamType} from "../tools/sqlscript-ir.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";

const root = fileURLToPath(new URL("fixtures/amdp-cleanroom/", import.meta.url));
const fixtureFiles = readdirSync(root).filter((name) => name.endsWith(".clas.abap.txt")).sort();
const source = (name) => readFileSync(join(root, name), "utf8");
const walk = (node, found = []) => {
  if (node !== null && typeof node === "object") {
    if (node.node !== undefined || node.rel !== undefined) found.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((one) => walk(one, found));
      else walk(value, found);
    }
  }
  return found;
};
const duckType = (type) => {
  if (type.abap === "I") return "INTEGER";
  if (type.abap === "P") return `DECIMAL(${type.len},${type.dec ?? 0})`;
  if (type.abap === "D") return "DATE";
  if (type.abap === "C") return `VARCHAR(${type.len})`;
  if (type.abap === "STRING") return "VARCHAR";
  throw new Error(`test fixture has no DuckDB type for ${JSON.stringify(type)}`);
};
const materializeRows = async (client, name, rows, schema) => {
  const columns = Object.entries(schema);
  const quoted = `"${name}"`;
  await client.execute(`CREATE TABLE ${quoted} (` +
    columns.map(([column, type]) => `"${column}" ${duckType(type)}`).join(", ") + ")");
  for (const row of rows) {
    await client.native({sql: `INSERT INTO ${quoted} VALUES (${columns.map(() => "?").join(", ")})`,
      params: columns.map(([column, type]) => ({name: column, value: row[column.toLowerCase()] ?? null,
        type: seamType(type), isNull: row[column.toLowerCase()] == null})), expect: "none"});
  }
  return refTo({ref: quoted, kind: "materialised", reason: "typed clean-room fixture"}, schema);
};

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

  it("classifies every unsupported synthetic method as a named refusal, never a crash or false success", () => {
    const expected = {
      search_cells: /inputs support only INTEGER scalars/,
      difference_cells: /EXCEPT is parsed/,
      expand_values: /inputs support only INTEGER scalars/,
      identity_cells: /CURRENT_USER is a session value/,
      optional_value: /not a resolved structured table type/,
      transform: /If is outside/,
      rank_rows: /neither an aggregate nor one of the GROUP BY columns/,
      control_rows: /only scalar DECLARE/,
      scalar_value: /not a resolved structured table type/,
    };
    const executable = new Set(["mix_rows"]);
    const seen = [];
    for (const file of fixtureFiles) {
      const logicalName = file.replace(/\.txt$/, "").replace(/^neutral_/, "cl_neutral_");
      const extracted = extract(source(file), logicalName);
      for (const method of extracted.methods) {
        seen.push(method.name);
        if (executable.has(method.name)) {
          expect(() => compileProcedure(method, extracted.types), method.name).not.to.throw();
        } else {
          expect(() => compileProcedure(method, extracted.types), method.name)
            .to.throw(UnsupportedSqlScript, expected[method.name]);
        }
      }
    }
    expect(seen.sort()).to.deep.equal([...Object.keys(expected), ...executable].sort());
  });

  it("keeps join qualifiers and the outer reference of the correlated EXISTS", () => {
    const extracted = extract(source("neutral_matrix.clas.abap.txt"), "cl_neutral_matrix.clas.abap");
    const method = extracted.methods.find((one) => one.name === "mix_rows");
    const compiled = compileProcedure(method, extracted.types);
    const nodes = walk(compiled.body[1].rel);
    const qualified = nodes.filter((one) => one.node === "col" && one.source !== undefined)
      .map((one) => `${one.source}.${one.name}`);
    expect(qualified).to.include.members(["L.KEY_ID", "R.KEY_ID", "Q.KEY_ID", "L.AMOUNT", "L.NOTE_TEXT"]);
    expect(nodes.find((one) => one.node === "col" && one.source === "L" && one.name === "AMOUNT").type)
      .to.deep.equal({abap: "P", len: 8, dec: 2});
    const correlated = nodes.find((one) => one.node === "sub" && one.kind === "exists");
    expect(correlated).to.not.equal(undefined);
    expect(walk(correlated).some((one) => one.node === "col" && one.source === "L" && one.name === "KEY_ID"))
      .to.equal(true);

    expect(() => compileProcedure({...method,
      body: method.body.replace("l.key_id = r.key_id", "key_id = key_id")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /ambiguous without a source qualifier/);
    expect(() => compileProcedure({...method,
      body: method.body.replace("l.amount BETWEEN", "l.unknown_amount BETWEEN")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /L.UNKNOWN_AMOUNT is not present/);
  });

  it("executes mix_rows from its original synthetic source on DuckDB", async () => {
    const extracted = extract(source("neutral_matrix.clas.abap.txt"), "cl_neutral_matrix.clas.abap");
    const method = extracted.methods.find((one) => one.name === "mix_rows");
    const compiled = compileProcedure(method, extracted.types);
    const seed = JSON.parse(readFileSync(join(root, "seed-data.json"), "utf8"));
    const schemas = Object.fromEntries(compiled.relationParameters.map((one) => [one.name, one.schema]));
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const left = await materializeRows(client, "MIX_LEFT", seed.leftRows, schemas.IT_LEFT);
      const right = await materializeRows(client, "MIX_RIGHT", seed.rightRows, schemas.IT_RIGHT);
      const answer = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_LIMIT: 10},
        relationInputs: {
          IT_LEFT: left,
          IT_RIGHT: right,
        }, inputCatalogue: {DUMMY: {}}});
      expect(answer.rows).to.deep.equal([{
        KEY_ID: 13, GROUP_ID: 7, AMOUNT: "4.50", DAY_VALUE: "20240229",
        NOTE_TEXT: "Q", CODE_TEXT: "R", FACTOR: "0.000",
      }]);
      expect(answer.columns).to.deep.equal([
        {name: "KEY_ID", type: 4}, {name: "GROUP_ID", type: 4}, {name: "AMOUNT", type: 19},
        {name: "DAY_VALUE", type: 17}, {name: "NOTE_TEXT", type: 17}, {name: "CODE_TEXT", type: 17},
        {name: "FACTOR", type: 19},
      ]);
      expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});

      const zero = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_LIMIT: 0},
        relationInputs: {IT_LEFT: left, IT_RIGHT: right}, inputCatalogue: {DUMMY: {}}});
      expect(zero.rows).to.deep.equal([]);

      const boundedLeft = [1, 2, 3].map((key_id) => ({
        key_id, group_id: 1, amount: 1, day_value: null, note_text: `N${key_id}`,
      }));
      const boundedRight = [1, 2, 3].map((key_id) => ({key_id, code_text: `R${key_id}`, factor: key_id}));
      const leftMany = await materializeRows(client, "MIX_LEFT_MANY", boundedLeft, schemas.IT_LEFT);
      const rightMany = await materializeRows(client, "MIX_RIGHT_MANY", boundedRight, schemas.IT_RIGHT);
      const bounded = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_LIMIT: 2},
        relationInputs: {IT_LEFT: leftMany, IT_RIGHT: rightMany}, inputCatalogue: {DUMMY: {}}});
      expect(bounded.rows.map((one) => one.KEY_ID)).to.deep.equal([1, 2]);
      const full = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_LIMIT: 10},
        relationInputs: {IT_LEFT: leftMany, IT_RIGHT: rightMany}, inputCatalogue: {DUMMY: {}}});
      expect(full.rows.map((one) => one.KEY_ID)).to.deep.equal([1, 2, 3]);

      const emptyLeft = await materializeRows(client, "MIX_LEFT_EMPTY", [], schemas.IT_LEFT);
      const emptyRight = await materializeRows(client, "MIX_RIGHT_EMPTY", [], schemas.IT_RIGHT);
      const empty = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_LIMIT: 10},
        relationInputs: {IT_LEFT: emptyLeft, IT_RIGHT: emptyRight}, inputCatalogue: {DUMMY: {}}});
      expect(empty.rows).to.deep.equal([]);
    } finally {
      await client.disconnect();
    }
  });

  it("executes a value-level correlated EXISTS where the correlation changes the answer", async () => {
    const types = new Map([
      ["TY_ID", {kind: "structure", components: [{name: "id", abapType: "i"}]}],
      ["TT_ID", {kind: "table", of: "TY_ID"}],
    ]);
    const method = {
      body: "et = SELECT l.id FROM :it_left AS l " +
        "WHERE EXISTS (SELECT id FROM :it_right WHERE id = l.id);",
      parameters: [
        {name: "it_left", direction: "IN", abapType: "tt_id"},
        {name: "it_right", direction: "IN", abapType: "tt_id"},
        {name: "et", direction: "OUT", abapType: "tt_id"},
      ],
    };
    const compiled = compileProcedure(method, types);
    const schema = compiled.relationParameters[0].schema;
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const left = await materializeRows(client, "CORR_LEFT", [{id: 1}, {id: 2}], schema);
      const right = await materializeRows(client, "CORR_RIGHT", [{id: 2}], schema);
      const answer = await runProcedure(compiled, {client, dialect: "duckdb",
        relationInputs: {IT_LEFT: left, IT_RIGHT: right}, inputCatalogue: {DUMMY: {}}});
      expect(answer.rows).to.deep.equal([{ID: 2}]);
    } finally {
      await client.disconnect();
    }
  });
});
