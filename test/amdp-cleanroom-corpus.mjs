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
    expect(byName.get("expand_values").body).to.match(/INTEGER ARRAY|UNNEST|WITH ORDINALITY/i);
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

  it("classifies every corpus method as compilable or a named refusal, never a crash", () => {
    const expected = {
      search_cells: /hint NEUTRAL_PLAN has not been looked at/,
      control_rows: /only scalar DECLARE/,
    };
    const compilable = new Set(["mix_rows", "rank_rows", "transform", "optional_value", "scalar_value", "difference_cells", "identity_cells", "expand_values"]);
    const seen = [];
    for (const file of fixtureFiles) {
      const logicalName = file.replace(/\.txt$/, "").replace(/^neutral_/, "cl_neutral_");
      const extracted = extract(source(file), logicalName);
      for (const method of extracted.methods) {
        seen.push(method.name);
        if (compilable.has(method.name)) {
          expect(() => compileProcedure(method, extracted.types), method.name).not.to.throw();
        } else {
          expect(() => compileProcedure(method, extracted.types), method.name)
            .to.throw(UnsupportedSqlScript, expected[method.name]);
        }
      }
    }
    expect(seen.sort()).to.deep.equal([...Object.keys(expected), ...compilable].sort());
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

  it("refuses a grouped window that reads a column outside the GROUP BY", () => {
    const extracted = extract(source("neutral_matrix.clas.abap.txt"), "cl_neutral_matrix.clas.abap");
    const method = extracted.methods.find((one) => one.name === "rank_rows");
    const changed = {...method,
      body: method.body.replace("ORDER BY amount DESC, key_id ASC, note_text ASC) AS row_value",
        "ORDER BY amount DESC, key_id ASC, day_value ASC) AS row_value")};
    expect(() => compileProcedure(changed, extracted.types))
      .to.throw(UnsupportedSqlScript, /ROW_VALUE window reads DAY_VALUE outside the GROUP BY/);
    const aggregateWindow = {...method,
      body: method.body.replace("ROW_NUMBER() OVER", "SUM(day_value + 1) OVER")};
    expect(() => compileProcedure(aggregateWindow, extracted.types))
      .to.throw(UnsupportedSqlScript, /grouped window must be a top-level/);
    const nestedAggregateWindow = {...method,
      body: method.body.replace("ROW_NUMBER() OVER", "SUM(SUM(amount)) OVER")};
    expect(() => compileProcedure(nestedAggregateWindow, extracted.types))
      .to.throw(UnsupportedSqlScript, /grouped window must be a top-level/);
    const wrappedWindow = {...method,
      body: method.body.replace("ROW_NUMBER() OVER (PARTITION BY group_id\n                         ORDER BY amount DESC, key_id ASC, note_text ASC)",
        "MAX(ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY amount DESC))")};
    expect(() => compileProcedure(wrappedWindow, extracted.types))
      .to.throw(UnsupportedSqlScript, /grouped window must be a top-level/);
    const partitionExpression = {...method,
      body: method.body.replace("PARTITION BY group_id", "PARTITION BY day_value + 1")};
    expect(() => compileProcedure(partitionExpression, extracted.types))
      .to.throw(UnsupportedSqlScript, /PARTITION BY expressions are outside the measured grouped ranking subset/);
    const windowInHaving = {...method,
      body: method.body.replace("HAVING COUNT(*) > 0", "HAVING ROW_NUMBER() OVER (ORDER BY amount) > 0")};
    expect(() => compileProcedure(windowInHaving, extracted.types))
      .to.throw(UnsupportedSqlScript, /window function is not legal in HAVING/);
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

  it("executes rank_rows with ranking ties from its original source on DuckDB", async () => {
    const extracted = extract(source("neutral_matrix.clas.abap.txt"), "cl_neutral_matrix.clas.abap");
    const method = extracted.methods.find((one) => one.name === "rank_rows");
    const compiled = compileProcedure(method, extracted.types);
    const schemas = Object.fromEntries(compiled.relationParameters.map((one) => [one.name, one.schema]));
    const leftRows = [
      {key_id: 1, group_id: 9, amount: 5, day_value: "20240101", note_text: "A"},
      {key_id: 2, group_id: 9, amount: 5, day_value: "20240102", note_text: "B"},
      {key_id: 3, group_id: 9, amount: 3, day_value: null, note_text: "C"},
      {key_id: 4, group_id: 10, amount: 8, day_value: "20240229", note_text: "D"},
      // GROUP BY must collapse the exact duplicate before the window runs.
      {key_id: 4, group_id: 10, amount: 8, day_value: "20240229", note_text: "D"},
    ];
    const rightRows = [1, 2, 3, 4].map((key_id) => ({key_id, code_text: "Q", factor: 1}));
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const left = await materializeRows(client, "RANK_LEFT", leftRows, schemas.IT_LEFT);
      const right = await materializeRows(client, "RANK_RIGHT", rightRows, schemas.IT_RIGHT);
      const answer = await runProcedure(compiled, {client, dialect: "duckdb",
        relationInputs: {IT_LEFT: left, IT_RIGHT: right}, inputCatalogue: {DUMMY: {}}});
      const rows = [...answer.rows].sort((a, b) => a.KEY_ID - b.KEY_ID);
      expect(rows.map(({KEY_ID, RANK_VALUE, DENSE_VALUE}) => ({KEY_ID, RANK_VALUE, DENSE_VALUE})))
        .to.deep.equal([
          {KEY_ID: 1, RANK_VALUE: 1, DENSE_VALUE: 1},
          {KEY_ID: 2, RANK_VALUE: 1, DENSE_VALUE: 1},
          {KEY_ID: 3, RANK_VALUE: 3, DENSE_VALUE: 2},
          {KEY_ID: 4, RANK_VALUE: 1, DENSE_VALUE: 1},
        ]);
      expect(rows.map(({KEY_ID, ROW_VALUE}) => ({KEY_ID, ROW_VALUE}))).to.deep.equal([
        {KEY_ID: 1, ROW_VALUE: 1},
        {KEY_ID: 2, ROW_VALUE: 2},
        {KEY_ID: 3, ROW_VALUE: 3},
        {KEY_ID: 4, ROW_VALUE: 1},
      ]);
      expect(answer.columns.map((one) => one.name)).to.deep.equal([
        "KEY_ID", "GROUP_ID", "AMOUNT", "RANK_VALUE", "DENSE_VALUE", "ROW_VALUE", "NOTE_TEXT",
      ]);
      expect(answer.columns.slice(3, 6).map((one) => one.type),
        "the ABAP I output boundary converts the engines' natural BIGINT ranking values").to.deep.equal([4, 4, 4]);
      expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
    } finally {
      await client.disconnect();
    }
  });

  it("executes every transform branch from an explicit portable session on DuckDB", async () => {
    const extracted = extract(source("neutral_flow.clas.abap.txt"), "cl_neutral_flow.clas.abap");
    const method = extracted.methods.find((one) => one.name === "transform");
    const mixedPrecedence = {...method, body: method.body.replace(
      ":lv_switch = 0 OR :lv_switch IS NULL",
      ":lv_switch = 0 OR :lv_switch = 1 AND :lv_switch = 1")};
    expect(() => compileProcedure(mixedPrecedence, extracted.types))
      .to.throw(UnsupportedSqlScript, /unparenthesized condition mixing AND and OR/);
    const leakedBranchScalar = {...method, body: method.body
      .replace("THEN\n      et_cells", "THEN\n      DECLARE lv_inner INTEGER := 1;\n      et_cells")
      .replace("ELSEIF (:lv_switch", "ELSEIF (:lv_inner = 1 AND :lv_switch")};
    expect(() => compileProcedure(leakedBranchScalar, extracted.types))
      .to.throw(UnsupportedSqlScript, /unknown scalar :lv_inner/);
    const postIfUse = {...method, body: method.body.replace(
      "    END IF;",
      "    END IF;\n    et_cells = SELECT * FROM :et_cells;")};
    expect(() => compileProcedure(postIfUse, extracted.types))
      .to.throw(UnsupportedSqlScript, /cannot prove schema assigned to ET_CELLS|unknown table variable/i);
    const broadRegex = {...method, body: method.body.replace(
      "REPLACE_REGEXPR('x' IN label_text WITH '' OCCURRENCE ALL)",
      "REPLACE_REGEXPR('X' IN label_text WITH '' OCCURRENCE ALL)")};
    expect(() => compileProcedure(broadRegex, extracted.types))
      .to.throw(UnsupportedSqlScript, /currently measured only for literal 'x'/);
    const compiled = compileProcedure(method, extracted.types);
    const schema = compiled.relationParameters[0].schema;
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const input = await materializeRows(client, "FLOW_CELLS", [
        {cell_id: 1, bucket_id: 4, amount: 2.5, stamp: "20240229", label_text: "MiXeD"},
        {cell_id: 2, bucket_id: 4, amount: 0, stamp: null, label_text: null},
        {cell_id: 3, bucket_id: 5, amount: -1.25, stamp: "20240301", label_text: "xaxb"},
        {cell_id: 4, bucket_id: 5, amount: 7, stamp: "20240302", label_text: " "},
      ], schema);
      for (const value of [0, null]) {
        const answer = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_SWITCH: value},
          relationInputs: {IT_CELLS: input}, inputCatalogue: {DUMMY: {}}});
        expect(answer.rows, `iv_switch=${value}`).to.deep.equal([
          {CELL_ID: 1, BUCKET_ID: 4, AMOUNT: "2.50", STAMP: "20240229", LABEL_TEXT: "mixed"},
          {CELL_ID: 2, BUCKET_ID: 4, AMOUNT: "0.00", STAMP: null, LABEL_TEXT: null},
          {CELL_ID: 3, BUCKET_ID: 5, AMOUNT: "-1.25", STAMP: "20240301", LABEL_TEXT: "xaxb"},
          {CELL_ID: 4, BUCKET_ID: 5, AMOUNT: "7.00", STAMP: "20240302", LABEL_TEXT: " "},
        ]);
        expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
      }
      const changed = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_SWITCH: 1},
        relationInputs: {IT_CELLS: input}, inputCatalogue: {DUMMY: {}}});
      expect(changed.rows).to.deep.equal([
        {CELL_ID: 1, BUCKET_ID: 4, AMOUNT: "2.50", STAMP: "20240229", LABEL_TEXT: "MiXeD"},
        {CELL_ID: 2, BUCKET_ID: 4, AMOUNT: "0.00", STAMP: null, LABEL_TEXT: null},
        {CELL_ID: 3, BUCKET_ID: 5, AMOUNT: "-1.25", STAMP: "20240301", LABEL_TEXT: "ab"},
      ]);
      expect(changed.columns[2].type,
        "the AMDP P(8,2) boundary is present after the branch's P(12,2) expression").to.equal(19);
      let nativeCalls = 0;
      const native = client.native.bind(client);
      client.native = async (...args) => { nativeCalls += 1; return native(...args); };
      let refusal;
      try {
        await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_SWITCH: 10},
          relationInputs: {IT_CELLS: input}, inputCatalogue: {DUMMY: {}}});
      } catch (error) { refusal = error; }
      expect(refusal).to.be.instanceOf(UnsupportedSqlScript);
      expect(refusal.message).to.match(/missing explicit SQLScript session context NEUTRAL_MODE/);
      expect(nativeCalls, "an unsupported selected branch is refused before database I/O").to.equal(0);
      const sessionBranch = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_SWITCH: 10},
        relationInputs: {IT_CELLS: input}, inputCatalogue: {DUMMY: {}},
        session: {values: {NEUTRAL_MODE: "portable"}}});
      expect(sessionBranch.rows.map((one) => one.LABEL_TEXT)).to.deep.equal([
        "portable", "portable", "portable", "portable",
      ]);
      expect(sessionBranch.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
    } finally {
      await client.disconnect();
    }
  });

  it("executes identity values from an explicit portable session", async () => {
    const extracted = extract(source("neutral_additions.clas.abap.txt"), "cl_neutral_additions.clas.abap");
    const method = extracted.methods.find((one) => one.name === "identity_cells");
    const compiled = compileProcedure(method, extracted.types);
    const schema = compiled.relationParameters[0].schema;
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const input = await materializeRows(client, "IDENTITY_CELLS", [
        {cell_id: 1, label_text: "A", code_text: "X"},
        {cell_id: 2, label_text: null, code_text: "Y"},
      ], schema);
      let refusal;
      let nativeCalls = 0;
      const native = client.native.bind(client);
      client.native = async (...args) => { nativeCalls += 1; return native(...args); };
      try {
        await runProcedure(compiled, {client, dialect: "duckdb", relationInputs: {IT_CELLS: input}, session: null});
      } catch (error) { refusal = error; }
      expect(refusal).to.be.instanceOf(UnsupportedSqlScript);
      expect(refusal.message).to.match(/missing explicit SQLScript session user CURRENT_USER/);
      expect(nativeCalls, "a null/missing session refuses before database I/O").to.equal(0);
      const answer = await runProcedure(compiled, {client, dialect: "duckdb", relationInputs: {IT_CELLS: input},
        session: {currentUser: "UNIT_USER", currentSchema: "UNIT_SCHEMA"}});
      expect(answer.rows).to.deep.equal([
        {CELL_ID: 1, EXECUTION_USER: "UNIT_USER", EXECUTION_SCHEMA: "UNIT_SCHEMA"},
        {CELL_ID: 2, EXECUTION_USER: "UNIT_USER", EXECUTION_SCHEMA: "UNIT_SCHEMA"},
      ]);
      expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
    } finally {
      await client.disconnect();
    }
  });

  it("executes scalar RETURNING functions in the portable host runtime", async () => {
    const additions = extract(source("neutral_additions.clas.abap.txt"), "cl_neutral_additions.clas.abap");
    const matrix = extract(source("neutral_matrix.clas.abap.txt"), "cl_neutral_matrix.clas.abap");
    const optional = compileProcedure(additions.methods.find((one) => one.name === "optional_value"), additions.types);
    const scalarMethod = matrix.methods.find((one) => one.name === "scalar_value");
    const scalar = compileProcedure(scalarMethod, matrix.types);
    const charReturning = {...scalarMethod, parameters: scalarMethod.parameters.map((one) =>
      one.direction === "RETURNING" ? {...one, abapType: "c LENGTH 3"} : one)};
    expect(() => compileProcedure(charReturning, matrix.types))
      .to.throw(UnsupportedSqlScript, /scalar RETURNING support is limited to ABAP INTEGER/);
    const relationalScalar = {...scalarMethod,
      body: "tmp = SELECT key_id FROM :it_left; rv_value = :iv_seed + 4;",
      parameters: [
        {name: "it_left", direction: "IN", abapType: "tt_left", optional: false},
        ...scalarMethod.parameters,
      ]};
    expect(() => compileProcedure(relationalScalar, matrix.types))
      .to.throw(UnsupportedSqlScript, /scalar-only portable functions cannot contain relational/);
    const decoratedCoalesce = {...scalarMethod,
      body: "rv_value = COALESCE(:iv_seed, 0) OVER ();"};
    expect(() => compileProcedure(decoratedCoalesce, matrix.types))
      .to.throw(UnsupportedSqlScript, /COALESCE does not accept window/);
    expect(optional.parameters).to.deep.equal([{name: "IV_SEED", type: {abap: "I"}, optional: true}]);
    expect((await runProcedure(optional)).value,
      "omitted OPTIONAL ABAP I has its ABAP initial value before SQLScript sees it").to.equal(0);
    expect((await runProcedure(optional, {inputs: {IV_SEED: null}})).value,
      "an explicit SQL NULL exercises COALESCE independently of ABAP omission").to.equal(7);
    expect((await runProcedure(optional, {inputs: {IV_SEED: 11}})).value).to.equal(11);
    const answer = await runProcedure(scalar, {inputs: {IV_SEED: -3}});
    expect(answer.value).to.equal(1);
    expect(answer.outputType).to.deep.equal({abap: "I"});
    expect(answer.trace).to.include({engine: "host", fallback: false, databaseStatements: 0});
  });

  it("executes difference_cells with DISTINCT and NULL set semantics on DuckDB", async () => {
    const extracted = extract(source("neutral_additions.clas.abap.txt"), "cl_neutral_additions.clas.abap");
    const method = extracted.methods.find((one) => one.name === "difference_cells");
    const compiled = compileProcedure(method, extracted.types);
    const schemas = Object.fromEntries(compiled.relationParameters.map((one) => [one.name, one.schema]));
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const repeated = {cell_id: 1, label_text: "same", code_text: "A"};
      const nullable = {cell_id: 2, label_text: null, code_text: "B"};
      const left = await materializeRows(client, "DIFF_LEFT", [repeated, repeated, nullable,
        {cell_id: 3, label_text: "left", code_text: "C"}], schemas.IT_LEFT);
      const right = await materializeRows(client, "DIFF_RIGHT", [repeated, nullable], schemas.IT_RIGHT);
      const answer = await runProcedure(compiled, {client, dialect: "duckdb",
        relationInputs: {IT_LEFT: left, IT_RIGHT: right}, inputCatalogue: {DUMMY: {}}});
      expect(answer.rows).to.deep.equal([{CELL_ID: 3, LABEL_TEXT: "left", CODE_TEXT: "C"}]);
      expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
    } finally {
      await client.disconnect();
    }
  });

  it("executes the tracked INTEGER ARRAY with duplicate, NULL and one-based ordinality", async () => {
    const extracted = extract(source("neutral_additions.clas.abap.txt"), "cl_neutral_additions.clas.abap");
    const method = extracted.methods.find((one) => one.name === "expand_values");
    const compiled = compileProcedure(method, extracted.types);
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      const answer = await runProcedure(compiled, {client, dialect: "duckdb"});
      expect(answer.rows).to.deep.equal([
        {ELEMENT_VALUE: 2, POSITION_VALUE: 1},
        {ELEMENT_VALUE: 2, POSITION_VALUE: 2},
        {ELEMENT_VALUE: null, POSITION_VALUE: 3},
        {ELEMENT_VALUE: 5, POSITION_VALUE: 4},
      ]);
      expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
    } finally {
      await client.disconnect();
    }

    expect(() => compileProcedure({...method, body: method.body.replace("ARRAY(2, 2, NULL, 5)", "ARRAY()")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /empty ARRAY constructor/);
    expect(() => compileProcedure({...method, body: method.body.replace("INTEGER ARRAY", "NVARCHAR(4) ARRAY")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /ARRAY support is limited to INTEGER elements exactly/);
    expect(() => compileProcedure({...method, body: method.body.replace("INTEGER ARRAY", "INTEGER(4) ARRAY")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /ARRAY support is limited to INTEGER elements exactly/);
    expect(() => compileProcedure({...method, body: method.body.replace("ARRAY(2, 2, NULL, 5)", "ARRAY(1 + 1)")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /ARRAY constructor values must be INTEGER literals or NULL exactly/);
    for (const expression of ["ARRAY(1) || ARRAY(2)", "ARRAY(1) + 2", "ARRAY(1) * 2"]) {
      expect(() => compileProcedure({...method, body: method.body.replace("ARRAY(2, 2, NULL, 5)", expression)}, extracted.types), expression)
        .to.throw(UnsupportedSqlScript, /requires an ARRAY\(\.\.\.\) constructor/);
    }
    for (const expression of ["ARRAY(1 ORDER BY 2)", "ARRAY(1) OVER ()"]) {
      expect(() => compileProcedure({...method, body: method.body.replace("ARRAY(2, 2, NULL, 5)", expression)}, extracted.types), expression)
        .to.throw(UnsupportedSqlScript, /ARRAY constructor decorations are outside/);
    }
    expect(() => compileProcedure({...method, body: method.body.replace("ARRAY(2, 2, NULL, 5)", "ARRAY(2147483648)")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /outside SQLScript INTEGER/);
    expect(() => compileProcedure({...method, body: method.body.replace(
      "DECLARE lv_values INTEGER ARRAY = ARRAY(2, 2, NULL, 5);",
      "DECLARE lv_seed INTEGER := 3;\n    DECLARE lv_values INTEGER ARRAY = ARRAY(:lv_seed);\n    lv_seed = 9;")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /ARRAY constructor values must be INTEGER literals or NULL exactly/);
    expect(() => compileProcedure({...method, body: method.body.replace(
      "DECLARE lv_values INTEGER ARRAY = ARRAY(2, 2, NULL, 5);",
      "DECLARE lv_first INTEGER ARRAY = ARRAY(1);\n    DECLARE lv_values INTEGER ARRAY = ARRAY(2, 2, NULL, 5);")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /supports one ARRAY declaration exactly/);
    expect(() => compileProcedure({...method, body: method.body.replace(":lv_values", ":missing_values")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /UNNEST refers to unknown array/);
    expect(() => compileProcedure({...method, body: method.body.replace(
      "AS (element_value, position_value)", "AS (element_value, element_value)")}, extracted.types))
      .to.throw(UnsupportedSqlScript, /column names must be distinct/);
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
