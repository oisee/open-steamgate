// The value-conformance table: what each engine actually answers.
//
//   node tools/sqlscript-conformance.mjs            # the engines on this machine
//   node tools/sqlscript-conformance.mjs --json     # machine-readable, for merging columns
//
// Milestone 0 of the splitter (docs/sqlscript-splitter.md). It prices the
// part of the design that was assumed free - "the engine does the plain SQL"
// - and it exists because that assumption was measured false: 1/2 is 0.5 in
// DuckDB and 0 in SQLite, and CAST('x' AS INTEGER) raises in one and returns
// 0 in the other.
//
// Two rules the cases follow, both learned the hard way:
//
//   1. **Over columns, not literals.** A literal is folded by the parser and
//      tells you nothing about the type regime. Every case reads a column of
//      a table created with our own DDIC-shaped types, so the blank padding
//      is in the data where it belongs. CONCAT and SUBSTR over a padded CHAR
//      are where a body that is right on HANA goes wrong here, silently.
//
//   2. **Classified, not thresholded.** A count of differences says nothing:
//      ten differences that are all trivial rewrites is a good result, and
//      one difference that needs host-side evaluation is a bad one. So each
//      row gets a class:
//
//        native     identical with no help
//        rewrite    a different spelling of the same thing
//        typed      needs the HANA result type to choose the form
//        compat     needs a compatibility expression
//        host       cannot be done in the engine; the host must evaluate it
//        refuse     cannot be reproduced faithfully at all
//
// The HANA column is measured on the machine that has HANA Express and
// merged in; this file prints the columns it can reach.
import {readFileSync} from "node:fs";

/** one row of the table: what to ask, and what each answer means */
const CASES = [
  {id: "int_div", sql: "SELECT a / b AS v FROM t WHERE k = 'r1'",
   why: "division: HANA yields a DECIMAL (0.500000) - it does NOT truncate, which this list assumed until the oracle answered"},
  {id: "int_div_neg", sql: "SELECT c / b AS v FROM t WHERE k = 'r1'",
   why: "and the sign: HANA -3.500000, DuckDB -3.5, sql.js -3 (it truncates)"},
  {id: "dec_arith", sql: "SELECT d1 + d2 AS v FROM t WHERE k = 'r1'",
   why: "decimal addition: binary float or a real decimal"},
  {id: "cast_ok", sql: "SELECT CAST(num AS INTEGER) AS v FROM t WHERE k = 'r1'",
   why: "a cast that should succeed"},
  {id: "cast_bad", sql: "SELECT CAST(txt AS INTEGER) AS v FROM t WHERE k = 'r2'",
   why: "a cast that should RAISE - SQLite returns 0 instead, which is a different program"},
  {id: "concat_padded", sql: "SELECT ch || '|' AS v FROM t WHERE k = 'r1'",
   why: "concat over a padded CHAR: are the blanks data?"},
  {id: "substr_padded", sql: "SELECT SUBSTR(ch, 1, 5) AS v FROM t WHERE k = 'r1'",
   why: "substring over a padded CHAR"},
  {id: "length_padded", sql: "SELECT LENGTH(ch) AS v FROM t WHERE k = 'r1'",
   why: "the length of a padded CHAR is the padding regime, in one number"},
  {id: "char_equals", sql: "SELECT COUNT(*) AS v FROM t WHERE ch = 'abc'",
   why: "does a padded CHAR equal its unpadded literal"},
  {id: "ifnull", sql: "SELECT IFNULL(nullable, -1) AS v FROM t WHERE k = 'r2'",
   why: "IFNULL, which is COALESCE in some engines"},
  {id: "null_arith", sql: "SELECT a + nullable AS v FROM t WHERE k = 'r2'",
   why: "NULL in arithmetic"},
  {id: "null_order", sql: "SELECT GROUP_CONCAT(x) AS v FROM (SELECT nullable AS x FROM t ORDER BY nullable ASC)",
   why: "where NULLs sort"},
  {id: "empty_scalar", sql: "SELECT MAX(a) AS v FROM t WHERE k = 'nothing'",
   why: "a scalar read from an empty result: NULL, or an error"},
  {id: "div_zero", sql: "SELECT a / zero AS v FROM t WHERE k = 'r1'",
   why: "division by zero: an error, or NULL, or infinity"},
];

