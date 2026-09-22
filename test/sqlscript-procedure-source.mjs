import {expect} from "chai";
import {readFileSync} from "node:fs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {extract} from "../tools/amdp-extract.mjs";
import {compileProcedure, irTypeFromAbap} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";

describe("the original SQUARES AMDP through the portable runtime", function () {
  this.timeout(30000);
  let client;
  let compiled;

  before(async () => {
    const source = readFileSync(new URL("../src/amdp/zcl_osd_amdp_demo.clas.abap", import.meta.url), "utf8");
    const extracted = extract(source, "zcl_osd_amdp_demo.clas.abap");
    const method = extracted.methods.find((one) => one.name.toUpperCase() === "SQUARES");
    compiled = compileProcedure(method, extracted.types);
  });

  beforeEach(async () => {
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
  });

  afterEach(async () => client.disconnect());

  it("compiles the extracted source and signature, not a translated fixture", () => {
    expect(compiled.parameters).to.deep.equal([{name: "IV_COUNT", type: {abap: "I"}}]);
    expect(compiled.relationParameters).to.deep.equal([]);
    expect(compiled.output).to.equal("ET_SQUARE");
    expect(compiled.body.map((one) => one.stmt)).to.deep.equal([
      "declare-scalar", "assign-relation", "assign-scalar", "while",
    ]);
  });

  it("executes four rows on DuckDB with no HANA fallback", async () => {
    const answer = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_COUNT: 4}});
    expect(answer.rows.sort((a, b) => Number(a.ID) - Number(b.ID))).to.deep.equal([
      {ID: 1, LABEL: "square of 1", SQUARE: 1},
      {ID: 2, LABEL: "square of 2", SQUARE: 4},
      {ID: 3, LABEL: "square of 3", SQUARE: 9},
      {ID: 4, LABEL: "square of 4", SQUARE: 16},
    ]);
    expect(answer.trace).to.include({engine: "duckdb", fallback: false, databaseStatements: 1});
  });

  it("preserves the typed empty result", async () => {
    const answer = await runProcedure(compiled, {client, dialect: "duckdb", inputs: {IV_COUNT: 0}});
    expect(answer.rows).to.deep.equal([]);
    expect(answer.columns.map((one) => one.name)).to.deep.equal(["ID", "LABEL", "SQUARE"]);
  });

  it("refuses rather than dropping a trailing result-set statement", () => {
    const source = readFileSync(new URL("../src/amdp/zcl_osd_amdp_demo.clas.abap", import.meta.url), "utf8");
    const extracted = extract(source, "zcl_osd_amdp_demo.clas.abap");
    const method = extracted.methods.find((one) => one.name.toUpperCase() === "SQUARES");
    expect(() => compileProcedure({...method, body: `${method.body}\nSELECT 1 AS unexpected FROM DUMMY;`}, extracted.types))
      .to.throw(UnsupportedSqlScript, /SetOperation is outside/);
  });

  it("refuses scalar widths it does not enforce yet", () => {
    const source = readFileSync(new URL("../src/amdp/zcl_osd_amdp_demo.clas.abap", import.meta.url), "utf8");
    const extracted = extract(source, "zcl_osd_amdp_demo.clas.abap");
    const method = extracted.methods.find((one) => one.name.toUpperCase() === "SQUARES");
    for (const declaration of ["SMALLINT", "NVARCHAR(1)", "DECIMAL(3,1)"]) {
      const body = method.body.replace("DECLARE lv_i INTEGER", `DECLARE lv_i ${declaration}`);
      expect(() => compileProcedure({...method, body}, extracted.types), declaration)
        .to.throw(UnsupportedSqlScript, /DECLARE supports only INTEGER/);
    }
  });

  it("refuses additional output and INOUT parameters instead of discarding them", () => {
    const source = readFileSync(new URL("../src/amdp/zcl_osd_amdp_demo.clas.abap", import.meta.url), "utf8");
    const extracted = extract(source, "zcl_osd_amdp_demo.clas.abap");
    const method = extracted.methods.find((one) => one.name.toUpperCase() === "SQUARES");
    for (const extra of [
      {name: "ET_OTHER", direction: "OUT", abapType: "tt_square"},
      {name: "CV_OTHER", direction: "INOUT", abapType: "i"},
    ]) {
      expect(() => compileProcedure({...method, parameters: [...method.parameters, extra]}, extracted.types))
        .to.throw(UnsupportedSqlScript, /exactly one OUT or RETURNING/);
    }
  });

  it("does not classify user-defined names by an unanchored type fragment", () => {
    expect(() => irTypeFromAbap("PRICE")).to.throw(UnsupportedSqlScript);
    expect(() => irTypeFromAbap("ZCHAR10")).to.throw(UnsupportedSqlScript);
  });

  it("propagates a typed table-input schema through local assignments", () => {
    const types = new Map([
      ["TY_ROW", {kind: "structure", components: [{name: "id", abapType: "i"}]}],
      ["TT_ROW", {kind: "table", of: "TY_ROW"}],
    ]);
    const method = {body: "a = SELECT id FROM :it; et = SELECT id FROM :a;", parameters: [
      {name: "it", direction: "IN", abapType: "tt_row"},
      {name: "et", direction: "OUT", abapType: "tt_row"},
    ]};
    const compiled = compileProcedure(method, types);
    expect(compiled.body[0].rel.items[0].expr.type).to.deep.equal({abap: "I"});
    expect(compiled.body[1].rel.items[0].expr.type).to.deep.equal({abap: "I"});
    expect(() => compileProcedure({...method, body: "et = SELECT id FROM :missing;"}, types))
      .to.throw(UnsupportedSqlScript, /column ID is not present in the typed query scope/);
    const optionalTable = {...method, parameters: method.parameters.map((one) =>
      one.name === "it" ? {...one, optional: true} : one)};
    expect(() => compileProcedure(optionalTable, types))
      .to.throw(UnsupportedSqlScript, /OPTIONAL support is limited to ABAP INTEGER scalars/);
  });

  it("captures a scalar INTEGER LIMIT and accepts only the neutral OFFSET 0", async () => {
    const types = new Map([
      ["TY_ROW", {kind: "structure", components: [{name: "id", abapType: "i"}]}],
      ["TT_ROW", {kind: "table", of: "TY_ROW"}],
    ]);
    const method = {body: "et = SELECT id FROM :it ORDER BY id LIMIT :iv_limit OFFSET 0;", parameters: [
      {name: "it", direction: "IN", abapType: "tt_row"},
      {name: "iv_limit", direction: "IN", abapType: "i"},
      {name: "et", direction: "OUT", abapType: "tt_row"},
    ]};
    const limited = compileProcedure(method, types);
    const fixture = {rel: "union", all: true, inputs: [1, 2, 3].map((id) => ({
      rel: "project", input: {rel: "scan", table: "DUMMY"},
      items: [{as: "ID", expr: {node: "lit", value: id, type: {abap: "I"}}}],
    }))};
    const answer = await runProcedure(limited, {client, dialect: "duckdb", inputs: {IV_LIMIT: 2},
      relationInputs: {IT: fixture}, inputCatalogue: {DUMMY: {}}});
    expect(answer.rows).to.deep.equal([{ID: 1}, {ID: 2}]);
    for (const invalid of [-1, null]) {
      let error;
      try {
        await runProcedure(limited, {client, dialect: "duckdb", inputs: {IV_LIMIT: invalid},
          relationInputs: {IT: fixture}, inputCatalogue: {DUMMY: {}}});
      } catch (caught) { error = caught; }
      expect(error, String(invalid)).to.be.instanceOf(UnsupportedSqlScript);
      expect(error.message).to.contain("non-negative SQLScript INTEGER");
    }
    expect(() => compileProcedure({...method,
      body: "et = SELECT id FROM :it ORDER BY id LIMIT :iv_limit OFFSET 1;"}, types))
      .to.throw(UnsupportedSqlScript, /only the semantics-neutral literal OFFSET 0/);
  });
});
