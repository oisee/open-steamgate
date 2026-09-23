// The binder constructs that slice (b) admitted, run as PROCEDURES on
// DuckDB through compileProcedure and runProcedure -- the runtime path --
// because the scope tests check the IR and the SQL text only, and a
// construct accepted by a shared binder is a runtime widening whether or
// not the commit was about the instrument (foreman-dell, whole-branch pass
// 2026-09-23). The first case is the one that answered wrong: a DEFAULT
// omitted by the caller was filled with the initial value.
import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";
import {extract} from "../tools/amdp-extract.mjs";
import {scan} from "../tools/sqlscript-ir.mjs";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FolderDdic} from "../tools/sqlscript/folder-ddic.mjs";
import {parseTableFunction} from "../tools/sqlscript/table-function-ddls.mjs";

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

// Every portable dialect with an in-process client, not DuckDB alone: DuckDB
// is the first engine we check, not the definition of "works" (Alice,
// 2026-09-23). PostgreSQL joins where a server is configured.
const ENGINES = [
  {dialect: "duckdb", make: () => new DuckDBDatabaseClient({path: ":memory:"})},
  {dialect: "sqlite", make: () => new FileSqliteClient({path: ":memory:"})},
];

for (const {dialect, make} of ENGINES) describe(`slice (b) constructs, as procedures on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "SRC" ("ID" INTEGER, "TXT" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "SRC" VALUES (1, \'one\'), (5, \'five\'), (20, \'twenty\')', expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });

  const program = (signature, body) => {
    const {methods, types} = extract(CLASS(signature, body), "cl_t.clas.abap");
    return compileProcedure(methods[0], types, {catalogue: CATALOGUE});
  };
  const run = (prog, inputs = {}, relationInputs = {}) => runProcedure(prog, {client, dialect, inputs, relationInputs, inputCatalogue: CATALOGUE});

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
    // a text-field literal loses its trailing blanks into a STRING in ABAP;
    // until that is measured through the procedure, it is refused, not guessed
    expect(() => program("IMPORTING VALUE(iv_t) TYPE string DEFAULT 'ab  ' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src;")).to.throw(UnsupportedSqlScript, /ends in blanks/);
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

  it("a CHAR input is bound as the kernel binds it: right-trimmed, leading blank kept, '' when initial", async () => {
    // the rule measured on A4H (docs/sqlscript-hana-observed.md), against a
    // column holding right-trimmed values as a dictionary column does
    const prog = program("IMPORTING VALUE(iv_txt) TYPE c LENGTH 10 OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where txt = :iv_txt;");
    expect((await run(prog, {IV_TXT: "five"})).rows.map((r) => r.ID)).to.deep.equal([5]);
    expect((await run(prog, {IV_TXT: "five      "})).rows.map((r) => r.ID)).to.deep.equal([5]);
    expect((await run(prog, {IV_TXT: " five"})).rows).to.deep.equal([]);
    expect((await run(prog)).rows).to.deep.equal([]);
    const initial = program("IMPORTING VALUE(iv_txt) TYPE c LENGTH 10 OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, case when :iv_txt = '' then 'empty' else 'not' end as txt from dummy;");
    expect((await run(initial)).rows).to.deep.equal([{ID: 0, TXT: "empty"}]);
    const defaulted = program("IMPORTING VALUE(iv_txt) TYPE c LENGTH 10 DEFAULT 'one  ' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where txt = :iv_txt;");
    // the compiled DEFAULT is already right-trimmed, not only at the bind
    expect(defaulted.parameters[0].default).to.equal("one");
    expect((await run(defaulted)).rows.map((r) => r.ID)).to.deep.equal([1]);
  });

  it("an omitted date or time input is its zero digits, not '' (measured on A4H)", async () => {
    const dated = program("IMPORTING VALUE(iv_d) TYPE d OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;");
    expect(dated.parameters[0].default).to.equal("00000000");
    expect((await run(dated)).rows).to.deep.equal([{ID: 0, TXT: "00000000"}]);
    expect((await run(dated, {IV_D: "20260923"})).rows).to.deep.equal([{ID: 0, TXT: "20260923"}]);
    const timed = program("IMPORTING VALUE(iv_t) TYPE t OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_t as txt from dummy;");
    expect(timed.parameters[0].default).to.equal("000000");
    expect((await run(timed)).rows).to.deep.equal([{ID: 0, TXT: "000000"}]);
    // an explicit initial is the zeros too, and a non-date is refused
    expect((await run(dated, {IV_D: ""})).rows).to.deep.equal([{ID: 0, TXT: "00000000"}]);
    expect((await run(timed, {IV_T: "      "})).rows).to.deep.equal([{ID: 0, TXT: "000000"}]);
    let failure;
    try { await run(dated, {IV_D: "2026"}); } catch (error) { failure = error; }
    expect(failure?.message).to.match(/IV_D is not 8 digits, so not a date/);
    const required = program("IMPORTING VALUE(iv_d) TYPE dats EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;");
    expect(required.parameters[0].kind).to.equal("DATS");
    expect((await run(required, {IV_D: ""})).rows).to.deep.equal([{ID: 0, TXT: "00000000"}]);
    // a date DEFAULT is checked when the method compiles, not first used
    const withDefault = program("IMPORTING VALUE(iv_d) TYPE d DEFAULT '20260101' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;");
    expect((await run(withDefault)).rows).to.deep.equal([{ID: 0, TXT: "20260101"}]);
    expect(() => program("IMPORTING VALUE(iv_d) TYPE d DEFAULT '2026' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;")).to.throw(UnsupportedSqlScript, /DEFAULT '2026' for iv_d is not 8 digits/);
    // a program handed over with a bad kind, or a kind on the wrong width, is refused
    for (const [bad, message] of [[{...required.parameters[0], kind: "NUMC"}, /unknown kind NUMC/], [{...required.parameters[0], type: {abap: "C", len: 6}}, /is a DATS but not C\(8\)/]]) {
      failure = undefined;
      try { await runProcedure({...required, parameters: [bad]}, {client, dialect, inputs: {IV_D: "20260101"}, inputCatalogue: CATALOGUE}); } catch (error) { failure = error; }
      expect(failure?.message).to.match(message);
    }
  });

  it("a RAW input is its n bytes as canonical hex: padded with zero bytes, initial all zeros, compared exactly", async () => {
    await client.native({sql: 'CREATE TABLE "RAWS" ("ID" INTEGER, "K" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "RAWS" VALUES (1, \'0123456789ABCDEF0123456789ABCDEF\'), (2, \'00FF0000000000000000000000000000\'), (3, \'00000000000000000000000000000000\')', expect: "none"});
    const {methods, types} = extract(CLASS("IMPORTING VALUE(iv_k) TYPE x LENGTH 16 OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, 'x' as txt from raws where k = :iv_k;"), "cl_t.clas.abap");
    const prog = compileProcedure(methods[0], types, {catalogue: {...CATALOGUE, RAWS: {ID: {abap: "I"}, K: {abap: "X", len: 16}}}});
    const find = async (inputs) => (await runProcedure(prog, {client, dialect, inputs,
      inputCatalogue: {...CATALOGUE, RAWS: {ID: {abap: "I"}, K: {abap: "X", len: 16}}}})).rows.map((r) => r.ID);
    expect(await find({IV_K: "0123456789abcdef0123456789abcdef"})).to.deep.equal([1]);
    expect(await find({IV_K: "00FF"})).to.deep.equal([2]);
    expect(await find({})).to.deep.equal([3]);
    let failure;
    try { await find({IV_K: "0123456789ABCDEF0123456789ABCDEF00"}); } catch (error) { failure = error; }
    expect(failure?.message).to.match(/IV_K is longer than its 16 bytes/);
    failure = undefined;
    try { await find({IV_K: "XYZ0"}); } catch (error) { failure = error; }
    expect(failure?.message).to.match(/IV_K is not a RAW value as hex text/);
  });

  it("a bare NULL in one UNION branch takes the other branch's type, and answers NULL", async () => {
    const prog = program("IMPORTING VALUE(it_rows) TYPE tt_rows EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, null as txt from dummy union all select id, txt from :it_rows where id = 5;");
    const {rows} = await run(prog, {}, {IT_ROWS: ROWS});
    expect(rows).to.deep.equal([{ID: 0, TXT: null}, {ID: 5, TXT: "five"}]);
  });

  it("a table as its own qualifier, and sys.dummy as the one-row source", async () => {
    const qualified = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select src.id, src.txt from src where src.id = 5;");
    expect((await run(qualified)).rows.map((r) => r.TXT)).to.deep.equal(["five"]);
    const dummy = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 7 as id, 'seven' as txt from sys.dummy;");
    expect((await run(dummy)).rows).to.deep.equal([{ID: 7, TXT: "seven"}]);
  });

  it("ABAP_BOOL, the type pool ABAP's c LENGTH 1, is bound as a CHAR 1", async () => {
    const prog = program("IMPORTING VALUE(iv_flag) TYPE abap_bool EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where :iv_flag = 'X';");
    expect(prog.parameters[0].type).to.include({abap: "C", len: 1});
    expect((await run(prog, {IV_FLAG: "X"})).rows).to.have.length(3);
    expect((await run(prog, {IV_FLAG: " "})).rows).to.deep.equal([]);
  });

  it("WITH: a chain of common table expressions, each seeing the ones before it", async () => {
    const prog = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      `et_rows = with small as (select id, txt from src where id < 10),
        smaller as (select id, txt from small where id > 1)
        select id, txt from smaller;`);
    expect((await run(prog)).rows.map((r) => r.ID)).to.deep.equal([5]);
  });

  it("WITH: a name defined twice is refused, and a CTE is not visible outside its select", () => {
    expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = with a as (select id, txt from src), a as (select id, txt from src) select id, txt from a;"))
      .to.throw(/WITH names a twice/);
    expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      `lt_x = with a as (select id, txt from src) select id, txt from a;
       et_rows = select id, txt from a;`)).to.throw(/not present|unknown|not a table/i);
  });

  it("WITH: a CTE shadows a table of the same name, a self-join on a CTE reads it twice, a column list renames", async () => {
    const shadow = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = with src as (select id, txt from src where id = 5) select id, txt from src;");
    expect((await run(shadow)).rows.map((r) => r.ID)).to.deep.equal([5]);
    const self = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      `et_rows = with s as (select id, txt from src where id < 10)
        select a.id, b.txt from s a inner join s b on a.id = b.id order by id;`);
    expect((await run(self)).rows.map((r) => [r.ID, r.TXT])).to.deep.equal([[1, "one"], [5, "five"]]);
    const renamed = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = with s (id, txt) as (select txt, id from src) select txt as id, id as txt from s where txt > 1 order by txt;");
    expect((await run(renamed)).rows.map((r) => r.ID)).to.deep.equal([5, 20]);
  });

  it("WITH: RECURSIVE, a column-count mismatch and a forward reference are refused by name", () => {
    const refuse = (body, message) => expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows", body)).to.throw(message);
    refuse("et_rows = with recursive a as (select id, txt from src) select id, txt from a;", /WITH RECURSIVE is not lowered/);
    refuse("et_rows = with a (x) as (select id, txt from src) select id, txt from src;", /names 1 column\(s\) for a select of 2/);
    refuse("et_rows = with a as (select id, txt from b), b as (select id, txt from src) select id, txt from a;", /CTE b used before it is defined/);
    refuse("et_rows = with a (id, id) as (select id, txt from src) select id, txt from src;", /names a column twice/);
    refuse("et_rows = select a.id, a.txt from src as a order by a.id;", /ORDER BY a qualified source column is not lowered yet/);
  });

  it("WITH: a name of a CTE defined later is still a table's, as in plain SQL", async () => {
    const prog = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = with a as (select id, txt from src where id = 1), src as (select id, txt from src where id = 5) select id, txt from a;");
    expect((await run(prog)).rows.map((r) => r.ID)).to.deep.equal([1]);
  });

  it("TOP n takes n rows after the ORDER BY, as HANA does", async () => {
    const prog = program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select top 2 id, txt from src order by id desc;");
    expect((await run(prog)).rows.map((r) => r.ID)).to.deep.equal([20, 5]);
    const param = program("IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select top :iv_n id, txt from src order by id;");
    expect((await run(param, {IV_N: 1})).rows.map((r) => r.ID)).to.deep.equal([1]);
  });

  it("TOP with LIMIT, TOP inside a UNION branch and a non-integer TOP are refused by name", () => {
    expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select top 2 id, txt from src order by id limit 1;")).to.throw(/both TOP and LIMIT/);
    expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select top 2 id, txt from src limit 1;")).to.throw(/both TOP and LIMIT/);
    expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select top 1 id, txt from src union all select id, txt from src;")).to.throw(/TOP inside a branch/);
    expect(() => program("EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select top 'x' id, txt from src order by id;")).to.throw(/TOP requires/);
  });
});

// A table parameter whose type the DICTIONARY declares (TTYP -> TABL), not
// the class, and a table function whose body is a whole BEGIN ... END ending
// in RETURN: the two shapes that took the runtime compiler from 0 to 13
// corpus bodies (2026-09-23), run as procedures, not only compiled.
const dtel = (name, datatype, leng) => `<abapGit><asx:abap><asx:values><DD04V><ROLLNAME>${name}</ROLLNAME><DATATYPE>${datatype}</DATATYPE><LENG>${String(leng).padStart(6, "0")}</LENG><DECIMALS>000000</DECIMALS></DD04V></asx:values></asx:abap></abapGit>`;
const tabl = (name, fields) => `<abapGit><asx:abap><asx:values><DD02V><TABNAME>${name}</TABNAME></DD02V><DD03P_TABLE>${fields.map(([f, e]) => `<DD03P><FIELDNAME>${f}</FIELDNAME><ROLLNAME>${e}</ROLLNAME></DD03P>`).join("")}</DD03P_TABLE></asx:values></asx:abap></abapGit>`;
const ttyp = (name, row) => `<abapGit><asx:abap><asx:values><DD40V><TYPENAME>${name}</TYPENAME><ROWTYPE>${row}</ROWTYPE><ROWKIND>S</ROWKIND></DD40V></asx:values></asx:abap></abapGit>`;
const DICT_CLASS = (signature, body, kind = "PROCEDURE") => `CLASS cl_d DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS m ${signature}.
ENDCLASS.
CLASS cl_d IMPLEMENTATION.
  METHOD m BY DATABASE ${kind} FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    ${body}
  ENDMETHOD.
ENDCLASS.`;

for (const {dialect, make} of ENGINES) describe(`dictionary-typed tables and a whole-body BEGIN ... END, as procedures on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  let dir;
  let store;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-proc-ddic-"));
    writeFileSync(join(dir, "zde_id.dtel.xml"), dtel("ZDE_ID", "INT4", 10));
    writeFileSync(join(dir, "zde_txt.dtel.xml"), dtel("ZDE_TXT", "CHAR", 10));
    writeFileSync(join(dir, "zde_clnt.dtel.xml"), dtel("ZDE_CLNT", "NUMC", 3));
    writeFileSync(join(dir, "zde_day.dtel.xml"), dtel("ZDE_DAY", "DATS", 8));
    writeFileSync(join(dir, "zs_row.tabl.xml"), tabl("ZS_ROW", [["ID", "ZDE_ID"], ["TXT", "ZDE_TXT"]]));
    writeFileSync(join(dir, "zt_rows.ttyp.xml"), ttyp("ZT_ROWS", "ZS_ROW"));
    writeFileSync(join(dir, "zs_clnt.tabl.xml"), tabl("ZS_CLNT", [["MANDT", "ZDE_CLNT"], ["ID", "ZDE_ID"]]));
    writeFileSync(join(dir, "zt_clnt.ttyp.xml"), ttyp("ZT_CLNT", "ZS_CLNT"));
    writeFileSync(join(dir, "zp_tf.ddls.asddls"), "define table function ZP_TF\n  returns {\n    id  : abap.int4;\n    txt : abap.char(10);\n  }\n  implemented by method cl_d=>m\n");
    writeFileSync(join(dir, "zt_elem.ttyp.xml"), ttyp("ZT_ELEM", "ZDE_ID"));
    writeFileSync(join(dir, "zs_broken.tabl.xml"), `<abapGit><asx:abap><asx:values><DD02V><TABNAME>ZS_BROKEN</TABNAME></DD02V><DD03P_TABLE><DD03P><FIELDNAME>ID</FIELDNAME><ROLLNAME>ZDE_ID</ROLLNAME></DD03P><DD03P><FIELDNAME>.INCLUDE</FIELDNAME><PRECFIELD>ZS_NOWHERE</PRECFIELD></DD03P></DD03P_TABLE></asx:values></asx:abap></abapGit>`);
    writeFileSync(join(dir, "zt_broken.ttyp.xml"), ttyp("ZT_BROKEN", "ZS_BROKEN"));
    store = new FolderDdic([dir]);
  });
  after(() => rmSync(dir, {recursive: true, force: true}));
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "SRC" ("ID" INTEGER, "TXT" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "SRC" VALUES (1, \'one\'), (5, \'five\'), (20, \'twenty\')', expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });

  const compile = (source, extra = {}) => {
    const {methods, types} = extract(source, "cl_d.clas.abap");
    return compileProcedure({...methods[0], ...extra}, types, {catalogue: CATALOGUE, store, resolveType: store.resolver()});
  };

  it("an IN and an OUT table typed by the dictionary run, the class declaring no types", async () => {
    const prog = compile(DICT_CLASS("IMPORTING VALUE(it_rows) TYPE zt_rows EXPORTING VALUE(et_rows) TYPE zt_rows",
      "et_rows = select id, txt from :it_rows where id > 1;"));
    const {rows} = await runProcedure(prog, {client, dialect, relationInputs: {IT_ROWS: scan("SRC")}, inputCatalogue: CATALOGUE});
    expect(rows.map((r) => r.ID)).to.deep.equal([5, 20]);
  });

  it("a dictionary table type with a field outside the measured datatypes is refused by name", () => {
    expect(() => compile(DICT_CLASS("IMPORTING VALUE(it_rows) TYPE zt_clnt EXPORTING VALUE(et_rows) TYPE zt_rows",
      "et_rows = select id, 'x' as txt from :it_rows;"))).to.throw(UnsupportedSqlScript, /table type zt_clnt: MANDT is NUMC, outside the measured portable datatypes/i);
  });

  it("a table function wrapped in BEGIN ... END answers through RETURN, its output typed from the DDLS RETURNS it names", async () => {
    const source = DICT_CLASS("FOR TABLE FUNCTION zp_tf", "BEGIN\n      lt = select id, txt from src where id <= 5;\n      RETURN select id, txt from :lt;\n    END;", "FUNCTION");
    // the signature is read off a real DDLS, not handed over
    const tf = parseTableFunction(store.read("DDLS", "ZP_TF").source);
    const prog = compile(source, {returns: tf.returns, parameters: tf.parameters});
    const {rows} = await runProcedure(prog, {client, dialect, inputCatalogue: CATALOGUE});
    expect(rows.map((r) => r.ID)).to.deep.equal([1, 5]);
  });

  it("a date input typed by a data element of the dictionary gets the date rule too", async () => {
    const prog = compile(DICT_CLASS("IMPORTING VALUE(iv_d) TYPE zde_day OPTIONAL EXPORTING VALUE(et_rows) TYPE zt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;"));
    expect(prog.parameters[0]).to.include({kind: "DATS", default: "00000000"});
    const {rows} = await runProcedure(prog, {client, dialect, inputs: {IV_D: ""}, inputCatalogue: CATALOGUE});
    expect(rows).to.deep.equal([{ID: 0, TXT: "00000000"}]);
  });

  it("refuses a dictionary table type whose row is a data element, or whose include does not resolve", () => {
    expect(() => compile(DICT_CLASS("IMPORTING VALUE(it_rows) TYPE zt_elem EXPORTING VALUE(et_rows) TYPE zt_rows", "et_rows = select 1 as id, 'x' as txt from dummy;")))
      .to.throw(UnsupportedSqlScript, /table type zt_elem: row type ZDE_ID is DTEL, not a structure/i);
    expect(() => compile(DICT_CLASS("IMPORTING VALUE(it_rows) TYPE zt_broken EXPORTING VALUE(et_rows) TYPE zt_rows", "et_rows = select 1 as id, 'x' as txt from dummy;")))
      .to.throw(UnsupportedSqlScript, /include ZS_NOWHERE did not resolve/);
  });

  it("unwraps a whole-body BEGIN SEQUENTIAL EXECUTION ... END, and still refuses a nested plain block", async () => {
    const prog = compile(DICT_CLASS("EXPORTING VALUE(et_rows) TYPE zt_rows",
      "BEGIN SEQUENTIAL EXECUTION\n      lt = select id, txt from src where id > 1;\n      et_rows = select id, txt from :lt;\n    END;"));
    const {rows} = await runProcedure(prog, {client, dialect, inputCatalogue: CATALOGUE});
    expect(rows.map((r) => r.ID)).to.deep.equal([5, 20]);
    expect(() => compile(DICT_CLASS("EXPORTING VALUE(et_rows) TYPE zt_rows",
      "et_rows = select id, txt from src;\n    BEGIN\n      et_rows = select id, txt from src;\n    END;")))
      .to.throw(UnsupportedSqlScript, /initial block support/);
  });

  it("refuses a bare NULL in a subquery of an IF condition: no untyped NULL escapes through a fragment", () => {
    expect(() => compile(DICT_CLASS("IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(et_rows) TYPE zt_rows",
      "IF :iv_n IN (select null as y from dummy) THEN\n      et_rows = select id, txt from src;\n    ELSE\n      et_rows = select id, txt from src where id = 1;\n    END IF;")))
      .to.throw(/NULL AS y has no type here/);
  });

  it("refuses a RETURN that is not the last statement", () => {
    const source = DICT_CLASS("FOR TABLE FUNCTION zp_tf", "RETURN select id, txt from src;\n    lt = select id, txt from src;", "FUNCTION");
    expect(() => compile(source, {returns: [{name: "id", abapType: "i"}, {name: "txt", abapType: "c LENGTH 10"}], parameters: []}))
      .to.throw(UnsupportedSqlScript, /Return is outside the initial portable procedural subset/);
  });

});
