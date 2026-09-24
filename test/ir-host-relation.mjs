// Host relations (tools/ir-host-relation.mjs): a table the host holds, handed
// to a plan as a relation -- the contract agreed with the Go runtime, whose
// client answers it with a SQLite virtual table. Run on DuckDB and SQLite:
// the values as ABAP means them, the caller's order, the drop, and the same
// answers the union of single-row selects gives.
import {expect} from "chai";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";
import {hostRelation, hostPlan, objectRows, abapTableRows, carries, ORDINAL} from "../tools/ir-host-relation.mjs";
import {WriteError} from "../tools/ir-writes.mjs";
import {lower} from "../tools/sqlscript-lower.mjs";
import {T, lit, col, bin, project, filter, order, scan, union} from "../tools/sqlscript-ir.mjs";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure} from "../tools/sqlscript-procedure-ir.mjs";
import {readFileSync} from "node:fs";
import {SCHEMA as PAIR_SCHEMA, PAIRS_FILE, render} from "../tools/ir-host-relation-pairs.mjs";

const SCHEMA = {MANDT: T.char(3), ID: T.int, BIG: T.int8, AMOUNT: T.dec(15, 2), DAY: T.date, NOTE: T.str};

// the text of each value as ABAP holds it, whatever the engine hands back
const text = (v) => (v === null || v === undefined ? "NULL" : typeof v === "bigint" ? v.toString() : String(v));
const amount = (dialect, v) => (dialect === "sqlite" ? Number(v).toFixed(2) : String(v));

for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})],
  ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
  describe(`host relations on ${dialect}`, function () {
    this.timeout(60000);
    let client;
    beforeEach(async () => { client = make(); await client.connect(); });
    afterEach(async () => { await client.disconnect(); });

    const read = async (handle, extra = "") => (await client.native({
      sql: `SELECT "MANDT", "ID", CAST("BIG" AS VARCHAR) AS "BIG", ${dialect === "sqlite" ? '"AMOUNT"' : 'CAST("AMOUNT" AS VARCHAR) AS "AMOUNT"'}, "DAY", "NOTE", "${ORDINAL}" FROM ${client.relationRef(handle)}${extra} ORDER BY "${ORDINAL}"`,
      expect: "rows"})).rows;

    it("holds every value as ABAP means it, in the caller's order, numbered from 0", async () => {
      const rows = objectRows([
        {mandt: "001", id: 3, big: 9007199254740993n, amount: "12.5", day: "20260924", note: "three"},
        {mandt: "001 ", id: 1, big: -5, amount: 3, day: "", note: ""},
        {MANDT: "002", ID: 2, BIG: "12", AMOUNT: "0.5-", DAY: "20261231", NOTE: "two"},
      ]);
      const handle = await hostRelation(client, dialect, {name: "IT", schema: SCHEMA, rows});
      const got = (await read(handle)).map((r) => [r.MANDT, Number(r.ID), text(r.BIG), amount(dialect, r.AMOUNT), r.DAY, r.NOTE, Number(r[ORDINAL])]);
      expect(got).to.deep.equal([
        // INT8 past 2^53 exact; a date left blank is '00000000'; CHAR right-trimmed; '0.5-' is -0.50
        ["001", 3, "9007199254740993", "12.50", "20260924", "three", 0],
        ["001", 1, "-5", "3.00", "00000000", "", 1],
        ["002", 2, "12", "-0.50", "20261231", "two", 2],
      ]);
      await client.dropRelation(handle);
    });

    it("gives a field the row does not name its initial value, and refuses a NULL", async () => {
      const handle = await hostRelation(client, dialect, {name: "IT", schema: SCHEMA, rows: objectRows([{id: 7}])});
      const [r] = await read(handle);
      expect([r.MANDT, Number(r.ID), text(r.BIG), amount(dialect, r.AMOUNT), r.DAY, r.NOTE]).to.deep.equal(["", 7, "0", "0.00", "00000000", ""]);
      await client.dropRelation(handle);
      let caught;
      try { await hostRelation(client, dialect, {name: "IT", schema: SCHEMA, rows: objectRows([{id: null}])}); } catch (error) { caught = error; }
      expect(caught).to.be.instanceOf(WriteError);
      expect(caught.message).to.match(/row 0 column ID: get\(\) answered null/);
    });

    it("carries 5000 rows, past the union's limits, in the caller's order", async () => {
      const list = Array.from({length: 5000}, (_, i) => ({mandt: "001", id: (i * 7919) % 5000, amount: `${i}.25`}));
      const handle = await hostRelation(client, dialect, {name: "IT", schema: SCHEMA, rows: objectRows(list)});
      const got = await read(handle);
      expect(got).to.have.length(5000);
      expect(got.map((r) => Number(r.ID))).to.deep.equal(list.map((r) => r.id));
      await client.dropRelation(handle);
    });

    it("answers a query as the union of single-row selects does", async () => {
      const list = [{mandt: "001", id: 3, amount: "10.00"}, {mandt: "001", id: 1, amount: "2.50"}, {mandt: "002", id: 2, amount: "7.75"}];
      const small = {MANDT: T.char(3), ID: T.int, AMOUNT: T.dec(15, 2)};
      const handle = await hostRelation(client, dialect, {name: "IT", schema: small, rows: objectRows(list)});
      const unionPlan = union(list.map((r) => project(scan("DUMMY"), [
        {as: "MANDT", expr: lit(r.mandt, small.MANDT)}, {as: "ID", expr: lit(r.id, small.ID)}, {as: "AMOUNT", expr: lit(r.amount, small.AMOUNT)}])), true);
      const query = (source) => order(project(filter(source, bin(">", bin("*", col("AMOUNT", small.AMOUNT), lit(2, T.int), small.AMOUNT), lit("5.00", small.AMOUNT), T.bool)),
        [{as: "ID", expr: col("ID", small.ID)}, {as: "AMOUNT", expr: col("AMOUNT", small.AMOUNT)}]), [{col: "ID", desc: false}]);
      const run = async (plan) => (await client.native({...lower(plan, dialect, {relationRef: (h) => client.relationRef(h)}), expect: "rows"})).rows
        .map((r) => [Number(r.ID), Number(r.AMOUNT).toFixed(2)]);
      const viaHost = await run(query(hostPlan(handle, small)));
      expect(viaHost).to.deep.equal([[2, "7.75"], [3, "10.00"]]);
      expect(viaHost).to.deep.equal(await run(query(unionPlan)));
      await client.dropRelation(handle);
    });

    it("walks a FOR cursor over an IN table in the caller's order", async () => {
      const types = new Map([["TT", {kind: "table", of: "TY"}],
        ["TY", {kind: "structure", components: [{name: "n", abapType: "i"}, {name: "k", abapType: "i"}]}]]);
      const sig = {name: "M", kind: "METHOD", parameters: [
        {name: "it", direction: "IN", abapType: "tt"}, {name: "ev", direction: "OUT", abapType: "string"}]};
      const program = compileProcedure({...sig, body: `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n, k FROM :it;
        FOR r AS c DO v = :v || r.n || ','; END FOR; ev = :v;`}, types, {});
      const schema = {N: T.int, K: T.int};
      const handle = await hostRelation(client, dialect, {name: "IT", schema, rows: objectRows([{n: 3, k: 30}, {n: 1, k: 10}, {n: 2, k: 20}])});
      const out = await runProcedure(program, {client, dialect, relationInputs: {IT: hostPlan(handle, schema)}});
      expect(out.value).to.equal("3,1,2,");
      expect(out.trace.order[0].order).to.equal("inherited(the caller's rows of :it)");
      await client.dropRelation(handle);
    });

    it("holds and answers what the pairs file says (the Go virtual table's spec)", async () => {
      const file = JSON.parse(readFileSync(PAIRS_FILE, "utf8"));
      for (const one of file.pairs) {
        const handle = await hostRelation(client, dialect, {name: "IT", schema: PAIR_SCHEMA, rows: objectRows(one.rows)});
        const heldRows = (await read(handle)).map((r) => [r.MANDT, String(r.ID), text(r.BIG), amount(dialect, r.AMOUNT), r.DAY, r.NOTE, String(r[ORDINAL])]);
        expect(heldRows, one.name).to.deep.equal(one.held);
        if (one.lowered !== undefined) {
          // the file's own SQL, the relation's name put where "IT" stands
          const {sql, params} = one.lowered[dialect];
          const rows = (await client.native({sql: sql.split('"IT"').join(client.relationRef(handle)), params, expect: "rows"})).rows;
          const got = rows.map((r) => Object.entries(r).map(([k, v]) => (k === "AMOUNT" ? amount(dialect, v) : text(v))));
          expect(got, one.name).to.deep.equal(one.answer);
        }
        await client.dropRelation(handle);
      }
    });

    it("drops twice without an error, and the table is gone after the first", async () => {
      const handle = await hostRelation(client, dialect, {name: "IT", schema: {ID: T.int}, rows: objectRows([{id: 1}])});
      await client.dropRelation(handle);
      await client.dropRelation(handle);
      let caught;
      try { await client.native({sql: `SELECT * FROM ${client.relationRef(handle)}`, expect: "rows"}); } catch (error) { caught = error; }
      expect(caught).to.be.an("error");
    });
  });
}

