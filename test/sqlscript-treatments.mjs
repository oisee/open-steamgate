// The treatments, run rather than read.
//
// `VERDICTS` in tools/sqlscript-conformance.mjs gives each row that differs
// from HANA a class and a place the treatment lives. Eight of the nine had
// one and **six of those eight were watched by no suite at all**: the class
// had been read off the dialect, which is half of what this tree's own rule
// asks for -- running it and reading it find different things, and the worked
// example in CLAUDE.md is a case where reading alone would have shipped a
// broken range.
//
// So each of the six is asserted **where its verdict says the treatment is**,
// and the shapes differ because the treatments do:
//
//   int_div_neg       an expression rewrite     -> lower it and run it
//   cast_round        an expression rewrite     -> lower it and run it
//   cast_char_narrow  an expression rewrite     -> lower it and run it
//   div_zero          a guard on one engine and a written-down divergence on
//                     the other -> assert both, so the accepted loss is
//                     pinned instead of remembered
//   like_case         the CONNECTION, not the dialect -> assert the pragma's
//                     effect through the client
//   fn_log            a refusal -> assert the lowering declines
//
// The expected values are read from the tracked oracle rather than typed
// here. A suite that carries its own copy of the answer is comparing this
// file against itself, and the oracle is the only thing in reach that HANA
// actually said.
import {expect} from "chai";
import {readFileSync} from "node:fs";
import {T, col, lit, bin, call, cast, like, scan, filter, project} from "../tools/sqlscript-ir.mjs";
import {lower, Refused} from "../tools/sqlscript-lower.mjs";
import {ORACLE, UNPADDED, ddlFor, agree} from "../tools/sqlscript-conformance.mjs";

const oracle = JSON.parse(readFileSync(ORACLE, "utf8")).hana;
const said = (id) => oracle[id]?.value;

async function duckdb() {
  const {DuckDBDatabaseClient} = await import("../tools/duckdb-client.mjs");
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();
  await client.native({sql: ddlFor("duckdb"), expect: "none"});
  for (const row of UNPADDED) await client.native({sql: row, expect: "none"});
  return client;
}

async function sqljs() {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({
    locateFile: () => new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname,
  });
  const {installNative} = await import("../tools/sqljs-native.mjs");
  const client = {sqlite: new SQL.Database()};
  installNative(client);
  await client.native({sql: ddlFor("sqlite"), expect: "none"});
  for (const row of UNPADDED) await client.native({sql: row, expect: "none"});
  return client;
}

async function sqliteNode() {
  const {FileSqliteClient} = await import("../tools/sqlite-file-client.mjs");
  const client = new FileSqliteClient({path: ":memory:"});
  await client.connect();
  await client.native({sql: ddlFor("sqlite"), expect: "none"});
  for (const row of UNPADDED) await client.native({sql: row, expect: "none"});
  return client;
}

/** the row of the conformance fixture the case reads */
const rowIs = (k) => bin("=", col("k"), lit(k, T.char(10)), T.bool);
const one = (k, as, expr) => project(filter(scan("t"), rowIs(k)), [{as, expr}]);

