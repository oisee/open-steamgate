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

describe("the #63 critic's round", () => {
  const PT = {K: {abap: "I"}, P: {abap: "P", len: 15, dec: 2}};
  const ZM = {MANDT: {abap: "C", len: 3}, K: {abap: "I"}, TXT: {abap: "C", len: 5}};
  const cat = {T: TABLE, VT: TABLE, PT, ZM};
  const compileC = (body, method = {}) => compileProcedure({...SIG, ...method, body: "DECLARE n INTEGER; DECLARE s NVARCHAR(200); " + body}, new Map(), {catalogue: cat});
  for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})], ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
    describe(`on ${dialect}`, function () {
      this.timeout(30000);
      let client;
      const run = async (body) => (await runProcedure(compileC(body), {client, dialect, inputCatalogue: cat})).value;
      beforeEach(async () => {
        client = make();
        await client.connect();
        for (const sql of ['CREATE TABLE "T" ("K" INTEGER PRIMARY KEY, "V" VARCHAR(10))', "INSERT INTO \"T\" VALUES (1, 'a')", "INSERT INTO \"T\" VALUES (2, 'b')",
          'CREATE VIEW "VT" AS SELECT "K", "V" FROM "T"', 'CREATE TABLE "PT" ("K" INTEGER PRIMARY KEY, "P" DECIMAL(15,2))', "INSERT INTO \"PT\" VALUES (1, 1.00)",
          'CREATE TABLE "ZM" ("MANDT" VARCHAR(3), "K" INTEGER, "TXT" VARCHAR(5))']) await client.native({sql, expect: "none"});
      });
      afterEach(async () => { await client.disconnect(); });

      it("a variable over a view keeps its rows through a DELETE of the table under it", async () => {
        expect(await run("lt = SELECT k, v FROM vt; DELETE FROM t; SELECT COUNT(*) AS c INTO n FROM :lt; rv = 'lt=' || :n;")).to.equal("lt=2");
      });
      it("a chain of variables keeps its rows", async () => {
        expect(await run("lt = SELECT k, v FROM t; lt2 = SELECT k FROM :lt; DELETE FROM t; SELECT COUNT(*) AS c INTO n FROM :lt2; rv = 'lt2=' || :n;")).to.equal("lt2=2");
      });
      it("a subquery in EXISTS keeps what it read", async () => {
        expect(await run("lt = SELECT 1 AS x FROM dummy WHERE EXISTS (SELECT k FROM t); DELETE FROM t; SELECT COUNT(*) AS c INTO n FROM :lt; rv = 'e=' || :n;")).to.equal("e=1");
      });
      it("a subquery in IN keeps what it read", async () => {
        expect(await run("lt = SELECT k FROM t WHERE k IN (SELECT k FROM t WHERE k = 2); DELETE FROM t; SELECT COUNT(*) AS c INTO n FROM :lt; rv = 'in=' || :n;")).to.equal("in=1");
      });
      it("a CASE over a derived table keeps what it read", async () => {
        expect(await run("lt = SELECT CASE WHEN c = 2 THEN 'y' ELSE 'n' END AS x FROM (SELECT COUNT(*) AS c FROM t) AS d; DELETE FROM t; SELECT MAX(x) AS m INTO s FROM :lt; rv = :s;")).to.equal("y");
      });
      it("a write is in the LUW: a ROLLBACK takes it back", async () => {
        await run("DELETE FROM t WHERE k = 2; rv = 'x';");
        await client.rollback();
        expect((await client.native({sql: 'SELECT COUNT(*) AS "C" FROM "T"', expect: "rows"})).rows[0].C).to.satisfy((c) => Number(c) === 2);
      });
      it("a failed write after it keeps the earlier write in the transaction, as HANA does (measured)", async () => {
        let caught;
        try { await run("DELETE FROM t WHERE k = 2; INSERT INTO t VALUES (1, 'dup'); rv = 'x';"); } catch (error) { caught = error; }
        expect(caught).to.be.an("error");
        const rows = (await client.native({sql: 'SELECT "K" FROM "T" ORDER BY "K"', expect: "rows"})).rows.map((r) => Number(r.K));
        expect(rows).to.deep.equal([1]);
        await client.rollback();
        expect((await client.native({sql: 'SELECT "K" FROM "T" ORDER BY "K"', expect: "rows"})).rows.map((r) => Number(r.K))).to.deep.equal([1, 2]);
      });
      it("keeps a write that read a snapshot through a later failed statement's replay", async () => {
        await run("lt = SELECT k + 10 AS k, v FROM t; INSERT INTO t SELECT k, v FROM :lt; rv = 'x';");
        let caught;
        try { await client.write({sql: "INSERT INTO \"T\" VALUES (1, 'dup')"}); } catch (error) { caught = error; }
        expect(caught).to.be.an("error");
        const keys = (await client.native({sql: 'SELECT "K" FROM "T" ORDER BY "K"', expect: "rows"})).rows.map((r) => Number(r.K));
        expect(keys).to.deep.equal([1, 2, 11, 12]);
      });
      it("drops its snapshots when the body fails", async () => {
        try { await run("lt = SELECT k FROM t; DELETE FROM t WHERE k = 2; INSERT INTO t VALUES (1, 'dup'); rv = 'x';"); } catch { /* expected */ }
        await client.rollback();
        const tables = dialect === "sqlite"
          ? (await client.native({sql: "SELECT name FROM sqlite_master WHERE type = 'table'", expect: "rows"})).rows.map((r) => r.name)
          : (await client.native({sql: "SELECT table_name AS name FROM information_schema.tables", expect: "rows"})).rows.map((r) => r.name);
        expect(tables.filter((one) => /SNAP/i.test(one))).to.deep.equal([]);
      });
      it("writes a decimal literal in SET and in an expression, as its own digits", async () => {
        await run("UPDATE pt SET p = 2.34 WHERE k = 1; rv = 'x';");
        await run("UPDATE pt SET p = p * 1.5 WHERE k = 1; rv = 'x';");
        await run("INSERT INTO pt VALUES (2, 2.25 + 0); rv = 'x';");
        const rows = (await client.native({sql: 'SELECT "K", "P" FROM "PT" ORDER BY "K"', expect: "rows"})).rows.map((r) => [Number(r.K), Number(r.P)]);
        expect(rows).to.deep.equal([[1, 3.51], [2, 2.25]]);
      });
      it("fills a column the INSERT leaves out with its initial value, not NULL", async () => {
        await run("INSERT INTO zm (k) VALUES (1); rv = 'x';");
        const row = (await client.native({sql: 'SELECT "MANDT", "TXT" FROM "ZM"', expect: "rows"})).rows[0];
        expect([row.MANDT, row.TXT]).to.deep.equal(["", ""]);
      });
    });
  }
  it("refuses a text longer than its column, an integer past 2^53, and a write in a FUNCTION (measured wording)", () => {
    expect(() => compileC("INSERT INTO t VALUES (4, 'abcdefghijklmnop'); rv = 'x';")).to.throw(/longer than the column's 10/);
    expect(() => compileC("INSERT INTO t VALUES (9007199254740993, 'a'); rv = 'x';")).to.throw(/past 2\^53/);
    expect(() => compileC("DELETE FROM t; rv = 'x';", {dbKind: "FUNCTION"})).to.throw(/not supported in table function/);
  });
  it("accepts a scalar function whose table variables only feed a write", () => {
    expect(() => compileC("lt = SELECT 5 AS k, 'e' AS v FROM dummy; INSERT INTO t SELECT k, v FROM :lt; rv = 'x';")).not.to.throw();
  });
});