describe("host relations: what travels and what does not", () => {
  it("the pairs file is current (node tools/ir-host-relation-pairs.mjs writes it)", () => {
    expect(readFileSync(PAIRS_FILE, "utf8")).to.equal(render());
  });

  it("answers undefined for a type the contract does not carry, and for a client without ddl relations", async () => {
    expect(carries({ID: T.int, RAW: T.bytes(16)}, "duckdb")).to.equal(false);
    const client = new DuckDBDatabaseClient({path: ":memory:"});
    await client.connect();
    try {
      expect(await hostRelation(client, "duckdb", {schema: {RAW: T.bytes(16)}, rows: objectRows([{}])})).to.equal(undefined);
      expect(await hostRelation({native: async () => ({})}, "duckdb", {schema: {ID: T.int}, rows: objectRows([])})).to.equal(undefined);
    } finally { await client.disconnect(); }
  });

  it("refuses a schema with a column named like the ordinal", async () => {
    const client = new FileSqliteClient({path: ":memory:"});
    await client.connect();
    let caught;
    try { await hostRelation(client, "sqlite", {schema: {[ORDINAL]: T.int}, rows: objectRows([])}); } catch (error) { caught = error; }
    await client.disconnect();
    expect(caught).to.be.instanceOf(WriteError);
  });

  it("reads an ABAP internal table's lines by field name, in index order", () => {
    const line = (fields) => ({get: () => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, {get: () => v}]))});
    const rows = abapTableRows({array: () => [line({id: 2, txt: "b"}), line({id: 1, txt: "a"})]});
    expect(rows.length).to.equal(2);
    expect([rows.get(0, "ID"), rows.get(1, "TXT"), rows.get(0, "MISSING")]).to.deep.equal([2, "a", undefined]);
  });
});