/** the fixture, in our own DDIC shapes: a padded CHAR, a packed decimal, integers */
const DDL = {
  duckdb: `CREATE TABLE t (
      k VARCHAR, ch CHAR(10), txt VARCHAR, num VARCHAR,
      a INTEGER, b INTEGER, c INTEGER, zero INTEGER,
      d1 DECIMAL(15,2), d2 DECIMAL(15,2), nullable INTEGER)`,
  sqlite: `CREATE TABLE t (
      k TEXT, ch NCHAR(10), txt TEXT, num TEXT,
      a INTEGER, b INTEGER, c INTEGER, zero INTEGER,
      d1 NUMERIC, d2 NUMERIC, nullable INTEGER)`,
};
const ROWS = [
  `INSERT INTO t VALUES ('r1', 'abc       ', 'oops', '42', 1, 2, -7, 0, 0.10, 0.20, 5)`,
  `INSERT INTO t VALUES ('r2', 'zz        ', 'oops', '7',  1, 2, -7, 0, 1.00, 2.00, NULL)`,
];

async function runDuckDB() {
  const {DuckDBInstance} = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(DDL.duckdb);
  for (const row of ROWS) await connection.run(row);
  const out = {};
  for (const one of CASES) {
    try {
      const result = await connection.runAndReadAll(one.sql);
      const rows = result.getRowObjects();
      // `String(null)` is "null", which shows up as a difference against
      // another engine's real NULL and is a difference in the FORMATTER, not
      // in the engines. The instrument has to be silent where there is
      // nothing to say, or nobody reads it after the first week.
      const value = rows.length === 0 ? null : rows[0].v;
      out[one.id] = {value: value === null || value === undefined ? null : String(value)};
    } catch (error) {
      out[one.id] = {error: String(error.message ?? error).split("\n")[0].slice(0, 90)};
    }
  }
  return out;
}

/** HANA Express, through the native channel of tools/hana-client.mjs.
 *
 *  The same fourteen statements over the same fixture, and the fixture is
 *  written once here rather than twice: two similar tables would answer two
 *  similar questions. HANA's DDL differs only where it must -- NVARCHAR for
 *  the variable-length columns, NCHAR(10) for the padded one, DECIMAL(15,2)
 *  as elsewhere -- and the padding regime is exactly what the case list is
 *  asking about, so it is not smoothed over.
 *
 *  Run where a HANA is reachable: `node tools/sqlscript-conformance.mjs --hana`.
 */
