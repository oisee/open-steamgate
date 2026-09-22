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
});
