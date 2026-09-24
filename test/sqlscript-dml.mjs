// DELETE, UPDATE and INSERT on a database table in a portable AMDP body --
// every expected value is what HANA Express returned for the same body
// (measured 2026-09-24, docs/sqlscript-hana-observed.md, "Writes").
import {expect} from "chai";
import {compileProcedure} from "../tools/sqlscript-to-procedure-ir.mjs";
import {runProcedure, UnsupportedSqlScript} from "../tools/sqlscript-procedure-ir.mjs";
import {DuckDBDatabaseClient} from "../tools/duckdb-client.mjs";
import {FileSqliteClient} from "../tools/sqlite-file-client.mjs";

const TABLE = {K: {abap: "I"}, V: {abap: "C", len: 10}};
const SIG = {name: "M", kind: "METHOD", parameters: [{name: "rv", direction: "OUT", abapType: "string"}]};
const compile = (body, method = {}) => compileProcedure({...SIG, ...method, body: "DECLARE n INTEGER; DECLARE s NVARCHAR(200); " + body},
  new Map(), {catalogue: {T: TABLE}});
const agg = "SELECT STRING_AGG(k || v, ',' ORDER BY k) AS s INTO s FROM t; rv = :s;";

const MEASURED = [
  ["a table variable read before a DELETE keeps its rows", "lt = SELECT k, v FROM t; DELETE FROM t; SELECT COUNT(*) AS c INTO n FROM :lt; rv = 'lt=' || :n;", "lt=2"],
  ["a table variable read before an UPDATE keeps the old values", "lt = SELECT k, v FROM t WHERE k = 1; UPDATE t SET v = 'z' WHERE k = 1; SELECT MAX(v) AS m INTO s FROM :lt; rv = 'lt=' || :s;", "lt=a"],
  ["a read after an INSERT sees it", "INSERT INTO t VALUES (3, 'c'); SELECT COUNT(*) AS c INTO n FROM t; rv = 'n=' || :n;", "n=3"],
  ["an UPDATE without WHERE updates every row", "UPDATE t SET v = 'q'; " + agg, "1q,2q"],
  ["DELETE with an alias and a correlated EXISTS", "lt = SELECT 1 AS k FROM dummy; DELETE FROM t AS a WHERE EXISTS (SELECT k FROM :lt AS b WHERE a.k = b.k); " + agg, "2b"],
  ["INSERT ... SELECT from a table variable", "lt = SELECT 5 AS k, 'e' AS v FROM dummy; INSERT INTO t SELECT k, v FROM :lt; " + agg, "1a,2b,5e"],
  ["INSERT with a column list in another order", "INSERT INTO t (v, k) VALUES ('f', 6); " + agg, "1a,2b,6f"],
];

for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})], ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
  describe(`writes in a portable body, on ${dialect}, as HANA Express ran them`, function () {
    this.timeout(30000);
    let client;
    beforeEach(async () => {
      client = make();
      await client.connect();
      await client.native({sql: 'CREATE TABLE "T" ("K" INTEGER PRIMARY KEY, "V" VARCHAR(10))', expect: "none"});
      await client.native({sql: "INSERT INTO \"T\" VALUES (1, 'a')", expect: "none"});
      await client.native({sql: "INSERT INTO \"T\" VALUES (2, 'b')", expect: "none"});
    });
    afterEach(async () => { await client.disconnect(); });
    for (const [name, body, hana] of MEASURED) {
      it(`${name}: ${JSON.stringify(hana)}`, async () => {
        expect((await runProcedure(compile(body), {client, dialect, inputCatalogue: {T: TABLE}})).value).to.equal(hana);
      });
    }
    it("leaves no snapshot table behind", async () => {
      await runProcedure(compile(MEASURED[0][1]), {client, dialect, inputCatalogue: {T: TABLE}});
      const tables = dialect === "sqlite"
        ? (await client.native({sql: "SELECT name FROM sqlite_master WHERE type = 'table'", expect: "rows"})).rows.map((r) => r.name)
        : (await client.native({sql: "SELECT table_name AS name FROM information_schema.tables", expect: "rows"})).rows.map((r) => r.name);
      expect(tables.filter((one) => /SNAP/i.test(one))).to.deep.equal([]);
    });
  });
}

describe("writes: what is refused, by name", () => {
  it("a write in a READ-ONLY method", () => {
    expect(() => compile("DELETE FROM t; rv = 'x';", {readOnly: true})).to.throw(UnsupportedSqlScript, /READ-ONLY/);
  });
  it("a table not in the USING list, and a table variable as the target", () => {
    expect(() => compile("DELETE FROM other; rv = 'x';")).to.throw(/not in the USING list/);
    expect(() => compile("lt = SELECT k, v FROM t; INSERT INTO :lt VALUES (1, 'a'); rv = 'x';")).to.throw(/INSERT INTO a table variable/);
  });
  it("a column the table does not have", () => {
    expect(() => compile("UPDATE t SET nope = 1; rv = 'x';")).to.throw(/NOPE is not a column of T/);
    expect(() => compile("INSERT INTO t (k, nope) VALUES (1, 2); rv = 'x';")).to.throw(/NOPE is not a column of T/);
  });
});