async function runHana() {
  const {HanaDatabaseClient} = await import("./hana-client.mjs");
  const c = new HanaDatabaseClient({schema: "OSD_CONFORMANCE"});
  await c.connect();
  const ddl = `CREATE TABLE "T" (
      "K" NVARCHAR(10), "CH" NCHAR(10), "TXT" NVARCHAR(20), "NUM" NVARCHAR(20),
      "A" INTEGER, "B" INTEGER, "C" INTEGER, "ZERO" INTEGER,
      "D1" DECIMAL(15,2), "D2" DECIMAL(15,2), "NULLABLE" INTEGER)`;
  await c.native({sql: `DROP TABLE "T"`, expect: "none"}).catch(() => undefined);
  await c.native({sql: ddl, expect: "none"});
  for (const row of ROWS) {
    // the rows are written for the lower-case fixture; HANA holds the names
    // upper, and a native statement is sent unchanged, so the table name is
    // the only thing that has to be said in HANA's spelling
    await c.native({sql: row.replace(/INSERT INTO t /, 'INSERT INTO "T" '), expect: "none"});
  }
  const out = {};
  for (const one of CASES) {
    try {
      const sql = one.sql.replace(/\bFROM t\b/g, 'FROM "T"')
        .replace(/GROUP_CONCAT\(/g, "STRING_AGG(");
      const answer = await c.native({sql});
      const rows = answer.rows ?? [];
      const value = rows.length === 0 ? null : rows[0].V ?? rows[0].v;
      out[one.id] = {value: value === null || value === undefined ? null : String(value)};
    } catch (error) {
      out[one.id] = {error: String(error.message ?? error).split("\n")[0].slice(0, 90)};
    }
  }
  await c.disconnect();
  return out;
}

async function runSqlJs() {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({
    locateFile: () => new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname,
  });
  const db = new SQL.Database();
  db.run(DDL.sqlite);
  for (const row of ROWS) db.run(row);
  const out = {};
  for (const one of CASES) {
    try {
      const result = db.exec(one.sql);
      const value = result.length === 0 || result[0].values.length === 0 ? null : result[0].values[0][0];
      out[one.id] = {value: value === null ? null : String(value)};
    } catch (error) {
      out[one.id] = {error: String(error.message ?? error).split("\n")[0].slice(0, 90)};
    }
  }
  return out;
}

// Before anything can be classified the comparison has to stop reporting its
// own differences. Three of DuckDB's eight nominal differences against HANA
// were formatting: 0.5 against 0.500000, -3.5 against -3.500000, and a raise
// against a raise with different words. A count that includes those is the
// instrument talking about itself, which is the third time in a day this
// project has had that happen - so normalisation comes before counting, and
// what it collapsed is printed rather than assumed.
export function normalise(cell) {
  if (cell === undefined) return {kind: "missing"};
  if (cell.error !== undefined) return {kind: "raised"};
  if (cell.value === null) return {kind: "null"};
  const asNumber = Number(cell.value);
  if (cell.value.trim() !== "" && Number.isFinite(asNumber)) return {kind: "number", value: asNumber};
  return {kind: "text", value: cell.value};
}

/** same after normalisation? numbers by value, a raise is a raise */
export function agree(a, b) {
  const x = normalise(a);
  const y = normalise(b);
  if (x.kind !== y.kind) return false;
  if (x.kind === "number") return x.value === y.value;
  if (x.kind === "text") return x.value === y.value;
  return true;
}

const show = (cell) => {
  if (cell === undefined) return "-";
  if (cell.error !== undefined) return `RAISED ${cell.error}`;
  return cell.value === null ? "NULL" : `"${cell.value}"`;
};

const engines = {};
try {
  engines.duckdb = await runDuckDB();
} catch (error) {
  console.error(`duckdb unavailable: ${error.message}`);
}
try {
  engines.sqljs = await runSqlJs();
} catch (error) {
  console.error(`sql.js unavailable: ${error.message}`);
}

// a column measured elsewhere (HANA Express lives on another machine) merges in
if (process.argv.includes("--hana")) {
  try {
    engines.hana = await runHana();
  } catch (error) {
    console.error("hana: " + (error.message ?? error));
  }
}
const merged = process.argv.includes("--merge") ? process.argv[process.argv.indexOf("--merge") + 1] : undefined;
if (merged !== undefined) engines.hana = JSON.parse(readFileSync(merged, "utf8")).hana;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({cases: CASES, ...engines}, null, 1));
} else {
  const names = Object.keys(engines);
  console.log(`case              ${names.map((n) => n.padEnd(34)).join("")}`);
  for (const one of CASES) {
    console.log(`${one.id.padEnd(17)} ${names.map((n) => show(engines[n][one.id]).padEnd(34)).join("")}`);
  }
  console.log("");
  // Against the oracle when there is one, and between the local engines when
  // there is not. "Differs from HANA" is the only question that matters; two
  // local engines agreeing says nothing, as the padding rows proved.
  const oracle = engines.hana !== undefined ? "hana" : names[0];
  const others = names.filter((n) => n !== oracle);
  const nominal = [];
  const real = [];
  for (const one of CASES) {
    const differs = others.filter((n) => show(engines[n][one.id]) !== show(engines[oracle][one.id]));
    const actually = others.filter((n) => !agree(engines[n][one.id], engines[oracle][one.id]));
    if (differs.length > 0) nominal.push({one, who: differs});
    if (actually.length > 0) real.push({one, who: actually});
  }
  console.log(`against ${oracle}: ${nominal.length} of ${CASES.length} rows differ nominally, **${real.length} after normalisation**`);
  // per engine, because "nine rows differ" is not a number anybody can act
  // on: one engine may account for all of them
  for (const name of others) {
    const nom = CASES.filter((one) => show(engines[name][one.id]) !== show(engines[oracle][one.id])).length;
    const act = CASES.filter((one) => !agree(engines[name][one.id], engines[oracle][one.id])).length;
    console.log(`  ${name.padEnd(8)} ${nom} nominal, ${act} real`);
  }
  const formattingOnly = nominal.filter((n) => !real.some((r) => r.one.id === n.one.id));
  if (formattingOnly.length > 0) {
    console.log(`  formatting only, not behaviour: ${formattingOnly.map((f) => f.one.id).join(", ")}`);
  }
  for (const {one, who} of real) console.log(`  ${one.id.padEnd(17)} ${who.join(",").padEnd(14)} ${one.why}`);
  console.log("\nA count is not the verdict. Each differing row needs a class -");
  console.log("native / rewrite / typed / compat / host / refuse - and the HANA");
  console.log("column has to be merged in before any of them can be assigned.");
}
