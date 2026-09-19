// The IR, executed rather than spelled.
//
// test/sqlscript-ir.mjs asserts what the lowering WRITES; this one asserts
// what the engines ANSWER, over the same plans, through the native channel
// (docs/db-seam-native.md). Until now the fixtures could have been lowering
// confident nonsense and nothing would have said so - a suite that checks a
// statement's text is checking the author's intention twice.
//
// Both engines that ship are here: DuckDB, which the server uses, and sql.js,
// which is the one the browser preview actually runs. The rows are written
// **unpadded**, because that is what a real system holds and what the write
// boundary will produce (measured on A4H: a CHAR(30) holding '$TMP' answers
// LENGTH 4).
import {expect} from "chai";
import {T, col, lit, param, bin, call, cast, scan, filter, project, aggregate, order, union} from "../tools/sqlscript-ir.mjs";
import {lower, Refused} from "../tools/sqlscript-lower.mjs";

const FIXTURE = [
  `CREATE TABLE src (k VARCHAR, ch VARCHAR, txt VARCHAR, a INTEGER, b INTEGER, n INTEGER)`,
  `INSERT INTO src VALUES ('a', 'abc', '42', 1, 2, 1)`,
  `INSERT INTO src VALUES ('b', 'zz', 'oops', 7, 2, 2)`,
  `INSERT INTO src VALUES ('c', 'yy', '7', 9, 3, 3)`,
];

async function duckdbClient() {
  const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();
  for (const statement of FIXTURE) await client.native({sql: statement, expect: "none"});
  return client;
}

async function sqljsClient() {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({
    locateFile: () => new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname,
  });
  const {installNative} = await import("../tools/sqljs-native.mjs");
  const client = {sqlite: new SQL.Database()};
  installNative(client);
  for (const statement of FIXTURE) await client.native({sql: statement, expect: "none"});
  return client;
}