describe("UPSERT by the primary key, as HANA Express ran it", () => {
  const KEYS = {T: ["K"]};
  const compileU = (body) => compileProcedure({...SIG, body: "DECLARE n INTEGER; DECLARE s NVARCHAR(200); " + body},
    new Map(), {catalogue: {T: TABLE}, keys: KEYS});
  for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})], ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
    for (const [name, body, hana] of [
      ["VALUES WITH PRIMARY KEY updates a key and inserts a new one", "UPSERT t VALUES (1, 'u') WITH PRIMARY KEY; UPSERT t VALUES (5, 'e') WITH PRIMARY KEY; " + agg, "1u,2b,5e"],
      ["SELECT updates the keys it brings and inserts the others", "lt = SELECT 2 AS k, 'y' AS v FROM dummy UNION ALL SELECT 7 AS k, 'g' AS v FROM dummy; UPSERT t SELECT * FROM :lt; " + agg, "1a,2y,7g"],
    ]) {
      it(`on ${dialect}: ${name}: ${JSON.stringify(hana)}`, async () => {
        const client = make();
        await client.connect();
        try {
          await client.native({sql: 'CREATE TABLE "T" ("K" INTEGER PRIMARY KEY, "V" VARCHAR(10))', expect: "none"});
          await client.native({sql: "INSERT INTO \"T\" VALUES (1, 'a')", expect: "none"});
          await client.native({sql: "INSERT INTO \"T\" VALUES (2, 'b')", expect: "none"});
          expect((await runProcedure(compileU(body), {client, dialect, inputCatalogue: {T: TABLE}})).value).to.equal(hana);
        } finally { await client.disconnect(); }
      });
    }
  }
  it("refuses UPSERT without a known key, and VALUES without WITH PRIMARY KEY", () => {
    expect(() => compile("UPSERT t SELECT k, v FROM t; rv = 'x';")).to.throw(/primary key is not known/);
    expect(() => compileU("UPSERT t VALUES (1, 'x'); rv = 'x';")).to.throw(/without WITH PRIMARY KEY is not carried/);
    expect(() => compileU("UPSERT t (k, v) VALUES (2, 'w') WHERE k = 2; rv = 'x';")).to.throw(/without WITH PRIMARY KEY is not carried/);
  });
});

