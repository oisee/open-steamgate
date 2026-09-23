// The binder constructs that slice (b) admitted, run as PROCEDURES on
// DuckDB through compileProcedure and runProcedure -- the runtime path --
// because the scope tests check the IR and the SQL text only, and a
// construct accepted by a shared binder is a runtime widening whether or
// not the commit was about the instrument (foreman-dell, whole-branch pass
// 2026-09-23). The first case is the one that answered wrong: a DEFAULT
// omitted by the caller was filled with the initial value.
import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";
import {extract} from "../tools/amdp-extract.mjs";
import {scan} from "../tools/sqlscript-ir.mjs";

const CLASS = (signature, body) => `CLASS cl_t DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    TYPES: BEGIN OF ty_row, id TYPE i, txt TYPE c LENGTH 10, END OF ty_row.
    TYPES tt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    CLASS-METHODS m ${signature}.
ENDCLASS.
CLASS cl_t IMPLEMENTATION.
  METHOD m BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    ${body}
  ENDMETHOD.
ENDCLASS.`;
const CATALOGUE = {SRC: {ID: {abap: "I"}, TXT: {abap: "C", len: 10}}};
// a table input is a relation, never an array: the rows of SRC as the input
const ROWS = scan("SRC");

describe("slice (b) constructs, as procedures on DuckDB", function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    await client.native({sql: 'CREATE TABLE "SRC" ("ID" INTEGER, "TXT" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "SRC" VALUES (1, \'one\'), (5, \'five\'), (20, \'twenty\')', expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });

  const program = (signature, body) => {
    const {methods, types} = extract(CLASS(signature, body), "cl_t.clas.abap");
    return compileProcedure(methods[0], types, {catalogue: CATALOGUE});
  };
  const run = (prog, inputs = {}, relationInputs = {}) => runProcedure(prog, {client, dialect: "duckdb", inputs, relationInputs, inputCatalogue: CATALOGUE});

  it("an omitted DEFAULT takes the literal, not the initial value: DEFAULT 10 answers the rows up to 10", async () => {
    const prog = program("IMPORTING VALUE(iv_limit) TYPE i DEFAULT 10 EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where id <= :iv_limit;");
    expect(prog.parameters[0]).to.include({optional: true, default: 10});
    const omitted = await run(prog);
    expect(omitted.rows.map((r) => r.ID)).to.deep.equal([1, 5]);
    const given = await run(prog, {IV_LIMIT: 2});
    expect(given.rows.map((r) => r.ID)).to.deep.equal([1]);
  });

  it("a bare OPTIONAL still takes ABAP's initial value, and a DEFAULT string its literal", async () => {
    const optional = program("IMPORTING VALUE(iv_limit) TYPE i OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where id <= :iv_limit;");
    expect((await run(optional)).rows).to.deep.equal([]);
    const text = program("IMPORTING VALUE(iv_txt) TYPE string DEFAULT 'five' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where txt = :iv_txt;");
    expect((await run(text)).rows.map((r) => r.ID)).to.deep.equal([5]);
  });

  it("refuses a DEFAULT that is not a literal of the parameter's type, by name", () => {
    expect(() => program("IMPORTING VALUE(iv_d) TYPE string DEFAULT sy-datum EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src;")).to.throw(UnsupportedSqlScript, /DEFAULT sy-datum for iv_d is not a literal/);
    expect(() => program("IMPORTING VALUE(iv_n) TYPE i DEFAULT 'x' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src;")).to.throw(UnsupportedSqlScript, /DEFAULT 'x' for iv_n/);
  });

  it("an alias without AS on a table parameter", async () => {
    const prog = program("IMPORTING VALUE(it_rows) TYPE tt_rows EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select a.id, a.txt from :it_rows a where a.id > 1;");
    expect((await run(prog, {}, {IT_ROWS: ROWS})).rows.map((r) => r.ID)).to.deep.equal([5, 20]);
  });

  it("a CASE whose ELSE is NULL takes the THEN branch's type and answers NULL there", async () => {
    const prog = program("IMPORTING VALUE(it_rows) TYPE tt_rows EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, case when id < 10 then txt else null end as txt from :it_rows;");
    const {rows} = await run(prog, {}, {IT_ROWS: ROWS});
    expect(rows.map((r) => r.TXT)).to.deep.equal(["one", "five", null]);
  });

  it("a comparison with NULL answers no row, as SQL does", async () => {
    const prog = program("IMPORTING VALUE(it_rows) TYPE tt_rows EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from :it_rows where id = null;");
    expect((await run(prog, {}, {IT_ROWS: ROWS})).rows).to.deep.equal([]);
  });

  it("a table as its own qualifier, and sys.dummy as the one-row source", async () => {
    const qualified = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select src.id, src.txt from src where src.id = 5;");
    expect((await run(qualified)).rows.map((r) => r.TXT)).to.deep.equal(["five"]);
    const dummy = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 7 as id, 'seven' as txt from sys.dummy;");
    expect((await run(dummy)).rows).to.deep.equal([{ID: 7, TXT: "seven"}]);
  });
});
