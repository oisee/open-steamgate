// What a CHAR is worth once it has been written, on every engine we ship.
//
// ABAP pads a CHAR to its field length, so the runtime hands the database
// `'abc       '` for a CHAR(10) holding `abc`. A real system does not keep
// those blanks: measured on A4H, a CHAR(30) holding '$TMP' answers LENGTH 4,
// and HANA's NCHAR answers 3 for the value above. Our four clients disagreed
// about it, in the open, for as long as there have been four:
//
//   DuckDB, HANA            trimmed on the way in, since they were written
//   node:sqlite, sql.js     stored the padding
//
// and the second pair is what the deployed showcase and the browser preview
// run. SQLite got away with it because its columns are declared COLLATE
// RTRIM, so *comparisons* ignore the blanks -- and comparisons were never
// the question. LENGTH, SUBSTR and || see them, which is seven of the
// fifteen rows the conformance table measures against HANA.
//
// This suite is the guard that was missing: the same ABAP-facing write, on
// every client, has to leave the same thing in the table. It fails on the
// engine that disagrees and names it, rather than leaving the disagreement
// to be discovered as a wrong answer in an application.
import {expect} from "chai";

const PADDED = "'abc       '";  // a CHAR(10) holding 'abc', as ABAP hands it over

async function duckdb() {
  const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();
  return client;
}

async function serverSqlite() {
  const {FileSqliteClient} = await import("../tools/sqlite-file-client.mjs");
  const client = new FileSqliteClient({path: ":memory:"});
  await client.connect();
  return client;
}

async function defaultSqlite() {
  // The package expects to be constructed inside the transpiled runtime and
  // reaches for the global `abap` on its error paths. A minimal stand-in is
  // enough to write and read a row, and the alternative -- leaving this
  // engine out -- is exactly the hole this suite exists to close: it is the
  // default here and the only engine in the browser.
  globalThis.abap ??= {Classes: {}, context: {databaseConnections: {}}};
  const {SQLiteDatabaseClient} = await import("@abaplint/database-sqlite");
  const {installTrim} = await import("../tools/sql-literals.mjs");
  const client = installTrim(new SQLiteDatabaseClient());
  await client.connect();
  return client;
}

describe("the write boundary: a padded CHAR stores the same on every engine", function () {
  this.timeout(30000);
  const clients = {};

  before(async () => {
    for (const [name, make] of [["duckdb", duckdb], ["sqlite_node", serverSqlite], ["sqlite_default", defaultSqlite]]) {
      try {
        clients[name] = await make();
      } catch (error) {
        console.log(`      (${name} unavailable: ${error.message})`);
      }
    }
    // named, not counted: one engine standing in for three is how a green
    // run comes to mean nothing, and this tree has paid for that twice
    expect(Object.keys(clients).sort()).to.deep.equal(["duckdb", "sqlite_default", "sqlite_node"]);
  });

  after(async () => {
    for (const client of Object.values(clients)) await client.disconnect?.();
  });

  it("stores three characters, not ten, whichever engine is underneath", async () => {
    const stored = {};
    for (const [name, client] of Object.entries(clients)) {
      await client.execute("CREATE TABLE t (k VARCHAR(10))");
      await client.insert({table: "t", columns: ["k"], values: [PADDED]});
      const answer = await client.select({select: "SELECT LENGTH(k) AS l FROM t"});
      const rows = answer.rows ?? answer;
      stored[name] = Number(rows[0].l ?? rows[0].L);
    }
    expect(stored, JSON.stringify(stored)).to.deep.equal({duckdb: 3, sqlite_node: 3, sqlite_default: 3});
  });

  it("and an escaped quote survives the trimming, since a literal is not a string", async () => {
    const {trimLiterals} = await import("../tools/sql-literals.mjs");
    expect(trimLiterals("INSERT INTO t VALUES ('it''s  ')")).to.equal("INSERT INTO t VALUES ('it''s')");
  });

  it("blanks that are not trailing are data and stay", async () => {
    const {trimLiterals} = await import("../tools/sql-literals.mjs");
    expect(trimLiterals("VALUES ('  a b  ')")).to.equal("VALUES ('  a b')");
  });

  it("and nothing outside a literal is touched", async () => {
    const {trimLiterals} = await import("../tools/sql-literals.mjs");
    expect(trimLiterals('SELECT "a b " FROM t WHERE k = 1')).to.equal('SELECT "a b " FROM t WHERE k = 1');
  });
});