describe("UPSERT edges, as HANA Express ran them", () => {
  const T3 = {K: {abap: "I"}, V: {abap: "C", len: 10}, W: {abap: "C", len: 10}};
  const compile3 = (body) => compileProcedure({...SIG, body: "DECLARE s NVARCHAR(200); " + body}, new Map(), {catalogue: {T: T3}, keys: {T: ["K"]}});
  const agg3 = "SELECT STRING_AGG(k || v || w, ',' ORDER BY k) AS s INTO s FROM t; rv = :s;";
  for (const [dialect, make] of [["duckdb", () => new DuckDBDatabaseClient({path: ":memory:"})], ["sqlite", () => new FileSqliteClient({path: ":memory:"})]]) {
    describe(`on ${dialect}`, function () {
      this.timeout(30000);
      let client;
      const run = async (body) => (await runProcedure(compile3(body), {client, dialect, inputCatalogue: {T: T3}})).value;
      beforeEach(async () => {
        client = make();
        await client.connect();
        for (const sql of ['CREATE TABLE "T" ("K" INTEGER PRIMARY KEY, "V" VARCHAR(10), "W" VARCHAR(10))', "INSERT INTO \"T\" VALUES (1, 'a', 'x')", "INSERT INTO \"T\" VALUES (2, 'b', 'y')"]) {
          await client.native({sql, expect: "none"});
        }
      });
      afterEach(async () => { await client.disconnect(); });
      // HXE: W left out keeps its value when updated, takes its default when
      // inserted -- the default of a DDIC table being the initial value ''
      it("a column left out keeps its value on an update and is initial on an insert (SELECT)", async () => {
        expect(await run("lt = SELECT 1 AS k, 'n' AS v FROM dummy UNION ALL SELECT 3 AS k, 'm' AS v FROM dummy; UPSERT t (k, v) SELECT * FROM :lt; " + agg3)).to.equal("1nx,2by,3m");
      });
      it("the same with VALUES WITH PRIMARY KEY", async () => {
        expect(await run("UPSERT t (k, v) VALUES (2, 'z') WITH PRIMARY KEY; UPSERT t (k, v) VALUES (4, 'o') WITH PRIMARY KEY; " + agg3)).to.equal("1ax,2zy,4o");
      });
      it("a query that brings one key twice raises, as HANA does, and writes nothing", async () => {
        let caught;
        try { await run("lt = SELECT 1 AS k, 'p' AS v, 'q' AS w FROM dummy UNION ALL SELECT 1 AS k, 'r' AS v, 's' AS w FROM dummy; UPSERT t SELECT * FROM :lt; rv = 'x';"); } catch (error) { caught = error; }
        expect(caught?.message).to.match(/unique constraint violated/);
        const rows = (await client.native({sql: 'SELECT "V" FROM "T" WHERE "K" = 1', expect: "rows"})).rows;
        expect(rows[0].V).to.equal("a");
      });
    });
  }
  it("refuses an UPSERT that leaves out a key column", () => {
    expect(() => compile3("UPSERT t (v) VALUES ('z') WITH PRIMARY KEY; rv = 'x';")).to.throw(/leaves out the key column K/);
  });
});
