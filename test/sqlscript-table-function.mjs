// A table function called in FROM runs as a nested call on every engine that
// has no object of that name: the callee's own program runs with the
// arguments of the moment and its relation stands where the call was
// (tools/sqlscript-procedure-ir.mjs, callTableFunction). HANA runs the same
// two bodies natively; what it answered is in the expectations (HXE
// 2.00.088, 2026-09-24: 2b; 3c,4d; 3c,4d; and 2b,4d with a table argument
// -- the same four calls).
import {expect} from "chai";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";

const TYPES = new Map([
  ["TT_ROWS", {kind: "table", of: "TY_ROW"}],
  ["TY_ROW", {kind: "structure", components: [{name: "id", abapType: "i"}, {name: "name", abapType: "string"}]}],
]);
const CATALOGUE = {T: {ID: {abap: "I"}, NAME: {abap: "STRING"}}};
// the callee: an AMDP function, RETURNING a table
const CALLEE = {name: "GET_ROWS", kind: "METHOD", dbKind: "FUNCTION", parameters: [
  {name: "iv_min", direction: "IN", abapType: "i"},
  {name: "iv_max", direction: "IN", abapType: "i", optional: true, default: 100},
  {name: "rt", direction: "RETURNING", abapType: "tt_rows"}],
body: "RETURN SELECT id, name FROM t WHERE id >= :iv_min AND id <= :iv_max;"};
const REGISTRY = {"CL_X=>GET_ROWS": {name: "CL_X=>GET_ROWS", source: "class",
  parameters: [{name: "IV_MIN", kind: "scalar", abapType: "i", type: {abap: "I"}},
    {name: "IV_MAX", kind: "scalar", abapType: "i", type: {abap: "I"}, optional: true}],
  returns: {ID: {abap: "I"}, NAME: {abap: "STRING"}}}};
// a callee that takes a table: the caller hands one of its table variables
const FROM_ROWS = {name: "FROM_ROWS", kind: "METHOD", dbKind: "FUNCTION", parameters: [
  {name: "it_rows", direction: "IN", abapType: "tt_rows"},
  {name: "iv_min", direction: "IN", abapType: "i"},
  {name: "rt", direction: "RETURNING", abapType: "tt_rows"}],
body: "RETURN SELECT id, name FROM :it_rows WHERE id > :iv_min;"};
REGISTRY["CL_X=>FROM_ROWS"] = {name: "CL_X=>FROM_ROWS", source: "class",
  parameters: [{name: "IT_ROWS", kind: "table", abapType: "tt_rows", schema: {ID: {abap: "I"}, NAME: {abap: "STRING"}}},
    {name: "IV_MIN", kind: "scalar", abapType: "i", type: {abap: "I"}}],
  returns: {ID: {abap: "I"}, NAME: {abap: "STRING"}}};
const callerOf = (body) => ({name: "M", kind: "METHOD", parameters: [
  {name: "iv_from", direction: "IN", abapType: "i"}, {name: "et", direction: "OUT", abapType: "tt_rows"}], body});

const ENGINES = [["sqlite", () => new FileSqliteClient({path: ":memory:"})], ["duckdb", () => new DuckDBDatabaseClient()]];

for (const [dialect, make] of ENGINES) {
  describe(`a table function called in FROM, on ${dialect}`, () => {
    let client;
    beforeEach(async () => {
      client = make();
      await client.connect();
      await client.native({sql: 'CREATE TABLE "T" ("ID" INTEGER, "NAME" VARCHAR(10))', expect: "none"});
      await client.native({sql: `INSERT INTO "T" VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')`, expect: "none"});
    });
    afterEach(async () => { await client.disconnect(); });
    const run = async (body, inputs) => {
      const callee = compileProcedure(CALLEE, TYPES, {catalogue: CATALOGUE});
      const program = compileProcedure(callerOf(body), TYPES, {catalogue: CATALOGUE, tableFunctions: REGISTRY});
      const fromRows = compileProcedure(FROM_ROWS, TYPES, {catalogue: CATALOGUE});
      const out = await runProcedure(program, {client, dialect, inputs,
        procedures: new Map([["CL_X=>GET_ROWS", callee], ["CL_X=>FROM_ROWS", fromRows]])});
      return out.rows.map((r) => `${Number(r.ID)}${r.NAME}`);
    };

    it("answers the callee's rows for the arguments of this call, joined and filtered like a table", async () => {
      expect(await run('et = SELECT f.id, f.name FROM "CL_X=>GET_ROWS"(:iv_from, 3) AS f WHERE f.name <> \'c\' ORDER BY id;', {IV_FROM: 2}))
        .to.deep.equal(["2b"]);
    });
    it("takes the callee's DEFAULT for a trailing argument left out", async () => {
      expect(await run('et = SELECT id, name FROM "CL_X=>GET_ROWS"(:iv_from) ORDER BY id;', {IV_FROM: 3})).to.deep.equal(["3c", "4d"]);
    });
    it("runs the call with the variables as they are when the statement runs", async () => {
      expect(await run(`DECLARE n INTEGER = 1; n = :n + 2;
        et = SELECT id, name FROM "CL_X=>GET_ROWS"(:n) ORDER BY id;`, {IV_FROM: 0})).to.deep.equal(["3c", "4d"]);
    });
    it("hands a table variable of the caller to a table parameter of the callee", async () => {
      expect(await run(`lt = SELECT id, name FROM t WHERE id <> 3;
        et = SELECT id, name FROM "CL_X=>FROM_ROWS"(:lt, :iv_from) ORDER BY id;`, {IV_FROM: 1})).to.deep.equal(["2b", "4d"]);
    });
    it("refuses a callee the run was not given, by name", async () => {
      const program = compileProcedure(callerOf('et = SELECT id, name FROM "CL_X=>GET_ROWS"(1);'), TYPES, {catalogue: CATALOGUE, tableFunctions: REGISTRY});
      let error;
      try { await runProcedure(program, {client, dialect, inputs: {IV_FROM: 1}}); } catch (e) { error = e; }
      expect(error?.message).to.match(/table function CL_X=>GET_ROWS is not in the portable registry/);
    });
  });
}