describe("SQLScript IR: executed on both engines that ship", function () {
  this.timeout(30000);
  const clients = {};

  before(async () => {
    try {
      clients.duckdb = await duckdbClient();
    } catch (error) {
      console.log(`      (duckdb unavailable: ${error.message})`);
    }
    try {
      clients.sqlite = await sqljsClient();
    } catch (error) {
      console.log(`      (sql.js unavailable: ${error.message})`);
    }
    // A suite that silently measures nothing is the failure this tree keeps
    // paying for: a leak scan that read no files printed a clean line, and a
    // mocha run of a file that did not exist reported "35 passing".
    // Not "at least one": the suite is named for both engines, and one of
    // them standing in for two is how a green run comes to mean nothing.
    // The first version of this hook allowed exactly that, and a typo in the
    // DuckDB export name made the whole DuckDB half silently absent while
    // eight tests passed.
    expect(Object.keys(clients).sort(), "both engines must be reachable, or this suite is claiming more than it measured")
      .to.deep.equal(["duckdb", "sqlite"]);
  });

  after(async () => {
    await clients.duckdb?.disconnect?.();
  });

  /** run one plan on every engine present and give back {engine: rows} */
  const run = async (rel) => {
    const out = {};
    for (const [name, client] of Object.entries(clients)) {
      const {sql, params} = lower(rel, name === "sqlite" ? "sqlite" : "duckdb");
      const answer = await client.native({sql, params, expect: "rows"});
      out[name] = answer.rows;
    }
    return out;
  };

  const values = (rows, column) => rows.map((r) => r[column] ?? r[column.toLowerCase()] ?? r[column.toUpperCase()]);

  it("a filter and a projection answer the same rows on both", async () => {
    const rel = project(filter(scan("src"), bin(">", col("a"), lit(1, T.int), T.bool)),
                        [{as: "K", expr: col("k")}]);
    const answers = await run(rel);
    for (const [name, rows] of Object.entries(answers)) {
      expect(values(rows, "K").sort(), name).to.deep.equal(["b", "c"]);
    }
  });

  it("a chain of three lowers to one statement and still answers correctly", async () => {
    const rel = order(
      project(filter(scan("src"), bin(">=", col("a"), lit(1, T.int), T.bool)), [{as: "K", expr: col("k")}]),
      [{col: "K", desc: true}]);
    for (const [name, rows] of Object.entries(await run(rel))) {
      expect(values(rows, "K"), name).to.deep.equal(["c", "b", "a"]);
    }
  });

  it("UNION ALL, which is in half the corpus", async () => {
    const rel = union([filter(scan("src"), bin("=", col("k"), lit("a", T.char(1)), T.bool)),
                       filter(scan("src"), bin("=", col("k"), lit("b", T.char(1)), T.bool))]);
    for (const [name, rows] of Object.entries(await run(rel))) {
      expect(rows.length, name).to.equal(2);
    }
  });

  it("GROUP BY with an aggregate", async () => {
    const rel = aggregate(scan("src"), ["b"], [{as: "TOTAL", expr: call("SUM", [col("a")], T.int)}]);
    for (const [name, rows] of Object.entries(await run(rel))) {
      const byKey = Object.fromEntries(rows.map((r) => [String(r.b ?? r.B), Number(r.TOTAL ?? r.total)]));
      expect(byKey, name).to.deep.equal({2: 8, 3: 9});
    }
  });

  it("a bound parameter travels as a value, not as text", async () => {
    // the value carries a quote on purpose: if it ever reaches the statement
    // text, this is where it shows
    const rel = project(filter(scan("src"), bin("=", col("k"), param("lv_k", T.char(1)), T.bool)),
                        [{as: "CH", expr: col("ch")}]);
    for (const [name, client] of Object.entries(clients)) {
      const {sql, params} = lower(rel, name === "sqlite" ? "sqlite" : "duckdb");
      params[0].value = "a";
      const answer = await client.native({sql, params, expect: "rows"});
      expect(values(answer.rows, "CH"), name).to.deep.equal(["abc"]);
      expect(sql, `${name}: the value must not be in the text`).to.not.contain("'a'");
    }
  });

  it("unpadded rows make the string functions agree, which is the whole padding decision", async () => {
    const rel = project(filter(scan("src"), bin("=", col("k"), lit("a", T.char(1)), T.bool)), [
      {as: "L", expr: call("LENGTH", [col("ch")], T.int)},
      {as: "S", expr: call("SUBSTR", [col("ch"), lit(1, T.int), lit(2, T.int)], T.char(2))},
    ]);
    const seen = [];
    for (const [name, rows] of Object.entries(await run(rel))) {
      seen.push([name, Number(rows[0].L ?? rows[0].l), String(rows[0].S ?? rows[0].s)]);
    }
    for (const [name, length, sub] of seen) {
      // HANA answers 3 and "ab" on the same data; this is the agreement the
      // write-boundary rule buys, asserted rather than assumed
      expect(length, `${name} length`).to.equal(3);
      expect(sub, `${name} substring`).to.equal("ab");
    }
  });

  it("division differs by engine exactly where the conformance table said", async () => {
    const rel = project(filter(scan("src"), bin("=", col("k"), lit("a", T.char(1)), T.bool)),
                        [{as: "R", expr: bin("/", col("a"), col("b"), T.dec(15, 2))}]);
    for (const [name, rows] of Object.entries(await run(rel))) {
      // HANA answers 0.5; DuckDB does natively, and sql.js only because the
      // lowering forces it with * 1.0. Both must land on 0.5 here.
      expect(Number(rows[0].R ?? rows[0].r), name).to.equal(0.5);
    }
  });

  it("sql.js refuses the cast it cannot make raise, and DuckDB raises", async () => {
    const rel = project(filter(scan("src"), bin("=", col("k"), lit("b", T.char(1)), T.bool)),
                        [{as: "N", expr: cast(col("txt"), T.int)}]);
    expect(() => lower(rel, "sqlite"), "the browser engine is refused at lowering").to.throw(Refused);
    if (clients.duckdb !== undefined) {
      const {sql, params} = lower(rel, "duckdb");
      let raised = false;
      try {
        await clients.duckdb.native({sql, params, expect: "rows"});
      } catch {
        raised = true;
      }
      expect(raised, "DuckDB raises on 'oops', as HANA does").to.equal(true);
    }
  });
});
