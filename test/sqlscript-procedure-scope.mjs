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
import {runProcedure, UnsupportedSqlScript, Int2OutOfRange, SelectIntoRows} from "../tools/sqlscript-procedure-ir.mjs";
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

  it("OPTIONAL on a scalar is refused in the kernel's words, on a table as not carried yet; a DEFAULT string takes its literal", async () => {
    // measured on A4H (docs/sqlscript-hana-observed.md): only DEFAULT makes
    // an AMDP scalar input optional, and an OPTIONAL table arrives empty
    expect(() => program("IMPORTING VALUE(iv_limit) TYPE i OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where id <= :iv_limit;"))
      .to.throw(UnsupportedSqlScript, /Use DEFAULT instead of OPTIONAL for the optional parameter "IV_LIMIT" of the AMDP method "M"/);
    expect(() => program("IMPORTING VALUE(it_rows) TYPE tt_rows OPTIONAL EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from :it_rows;"))
      .to.throw(UnsupportedSqlScript, /OPTIONAL table input it_rows: omitted it is an empty table \(measured on A4H\); not carried yet/);
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
    const prog = program("IMPORTING VALUE(iv_txt) TYPE c LENGTH 10 EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where txt = :iv_txt;");
    expect((await run(prog, {IV_TXT: "five"})).rows.map((r) => r.ID)).to.deep.equal([5]);
    expect((await run(prog, {IV_TXT: "five      "})).rows.map((r) => r.ID)).to.deep.equal([5]);
    expect((await run(prog, {IV_TXT: " five"})).rows).to.deep.equal([]);
    expect((await run(prog, {IV_TXT: ""})).rows).to.deep.equal([]);
    const initial = program("IMPORTING VALUE(iv_txt) TYPE c LENGTH 10 EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, case when :iv_txt = '' then 'empty' else 'not' end as txt from dummy;");
    expect((await run(initial, {IV_TXT: "          "})).rows).to.deep.equal([{ID: 0, TXT: "empty"}]);
    const defaulted = program("IMPORTING VALUE(iv_txt) TYPE c LENGTH 10 DEFAULT 'one  ' EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, txt from src where txt = :iv_txt;");
    // the compiled DEFAULT is already right-trimmed, not only at the bind
    expect(defaulted.parameters[0].default).to.equal("one");
    expect((await run(defaulted)).rows.map((r) => r.ID)).to.deep.equal([1]);
  });

  it("an initial date or time input is its zero digits, not '' (measured on A4H)", async () => {
    const dated = program("IMPORTING VALUE(iv_d) TYPE d EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;");
    expect((await run(dated, {IV_D: "20260923"})).rows).to.deep.equal([{ID: 0, TXT: "20260923"}]);
    const timed = program("IMPORTING VALUE(iv_t) TYPE t EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select 0 as id, :iv_t as txt from dummy;");
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
    const {methods, types} = extract(CLASS("IMPORTING VALUE(iv_k) TYPE x LENGTH 16 EXPORTING VALUE(et_rows) TYPE tt_rows",
      "et_rows = select id, 'x' as txt from raws where k = :iv_k;"), "cl_t.clas.abap");
    const prog = compileProcedure(methods[0], types, {catalogue: {...CATALOGUE, RAWS: {ID: {abap: "I"}, K: {abap: "X", len: 16}}}});
    const find = async (inputs) => (await runProcedure(prog, {client, dialect, inputs,
      inputCatalogue: {...CATALOGUE, RAWS: {ID: {abap: "I"}, K: {abap: "X", len: 16}}}})).rows.map((r) => r.ID);
    expect(await find({IV_K: "0123456789abcdef0123456789abcdef"})).to.deep.equal([1]);
    expect(await find({IV_K: "00FF"})).to.deep.equal([2]);
    expect(await find({IV_K: ""})).to.deep.equal([3]);
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
    const prog = compile(DICT_CLASS("IMPORTING VALUE(iv_d) TYPE zde_day EXPORTING VALUE(et_rows) TYPE zt_rows",
      "et_rows = select 0 as id, :iv_d as txt from dummy;"));
    expect(prog.parameters[0]).to.include({kind: "DATS"});
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

// INT2 as measured on A4H (docs/sqlscript-hana-observed.md): exact across its
// range in and out, arithmetic promoted to INTEGER inside the body, and a
// value outside the range raised at the output boundary, never wrapped
const INT2_CLASS = (signature, body) => `CLASS cl_s DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    TYPES: BEGIN OF ty_small, n TYPE int2, END OF ty_small.
    TYPES tt_small TYPE STANDARD TABLE OF ty_small WITH EMPTY KEY.
    TYPES: BEGIN OF ty_wide, v TYPE i, END OF ty_wide.
    TYPES tt_wide TYPE STANDARD TABLE OF ty_wide WITH EMPTY KEY.
    CLASS-METHODS m ${signature}.
ENDCLASS.
CLASS cl_s IMPLEMENTATION.
  METHOD m BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    ${body}
  ENDMETHOD.
ENDCLASS.`;

for (const {dialect, make} of ENGINES) describe(`INT2 as measured on A4H, as procedures on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "SRC" ("ID" INTEGER, "TXT" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "SRC" VALUES (1, \'one\')', expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });
  const program = (signature, body) => {
    const {methods, types} = extract(INT2_CLASS(signature, body), "cl_s.clas.abap");
    return compileProcedure(methods[0], types, {catalogue: CATALOGUE});
  };
  const run = (prog, inputs = {}) => runProcedure(prog, {client, dialect, inputs, relationInputs: {}, inputCatalogue: CATALOGUE});

  it("an INT2 input arrives exactly at both ends of its range, and its arithmetic is INTEGER's", async () => {
    const prog = program("IMPORTING VALUE(iv) TYPE int2 EXPORTING VALUE(et) TYPE tt_wide",
      "et = select :iv + :iv as v from src;");
    expect(prog.parameters[0].type).to.deep.equal({abap: "I", bits: 16});
    for (const [given, doubled] of [[-32768, -65536], [32767, 65534], [0, 0]]) {
      expect((await run(prog, {IV: given})).rows.map((r) => Number(r.V))).to.deep.equal([doubled]);
    }
  });

  it("INT2 arithmetic is INTEGER's in the IR: a sum of INT2 inputs assigns to an INTEGER scalar and is not capped", async () => {
    const prog = program("IMPORTING VALUE(iv) TYPE int2 RETURNING VALUE(rv) TYPE i", "rv = :iv + :iv;");
    expect((await runProcedure(prog, {inputs: {IV: 32767}})).value).to.equal(65534);
  });

  it("an omitted INT2 DEFAULT takes its literal, and a DEFAULT outside the range is not a value it can hold", async () => {
    const prog = program("IMPORTING VALUE(iv) TYPE int2 DEFAULT 5 EXPORTING VALUE(et) TYPE tt_small",
      "et = select :iv as n from src;");
    expect((await run(prog)).rows.map((r) => Number(r.N))).to.deep.equal([5]);
    const wide = program("IMPORTING VALUE(iv) TYPE int2 DEFAULT 40000 EXPORTING VALUE(et) TYPE tt_small",
      "et = select :iv as n from src;");
    let caught;
    try { await run(wide); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Int2OutOfRange);
  });

  it("INT1 is refused by name on every path until measured: a data element, a CDS built-in, a signature scalar", async () => {
    const {scalarTypeOf, irTypeOfDdic} = await import("../tools/sqlscript/scalar-types.mjs");
    expect(() => irTypeOfDdic({DATATYPE: "INT1", LENG: 3}, "ZDE_BYTE")).to.throw(/ZDE_BYTE: INT1 is not measured yet/);
    expect(() => scalarTypeOf("abap.int1")).to.throw(/INT1 is not measured yet/);
    expect(() => scalarTypeOf("zde_byte", () => ({DATATYPE: "INT1", LENG: 3, DECIMALS: 0}))).to.throw(/INT1 is not measured yet/);
    expect(() => program("IMPORTING VALUE(iv) TYPE int1 EXPORTING VALUE(et) TYPE tt_small", "et = select 1 as n from src;")).to.throw();
  });

  it("a CAST to SMALLINT or TINYINT is refused until measured", () => {
    for (const name of ["smallint", "tinyint"]) {
      expect(() => program("IMPORTING VALUE(iv) TYPE i EXPORTING VALUE(et) TYPE tt_small",
        `et = select cast(:iv as ${name}) as n from src;`)).to.throw(new RegExp(`the SQL type ${name.toUpperCase()} is not measured yet`));
    }
  });

  it("an INT2 input outside the range is refused, as an ABAP int2 can never carry one", async () => {
    const prog = program("IMPORTING VALUE(iv) TYPE int2 EXPORTING VALUE(et) TYPE tt_wide",
      "et = select :iv as v from src;");
    for (const bad of [32768, -32769, 1.5]) {
      let caught;
      try { await run(prog, {IV: bad}); } catch (error) { caught = error; }
      expect(caught, String(bad)).to.be.instanceOf(Int2OutOfRange);
    }
  });

  it("an INTEGER into an INT2 output column is kept inside the range and raised outside it, never wrapped", async () => {
    const prog = program("IMPORTING VALUE(iv_i) TYPE i EXPORTING VALUE(et) TYPE tt_small",
      "et = select :iv_i as n from src;");
    for (const kept of [32767, -32768]) expect((await run(prog, {IV_I: kept})).rows.map((r) => Number(r.N))).to.deep.equal([kept]);
    for (const bad of [32768, 40000, -40000, 65536]) {
      let caught;
      try { await run(prog, {IV_I: bad}); } catch (error) { caught = error; }
      expect(caught, String(bad)).to.be.instanceOf(Int2OutOfRange);
      expect(caught.message).to.contain("CX_AMDP_EXECUTION_FAILED");
    }
  });

  it("a sum of two INT2 inputs that leaves the range raises at the INT2 output, as on A4H", async () => {
    const prog = program("IMPORTING VALUE(iv) TYPE int2 EXPORTING VALUE(et) TYPE tt_small",
      "et = select :iv + :iv as n from src;");
    expect((await run(prog, {IV: 100})).rows.map((r) => Number(r.N))).to.deep.equal([200]);
    let caught;
    try { await run(prog, {IV: 20000}); } catch (error) { caught = error; }
    expect(caught).to.be.instanceOf(Int2OutOfRange);
  });
});

// SELECT ... INTO as measured on A4H (docs/sqlscript-hana-observed.md): one
// row assigns, none raises unless DEFAULT is given, two raise always, a NULL
// assigns NULL, several columns fill several scalars; COUNT is BIGINT and
// assigns to an INTEGER scalar
for (const {dialect, make} of ENGINES) describe(`SELECT ... INTO as measured on A4H, as procedures on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "SRC" ("ID" INTEGER, "TXT" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "SRC" VALUES (1, \'one\'), (5, \'five\'), (20, \'twenty\')', expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });
  const program = (body, signature = "IMPORTING VALUE(iv) TYPE i RETURNING VALUE(rv) TYPE i") => {
    const {methods, types} = extract(CLASS(signature, body), "cl_t.clas.abap");
    return compileProcedure(methods[0], types, {catalogue: CATALOGUE});
  };
  const run = (prog, iv) => runProcedure(prog, {client, dialect, inputs: {IV: iv}, inputCatalogue: CATALOGUE});
  const raises = async (prog, iv) => {
    let caught;
    try { await run(prog, iv); } catch (error) { caught = error; }
    return caught;
  };

  it("one row assigns its columns, in order, to declared scalars", async () => {
    const one = program("DECLARE lv INTEGER; SELECT id INTO lv FROM src WHERE id = :iv; rv = :lv;");
    expect((await run(one, 5)).value).to.equal(5);
    const two = program("DECLARE la INTEGER; DECLARE lb INTEGER; SELECT id, id * 10 INTO la, lb FROM src WHERE id = :iv; rv = :la + :lb;");
    expect((await run(two, 5)).value).to.equal(55);
  });

  it("no row raises, as HANA does, unless DEFAULT is given; two rows raise even with DEFAULT", async () => {
    const plain = program("SELECT id INTO rv FROM src WHERE id = :iv;");
    expect(await raises(plain, 7)).to.be.instanceOf(SelectIntoRows).and.have.property("message").that.match(/found no row/);
    expect(await raises(plain, 5)).to.be.undefined;
    const many = program("SELECT id INTO rv FROM src WHERE id > :iv;");
    expect((await raises(many, 0))?.message).to.match(/found more than one row/);
    const defaulted = program("SELECT id INTO rv DEFAULT 42 FROM src WHERE id = :iv;");
    expect((await run(defaulted, 7)).value).to.equal(42);
    expect((await run(defaulted, 5)).value).to.equal(5);
    const defaultedMany = program("SELECT id INTO rv DEFAULT 42 FROM src WHERE id > :iv;");
    expect(await raises(defaultedMany, 0)).to.be.instanceOf(SelectIntoRows);
  });

  it("a BIGINT into an INTEGER scalar is range-checked: 2147483647 fits, 2147483648 is refused", async () => {
    const edge = program("SELECT count(*) * 2147483647 AS n INTO rv FROM src WHERE id = :iv;");
    expect((await run(edge, 5)).value).to.equal(2147483647);
    const over = program("SELECT count(*) * 2147483647 + count(*) AS n INTO rv FROM src WHERE id = :iv;");
    expect((await raises(over, 5))?.message).to.match(/2147483648 does not fit an INTEGER/);
    const big = program("SELECT count(*) * 1000000000 AS n INTO rv FROM src;");
    expect((await raises(big, 0))?.message).to.match(/3000000000 does not fit an INTEGER/);
  });

  it("a NULL in the one row assigns NULL", async () => {
    const nulled = program("SELECT CASE WHEN id = 5 THEN NULL ELSE id END AS n INTO rv FROM src WHERE id = :iv;");
    expect((await run(nulled, 5)).value).to.equal(null);
    expect((await run(nulled, 1)).value).to.equal(1);
  });

  it("COUNT is BIGINT and fills an INTEGER scalar, always one row; MAX of no rows is NULL", async () => {
    const counted = program("SELECT count(*) INTO rv FROM src WHERE id > :iv;");
    expect((await run(counted, 100)).value).to.equal(0);
    expect((await run(counted, 0)).value).to.equal(3);
    const maxed = program("SELECT max(id) INTO rv FROM src WHERE id > :iv;");
    expect((await run(maxed, 0)).value).to.equal(20);
    expect((await run(maxed, 100)).value).to.equal(null);
  });

  it("refuses a target that is not declared, a type that differs, a count that differs, and INTO where rows are wanted", () => {
    expect(() => program("SELECT id INTO nobody FROM src WHERE id = :iv; rv = 1;")).to.throw(/SELECT \.\.\. INTO undeclared scalar NOBODY/);
    expect(() => program("SELECT txt INTO rv FROM src WHERE id = :iv;")).to.throw(/column 1 \(TXT\) is C, the scalar I; not an identical measured type/);
    expect(() => program("SELECT id, txt INTO rv FROM src WHERE id = :iv;")).to.throw(/names 1 target\(s\) for 2 column\(s\)/);
    // the `*` of count(*) is not a SELECT *: three columns into two targets
    expect(() => program("DECLARE la INTEGER; SELECT id, max(id) AS m, count(*) AS c INTO rv, la FROM src WHERE id = :iv GROUP BY id;"))
      .to.throw(/names 2 target\(s\) for 3 column\(s\)/);
    // two items of one name are refused where the select is bound, for every relation
    expect(() => program("DECLARE la INTEGER; SELECT id, id INTO rv, la FROM src WHERE id = :iv;")).to.throw(/2 items under 1 distinct names \(ID twice\)/);
    expect(() => program("DECLARE la INTEGER; SELECT count(*), count(*) INTO rv, la FROM src;")).to.throw(/2 items under 1 distinct names \(V twice, an unnamed expression\)/);
    // DEFAULT values must be one per target
    expect(() => program("DECLARE la INTEGER; SELECT id, id * 2 AS d INTO rv, la DEFAULT 1 FROM src WHERE id = :iv;")).to.throw(/1 DEFAULT value\(s\) for 2 target\(s\)/);
    // a BIGINT fills a plain INTEGER only, never an INT2
    expect(() => program("SELECT count(*) INTO rv FROM src;", "RETURNING VALUE(rv) TYPE int2")).to.throw(/column 1 \(V\) is INT8, the scalar I; not an identical measured type/);
    expect(() => program("et_rows = select id, txt into rv from src;", "EXPORTING VALUE(et_rows) TYPE tt_rows")).to.throw(/SELECT \.\.\. INTO fills scalars; it is a statement, not a relation/);
  });
});

// several OUT tables, as measured on A4H (docs/sqlscript-hana-observed.md):
// an OUT the path taken did not assign is an empty table, an OUT assigned
// nowhere does not compile, and an OUT may be read and assigned again
const MULTI_CLASS = (signature, body) => `CLASS cl_m DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    TYPES: BEGIN OF ty_n, n TYPE i, END OF ty_n.
    TYPES tt_n TYPE STANDARD TABLE OF ty_n WITH EMPTY KEY.
    TYPES: BEGIN OF ty_t, txt TYPE c LENGTH 10, END OF ty_t.
    TYPES tt_t TYPE STANDARD TABLE OF ty_t WITH EMPTY KEY.
    CLASS-METHODS m ${signature}.
ENDCLASS.
CLASS cl_m IMPLEMENTATION.
  METHOD m BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    ${body}
  ENDMETHOD.
ENDCLASS.`;

for (const {dialect, make} of ENGINES) describe(`several OUT tables as measured on A4H, as procedures on ${dialect}`, function () {
  this.timeout(30000);
  let client;
  beforeEach(async () => {
    client = make();
    await client.connect();
    await client.native({sql: 'CREATE TABLE "SRC" ("ID" INTEGER, "TXT" VARCHAR)', expect: "none"});
    await client.native({sql: 'INSERT INTO "SRC" VALUES (1, \'one\'), (5, \'five\')', expect: "none"});
  });
  afterEach(async () => { await client.disconnect(); });
  const program = (signature, body) => {
    const {methods, types} = extract(MULTI_CLASS(signature, body), "cl_m.clas.abap");
    return compileProcedure(methods[0], types, {catalogue: CATALOGUE});
  };
  const run = (prog, inputs = {}) => runProcedure(prog, {client, dialect, inputs, inputCatalogue: CATALOGUE});
  const values = (answer, name, column) => answer.outputs[name].rows.map((r) => r[column]);

  it("each OUT is what the path assigned, and an OUT the path left alone is empty", async () => {
    const prog = program("IMPORTING VALUE(iv) TYPE i EXPORTING VALUE(et_a) TYPE tt_n VALUE(et_t) TYPE tt_t",
      `IF :iv = 1 THEN
         et_a = select id as n from src;
       ELSE
         et_a = select id as n from src where id > 1;
         et_t = select txt from src;
       END IF;`);
    expect(prog.outputs.map((one) => one.name)).to.deep.equal(["ET_A", "ET_T"]);
    const first = await run(prog, {IV: 1});
    expect(values(first, "ET_A", "N").sort()).to.deep.equal([1, 5]);
    expect(first.outputs.ET_T.rows).to.deep.equal([]);
    const second = await run(prog, {IV: 2});
    expect(values(second, "ET_A", "N")).to.deep.equal([5]);
    expect(values(second, "ET_T", "TXT").sort()).to.deep.equal(["five", "one"]);
  });

  it("an OUT may be read in the body and assigned again; the reader sees the value before", async () => {
    const prog = program("EXPORTING VALUE(et_a) TYPE tt_n VALUE(et_b) TYPE tt_n",
      `et_a = select id as n from src;
       et_b = select n * 10 as n from :et_a;
       et_a = select n from :et_a where n = 5;`);
    const answer = await run(prog);
    expect(values(answer, "ET_A", "N")).to.deep.equal([5]);
    expect(values(answer, "ET_B", "N").sort((a, b) => a - b)).to.deep.equal([10, 50]);
  });

  it("refuses an OUT assigned nowhere, in HANA's words, and a scalar OUT beside table OUTs", () => {
    expect(() => program("EXPORTING VALUE(et_a) TYPE tt_n VALUE(et_b) TYPE tt_n", "et_a = select id as n from src;"))
      .to.throw(UnsupportedSqlScript, /some out table variable is not assigned: ET_B/);
    expect(() => program("EXPORTING VALUE(ev) TYPE i VALUE(et_a) TYPE tt_n", "et_a = select id as n from src; ev = 1;"))
      .to.throw(UnsupportedSqlScript, /a scalar OUT beside table OUTs is not carried yet/);
  });
});
