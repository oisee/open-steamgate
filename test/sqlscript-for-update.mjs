// `FOR UPDATE`: a row lock until the LUW ends. Measured on HXE 2.00.088
// (docs/sqlscript-hana-observed.md, "FOR UPDATE"): the same rows as without
// it in SELECT ... INTO, a table variable, a cursor, after LIMIT, with OF
// and WAIT n; refused in a READ-ONLY procedure. The portable engines have
// one work process, so the lock changes nothing there and is not rendered.
import {expect} from "chai";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";

const CATALOGUE = {T: {ID: {abap: "I"}, N: {abap: "I"}}};
const TYPES = new Map([["TT", {kind: "table", of: "TY"}],
  ["TY", {kind: "structure", components: [{name: "id", abapType: "i"}, {name: "n", abapType: "i"}]}]]);
const scalar = (body, readOnly) => ({name: "M", kind: "METHOD", ...(readOnly ? {readOnly: true} : {}),
  parameters: [{name: "ev", direction: "OUT", abapType: "i"}], body});
const ENGINES = [["sqlite", () => new FileSqliteClient({path: ":memory:"})], ["duckdb", () => new DuckDBDatabaseClient()]];

describe("FOR UPDATE, as HANA Express took it", () => {
  it("is refused in a READ-ONLY method, in HANA's words", () => {
    expect(() => compileProcedure(scalar("SELECT n INTO ev FROM t WHERE id = 2 FOR UPDATE;", true), new Map(), {catalogue: CATALOGUE}))
      .to.throw(/SELECT statement with lock option is\/are not supported in read-only procedure/);
  });
  for (const [dialect, make] of ENGINES) {
    describe(`on ${dialect}`, () => {
      let client;
      beforeEach(async () => {
        client = make();
        await client.connect();
        await client.native({sql: 'CREATE TABLE "T" ("ID" INTEGER, "N" INTEGER)', expect: "none"});
        await client.native({sql: 'INSERT INTO "T" VALUES (1, 10), (2, 20)', expect: "none"});
      });
      afterEach(async () => { await client.disconnect(); });
      const value = async (body) => (await runProcedure(compileProcedure(scalar(body), new Map(), {catalogue: CATALOGUE}), {client, dialect})).value;
      // the values HXE answered for the same bodies
      it("SELECT ... INTO ... FOR UPDATE NOWAIT is 20", async () => {
        expect(await value("SELECT n INTO ev FROM t WHERE id = 2 FOR UPDATE NOWAIT;")).to.equal(20);
      });
      it("FOR UPDATE OF n WAIT 5 is 10", async () => {
        expect(await value("SELECT n INTO ev FROM t WHERE id = 1 FOR UPDATE OF n WAIT 5;")).to.equal(10);
      });
      it("after ORDER BY ... LIMIT 1 is 10", async () => {
        expect(await value("SELECT n INTO ev FROM t ORDER BY n LIMIT 1 FOR UPDATE NOWAIT;")).to.equal(10);
      });
      it("a cursor FOR UPDATE sums to 30", async () => {
        expect(await value("DECLARE CURSOR c FOR SELECT n FROM t ORDER BY n FOR UPDATE; ev = 0; FOR r AS c DO ev = :ev + r.n; END FOR;")).to.equal(30);
      });
      it("a table variable FOR UPDATE has the rows", async () => {
        const program = compileProcedure({name: "M", kind: "METHOD", parameters: [{name: "et", direction: "OUT", abapType: "tt"}],
          body: "et = SELECT id, n FROM t ORDER BY id FOR UPDATE;"}, TYPES, {catalogue: CATALOGUE});
        const out = await runProcedure(program, {client, dialect});
        expect(out.rows.map((r) => [Number(r.ID), Number(r.N)])).to.deep.equal([[1, 10], [2, 20]]);
      });
    });
  }
});