describe("the treatments the verdicts claim, executed", function () {
  this.timeout(60000);
  const clients = {};
  // Which dialect each client speaks. Two of the three are `sqlite` and that
  // is the point of having both: one dialect, two engines, and the day they
  // part this suite is what notices.
  const dialect = {duckdb: "duckdb", sqljs: "sqlite", sqlite_node: "sqlite"};

  before(async () => {
    for (const [name, make] of [["duckdb", duckdb], ["sqljs", sqljs], ["sqlite_node", sqliteNode]]) {
      try {
        clients[name] = await make();
      } catch (error) {
        console.error(`${name} unavailable: ${error?.message ?? error}`);
      }
    }
  });

  // The guard the conformance suite had to grow: "at least one engine
  // answered" let DuckDB be silently absent for eight green tests.
  it("all three engines are here, by name", () => {
    for (const name of ["duckdb", "sqljs", "sqlite_node"]) {
      expect(clients[name], `${name} did not start, so this suite measured less than it says`).to.be.an("object");
    }
  });

  const answers = async (name, rel) => {
    const {sql, params} = lower(rel, dialect[name]);
    const out = await clients[name].native({sql, params, expect: "rows"});
    return Object.values(out.rows[0])[0];
  };

  it("int_div_neg: the forced decimal fixes the sign too, not only the magnitude", async () => {
    // The suite next door asserts 1/2 and stops there. HANA answers -3.500000
    // for -7/2 and sql.js truncates toward zero, so a rewrite that only
    // rounded would pass the positive case and fail this one.
    const rel = one("r1", "V", bin("/", col("c"), col("b"), T.dec(15, 2)));
    for (const name of Object.keys(clients)) {
      expect(agree({value: String(await answers(name, rel))}, {value: said("int_div_neg")}),
        `${name} against HANA's ${said("int_div_neg")}`).to.equal(true);
    }
  });

  it("cast_round: DuckDB truncates toward zero after the rewrite, where the engine rounds", async () => {
    // d1 on row r3 is 1.70. HANA truncates to 1 and DuckDB's own CAST rounds
    // to 2 -- the divergence that shipped before the oracle column existed.
    const rel = one("r3", "V", cast(col("d1"), T.int));
    const got = String(await answers("duckdb", rel));
    expect(got, `HANA said ${said("cast_round")}`).to.equal(said("cast_round"));
  });

  it("cast_char_narrow: a cast to a narrower character type truncates on every engine", async () => {
    const rel = one("r1", "V", cast(col("long_txt"), T.char(3)));
    for (const name of Object.keys(clients)) {
      expect(String(await answers(name, rel)), `${name} against HANA's ${said("cast_char_narrow")}`)
        .to.equal(said("cast_char_narrow"));
    }
  });

  it("div_zero: DuckDB is made to raise, and SQLite's silence is the loss that was written down", async () => {
    const rel = one("r1", "V", bin("/", col("a"), col("zero"), T.dec(15, 2)));
    let raised = false;
    try {
      await answers("duckdb", rel);
    } catch {
      raised = true;
    }
    expect(raised, "guardZero turns it into an error, which is what HANA does").to.equal(true);
    // And the accepted divergence, asserted rather than remembered: SQLite
    // cannot raise, so it answers NULL. Pinning it means the day somebody
    // finds a way to raise, this test says so instead of staying green.
    for (const name of ["sqljs", "sqlite_node"]) {
      expect(await answers(name, rel), `${name} answers NULL where HANA raises`).to.equal(null);
    }
  });

  it("like_case: the pragma makes SQLite's LIKE case-sensitive, and the dialect passes LIKE through", async () => {
    // The treatment is at the CONNECTION, so it is asserted through the
    // client rather than through the lowering -- which is why the conformance
    // table, opening its own connections, keeps showing this row as a
    // difference while the runtime does not have one.
    const rel = project(filter(scan("t"),
      like(col("upper_txt"), lit("abc", T.char(3)))), [{as: "V", expr: col("k")}]);
    for (const name of Object.keys(clients)) {
      const {sql, params} = lower(rel, dialect[name]);
      const out = await clients[name].native({sql, params, expect: "rows"});
      expect(out.rows.length, `${name}: 'ABC' LIKE 'abc' must not match`).to.equal(0);
    }
  });

  it("dec_arith: an engine with no decimal type is rounded back to the declared scale", async () => {
    // 0.10 + 0.20 over two DECIMAL(15,2) columns. HANA and DuckDB answer
    // 0.30; SQLite is binary floating point and answers 0.30000000000000004.
    // This is the row that had no treatment anywhere, and the one most
    // likely to reach a body unnoticed: it does not raise and it does not
    // return a different kind of thing -- it returns a number that is
    // nearly right.
    const rel = one("r1", "V", bin("+", col("d1"), col("d2"), T.dec(15, 2)));
    for (const name of Object.keys(clients)) {
      expect(agree({value: String(await answers(name, rel))}, {value: said("dec_arith")}),
        `${name} against HANA's ${said("dec_arith")}`).to.equal(true);
    }
  });

  it("and leaves an engine that HAS decimals alone", async () => {
    // The rewrite is in the sqlite dialect only. Asserted because a guard
    // applied everywhere would be invisible here -- DuckDB would go on
    // answering 0.30 either way, and the day the rounding is wrong it would
    // be wrong on the engine nobody checked.
    const rel = one("r1", "V", bin("+", col("d1"), col("d2"), T.dec(15, 2)));
    expect(lower(rel, "duckdb").sql, "no ROUND on an engine with a real decimal").to.not.contain("ROUND");
    expect(lower(rel, "hana").sql, "and none on the reference").to.not.contain("ROUND");
    expect(lower(rel, "sqlite").sql, "and one where it is needed").to.contain("ROUND");
  });

  it("fn_log: an unknown function is refused at lowering rather than rendered", () => {
    // HANA takes LOG(base, x) and refuses the one-argument form; the two
    // SQLite builds answer it and disagree with each other. Rendering it
    // would pick one of those two by accident.
    const rel = one("r1", "V", call("LOG", [lit(10, T.int)], T.dec(15, 2)));
    for (const name of ["duckdb", "sqlite"]) {
      expect(() => lower(rel, name), `${name} must decline LOG`).to.throw(Refused);
    }
  });
});
