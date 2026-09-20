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
import {readFileSync, existsSync} from "node:fs";
import {basename} from "node:path";
import {isInvalid} from "./sqlscript-eager.mjs";

/** one row of the table: what to ask, and what each answer means */
export const CASES = [
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
  // Three rows added after they were found the expensive way - by reading
  // bodies and measuring one at a time. A divergence that is only ever
  // measured by hand is a divergence that comes back: these are here so the
  // standing run re-checks them on every engine, every time.
  {id: "like_case", sql: "SELECT COUNT(*) AS v FROM t WHERE upper_txt LIKE 'abc'",
   why: "LIKE and case: HANA and DuckDB do not match, sql.js did - and Open SQL on a real system is case-sensitive too"},
  {id: "cast_char_narrow", sql: "SELECT CAST(long_txt AS VARCHAR(3)) AS v FROM t WHERE k = 'r1'",
   why: "casting to a narrower character type: HANA truncates to three, the others keep all six"},
  {id: "cast_round", sql: "SELECT CAST(d1 AS INTEGER) AS v FROM t WHERE k = 'r3'",
   why: "casting a fraction to an integer: HANA truncates toward zero, DuckDB rounds - this one was ours, and it shipped"},
  // One case per name the lowering calls PORTABLE. The list says "these mean
  // the same thing on all three engines", and until these rows existed that
  // was a belief about twelve of thirteen names: only LENGTH had ever been
  // measured. A list of portable functions with no measurement behind it is
  // the same claim-wider-than-evidence this table was built to catch, and it
  // was ours.
  {id: "fn_lower", sql: "SELECT LOWER(upper_txt) AS v FROM t WHERE k = 'r1'", why: "LOWER"},
  {id: "fn_upper", sql: "SELECT UPPER(ch) AS v FROM t WHERE k = 'r1'", why: "UPPER"},
  {id: "fn_trim", sql: "SELECT TRIM(ch) AS v FROM t WHERE k = 'r1'", why: "TRIM, and over a padded CHAR it is also the padding regime"},
  {id: "fn_ltrim", sql: "SELECT LTRIM(ch) AS v FROM t WHERE k = 'r1'", why: "LTRIM"},
  {id: "fn_rtrim", sql: "SELECT RTRIM(ch) AS v FROM t WHERE k = 'r1'", why: "RTRIM"},
  {id: "fn_abs", sql: "SELECT ABS(c) AS v FROM t WHERE k = 'r1'", why: "ABS over a negative integer"},
  {id: "fn_coalesce", sql: "SELECT COALESCE(nullable, -1) AS v FROM t WHERE k = 'r2'", why: "COALESCE, which is IFNULL under another name on some engines"},
  {id: "fn_sum", sql: "SELECT SUM(a) AS v FROM t", why: "SUM over integers"},
  {id: "fn_min", sql: "SELECT MIN(ch) AS v FROM t", why: "MIN over characters, which is collation as much as function"},
  {id: "fn_max", sql: "SELECT MAX(c) AS v FROM t", why: "MAX over negative integers"},
  {id: "fn_count", sql: "SELECT COUNT(nullable) AS v FROM t", why: "COUNT of a column with a NULL in it, which is the interesting half of COUNT"},
  // ROUND joined the portable list on 2026-09-19 and has to be measured
  // here rather than in somebody's scratch directory: a measurement nobody
  // else can re-run is not one (fable-osd's suite enforces exactly this, and
  // it caught this entry missing).
  //
  // Measured on HANA Express: ROUND(2.5) is 3.0 and ROUND(-2.5) is -3.0 --
  // half **away from zero**, not banker's rounding -- and the two-argument
  // form ROUND(2.345, 2) is 2.350. DuckDB and sql.js agreed on all three.
  // A concatenating aggregate, with and without an ordering. Written with
  // GROUP_CONCAT because the harness rewrites that to STRING_AGG for the
  // engines that spell it so (see the dialect rewrites below): one case
  // measures the one function under both its names.
  //
  // The ordered form agrees on all three (measured 2026-09-19: 'a,b,c' and
  // 'c,b,a'). **The unordered form has no specified order on any of them**,
  // so this case is here to be read rather than to be relied on -- it is the
  // shape that agrees on three rows and parts on three hundred, which is why
  // `effects()` marks an unordered one non-deterministic.
  {id: "agg_concat_ordered", sql: "SELECT GROUP_CONCAT(ch, ',' ORDER BY ch DESC) AS v FROM t",
   why: "a concatenating aggregate told what order to use"},
  {id: "agg_concat_unordered", sql: "SELECT GROUP_CONCAT(ch, ',') AS v FROM t",
   why: "the same without an ordering, whose result is unspecified everywhere: agreement here is not evidence"},
  // Ranking over a window. The fixture has a tie, which is the only part of
  // these that could differ: RANK leaves a gap after one and DENSE_RANK does
  // not. Measured 2026-09-19 — all three engines agreed on all five shapes,
  // syntax included.
  {id: "win_row_number", sql: "SELECT ROW_NUMBER() OVER (ORDER BY a) AS v FROM t",
   why: "numbering over an ordered window"},
  {id: "win_rank", sql: "SELECT RANK() OVER (ORDER BY ch) AS v FROM t",
   why: "RANK over a column with repeats: does a tie leave a gap"},
  {id: "win_dense_rank", sql: "SELECT DENSE_RANK() OVER (ORDER BY ch) AS v FROM t",
   why: "the same without the gap, which is the whole difference between the two"},
  {id: "win_count_over", sql: "SELECT COUNT(*) OVER (PARTITION BY ch) AS v FROM t",
   why: "an ordinary aggregate over a partition rather than over the whole set"},
  {id: "fn_round_half", sql: "SELECT ROUND(2.5) AS v FROM t WHERE k = 'r1'",
   why: "the tie rule: half away from zero, or to even"},
  {id: "fn_round_half_negative", sql: "SELECT ROUND(-2.5) AS v FROM t WHERE k = 'r1'",
   why: "the tie rule below zero, which is where away-from-zero and toward-zero part"},
  {id: "fn_round_scale", sql: "SELECT ROUND(2.345, 2) AS v FROM t WHERE k = 'r1'",
   why: "ROUND to a scale, which is a different function from ROUND to an integer on some engines"},
  {id: "fn_avg", sql: "SELECT AVG(a) AS v FROM t", why: "AVG over integers: an integer average, or a decimal one - the likeliest of these to differ"},
  // Not a function we lower, and here on purpose: it is the standing proof
  // that the two SQLite columns are two ENGINES and not one spelled twice.
  // LOG(10) is 1 on the server's build and 2.302585092994046 in the
  // browser's - base ten against natural - and every other row of this table
  // happens to agree, which is exactly how "one sqlite dialect is fine" would
  // have become a belief rather than a measurement. HANA takes LOG(base, x)
  // and refuses the one-argument form, which is its own answer and a true one.
  // Added 2026-09-20 with no oracle answer behind it, on purpose. The
  // decimal treatment in `sqlscript-lower.mjs` covers `+` and `-`, where
  // HANA's result scale is the operands' own; multiplication's is s1 + s2,
  // so the same rewrite would ROUND 0.0225 to 0.02 and be wrong in a way no
  // row here would catch. Until a machine with HANA answers this, the table
  // reports it as NOT measured -- which is the honest state and is visible,
  // rather than an assumption living in a comment.
  {id: "dec_mult", sql: "SELECT d1 * d1 AS v FROM t WHERE k = 'r3'",
   why: "decimal multiplication: HANA's result scale is s1 + s2, which decides whether the SQLite rounding may be extended to it"},
  {id: "fn_log", sql: "SELECT LOG(10) AS v FROM t WHERE k = 'r1'",
   why: "LOG: base ten or natural - the row that keeps the two SQLite builds honest"},
];

/** the fixture, in our own DDIC shapes: a padded CHAR, a packed decimal, integers */
/** The fixture's columns, once, with each engine's spelling beside the name.
 *
 *  Three DDLs used to be written out separately and HANA's was the one
 *  nobody edited: `upper_txt` and `long_txt` were added for the LIKE and the
 *  narrow-cast rows, the two local engines got them, and HANA's table kept
 *  eleven columns. The next `--hana` run did not measure those two rows - it
 *  failed on the INSERT and lost the ENTIRE column, which is how three
 *  sessions came and went with fifteen rows unmeasured against the oracle.
 *  One list, three renderings: a column added anywhere is added everywhere.
 */
export const COLUMNS = [
  {name: "k",        duckdb: "VARCHAR",        sqlite: "TEXT",      hana: "NVARCHAR(10)"},
  {name: "ch",       duckdb: "CHAR(10)",       sqlite: "NCHAR(10)", hana: "NCHAR(10)"},
  {name: "txt",      duckdb: "VARCHAR",        sqlite: "TEXT",      hana: "NVARCHAR(20)"},
  {name: "num",      duckdb: "VARCHAR",        sqlite: "TEXT",      hana: "NVARCHAR(20)"},
  {name: "upper_txt", duckdb: "VARCHAR",       sqlite: "TEXT",      hana: "NVARCHAR(20)"},
  {name: "long_txt", duckdb: "VARCHAR",        sqlite: "TEXT",      hana: "NVARCHAR(20)"},
  {name: "a",        duckdb: "INTEGER",        sqlite: "INTEGER",   hana: "INTEGER"},
  {name: "b",        duckdb: "INTEGER",        sqlite: "INTEGER",   hana: "INTEGER"},
  {name: "c",        duckdb: "INTEGER",        sqlite: "INTEGER",   hana: "INTEGER"},
  {name: "zero",     duckdb: "INTEGER",        sqlite: "INTEGER",   hana: "INTEGER"},
  {name: "d1",       duckdb: "DECIMAL(15,2)",  sqlite: "NUMERIC",   hana: "DECIMAL(15,2)"},
  {name: "d2",       duckdb: "DECIMAL(15,2)",  sqlite: "NUMERIC",   hana: "DECIMAL(15,2)"},
  {name: "nullable", duckdb: "INTEGER",        sqlite: "INTEGER",   hana: "INTEGER"},
];

export const ddlFor = (dialect) => `CREATE TABLE ${dialect === "hana" ? '"T"' : "t"} (` +
  COLUMNS.map((c) => `${dialect === "hana" ? `"${c.name.toUpperCase()}"` : c.name} ${c[dialect]}`).join(", ") + ")";

const DDL = {duckdb: ddlFor("duckdb"), sqlite: ddlFor("sqlite"), hana: ddlFor("hana")};

// Two fixtures, and the difference between them is the whole padding
// question. The unpadded one is what a real system holds, measured on A4H: a
// CHAR(30) column whose value is '$TMP' answers LENGTH 4, and 12132 rows
// satisfy a LENGTH = 4 predicate evaluated by HANA itself.
//
// **And it is now what our runtime writes as well**, which is why it is the
// default. This comment used to say the opposite -- "the padded one is what
// our runtime writes today" -- and it was true until the write boundary was
// fixed on 2026-09-19 (tools/sql-literals.mjs: two of the four clients
// trimmed and two did not, so the answer depended on STG_DB). A fixture
// described as "what we write" while we write something else is the same
// stale claim this table exists to catch, one level up.
//
// `--padded` keeps the historical question askable, because the seven rows
// between the two are the size of the decision and somebody will want to see
// them again. A column measured on one fixture cannot be merged into a run
// of the other: it is refused by name.
export const PADDED = [
  `INSERT INTO t VALUES ('r1', 'abc       ', 'oops', '42', 'ABC', 'abcdef', 1, 2, -7, 0, 0.10, 0.20, 5)`,
  `INSERT INTO t VALUES ('r2', 'zz        ', 'oops', '7',  'ZZ',  'zz',     1, 2, -7, 0, 1.00, 2.00, NULL)`,
  `INSERT INTO t VALUES ('r3', 'cc        ', '3',    '3',  'CC',  'cc',     1, 2, -7, 0, 1.70, 0.30, NULL)`,
];
export const UNPADDED = [
  `INSERT INTO t VALUES ('r1', 'abc', 'oops', '42', 'ABC', 'abcdef', 1, 2, -7, 0, 0.10, 0.20, 5)`,
  `INSERT INTO t VALUES ('r2', 'zz',  'oops', '7',  'ZZ',  'zz',     1, 2, -7, 0, 1.00, 2.00, NULL)`,
  `INSERT INTO t VALUES ('r3', 'cc',  '3',    '3',  'CC',  'cc',     1, 2, -7, 0, 1.70, 0.30, NULL)`,
];
// The third row exists only for the cast-rounding case, and its other
// columns are chosen so that no case measured before it existed answers
// differently now: a new row that changed an old answer would invalidate the
// oracle column silently, which is a worse fault than the one it was added
// to catch.
/** Every fixture row must name exactly as many values as there are columns.
 *
 *  The check the lost HANA column asked for: the drift was visible in the
 *  text the whole time and no engine could see it until it ran. Counting is
 *  free and it fails where the mistake is made, not five minutes into a
 *  measurement on another machine. */
export function rowsMatchColumns(rows = [...PADDED, ...UNPADDED]) {
  const wrong = [];
  for (const row of rows) {
    const values = row.slice(row.indexOf("VALUES (") + 8, row.lastIndexOf(")"));
    // split on commas that are not inside a quoted literal
    const count = values.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).length;
    if (count !== COLUMNS.length) wrong.push({row: row.slice(0, 40), count, expected: COLUMNS.length});
  }
  return wrong;
}

const FIXTURE = process.argv.includes("--padded") ? "padded" : "unpadded";
const ROWS = FIXTURE === "padded" ? PADDED : UNPADDED;

/** Which build answered each column.
 *
 *  Added after the question "the browser runs sql.js, but the server runs
 *  SQLite too - should it not be measured?" (Alice, 2026-09-19), which was
 *  right and showed this table had been calling two different engines by one
 *  name. A column headed `sqlite` was a claim that one SQLite stands for
 *  another, and the first probe written to check it found LOG(10) answering
 *  1 on the server's build and 2.302585092994046 in the browser's. So the
 *  build travels with the column: a version nobody printed is a version
 *  nobody compared.
 */
export const BUILDS = {};

async function runDuckDB() {
  const {DuckDBInstance} = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  BUILDS.duckdb = "duckdb " + (await connection.runAndReadAll("SELECT version() AS v")).getRowObjects()[0].v;
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
  // A schema per session, because two of us run this at once and one fixture
  // table called T in one schema is two sessions overwriting each other's
  // measurement - which would not fail, it would answer.
  const c = new HanaDatabaseClient({schema: process.env.HANA_SCHEMA ?? "OSD_CONFORMANCE"});
  await c.connect();
  const ddl = DDL.hana;
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
  BUILDS.sqljs = "sqlite " + db.exec("SELECT sqlite_version()")[0].values[0][0] + " (wasm)";
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

/** SQLite as the SERVER runs it: node:sqlite, the build inside Node itself.
 *
 *  This is not the browser's engine and it is not a spare. `test/run.mjs`
 *  sets `STG_DB=file`, which is tools/sqlite-file-client.mjs over
 *  `node:sqlite`, so it is the engine answering on the deployed showcase --
 *  the one column of this table that describes what is serving users right
 *  now. It was the one missing, and the reason it was missing was an
 *  argument that only ever covered the browser: "the column must describe
 *  the engine that really runs the code". It must, and there is more than
 *  one such engine.
 *
 *  Under the compiled binary the same import is answered by Bun's SQLite
 *  rather than Node's - measured 2026-09-19 as 3.53.2 against Node's 3.53.4,
 *  a third build again. That one is not a column here because this tool runs
 *  under Node; `npm run conformance:bun` runs the same file under Bun, and
 *  the header line says which build actually answered.
 */
async function runSqliteNode() {
  const {DatabaseSync} = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const one = (sql) => Object.values(db.prepare(sql).get() ?? {})[0];
  BUILDS.sqlite_node = "sqlite " + one("SELECT sqlite_version() AS v") +
    (globalThis.Bun === undefined ? " (node)" : " (bun)");
  db.exec(DDL.sqlite);
  for (const row of ROWS) db.exec(row);
  const out = {};
  for (const c of CASES) {
    try {
      const row = db.prepare(c.sql).get();
      const value = row === undefined ? null : Object.values(row)[0];
      out[c.id] = {value: value === null || value === undefined ? null : String(value)};
    } catch (error) {
      out[c.id] = {error: String(error.message ?? error).split("\n")[0].slice(0, 90)};
    }
  }
  db.close();
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
  if (cell.error !== undefined) {
    // "both raised, therefore they agree" hides the case that matters most:
    // one engine rejecting the STATEMENT rather than the data. A syntax or
    // binder error is a defect in what we sent, not a difference between
    // engines, and letting it pass as agreement is an instrument reporting
    // its own brokenness as a clean result.
    // The SAME predicate as the fused/forced comparison, imported rather than
    // written again. There were two copies of this regex and only one of them
    // was taught HANA's wording, so `LOG(10)` -- which HANA refuses with
    // "wrong number of arguments" -- was classified here as a RAISE, i.e. as
    // the engine rejecting the data. Two copies of a predicate is one
    // predicate and one stale opinion.
    return isInvalid(cell.error) ? {kind: "refused", value: cell.error} : {kind: "raised"};
  }
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

/** The engines this host can reach, each with the build that answered.
 *
 *  Exported so a test can run them: until this was a function the file ran
 *  its whole command line on import, which is the defect that once made the
 *  journal tool exit the entire suite. An instrument nobody can call from a
 *  test is an instrument with no guard on it.
 */
export async function measureEngines() {
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
  try {
    engines.sqlite_node = await runSqliteNode();
  } catch (error) {
    console.error(`node:sqlite unavailable: ${error.message}`);
  }
  return {engines, builds: {...BUILDS}};
}

/** The oracle column, kept in the tree because it cannot be re-measured here.
 *
 *  HANA Express lives on another machine, so until now everyone without one
 *  compared against DuckDB under a footer saying it was a stand-in. That
 *  footer was honest and it was also the whole answer: an oracle that exists
 *  on one machine is an oracle nobody can check against, and the instrument
 *  spent three sessions comparing two guesses. The measurement is a fact
 *  about an engine's behaviour over a fixture we wrote -- the same kind of
 *  thing as the protocol facts this repository already keeps -- so it is
 *  tracked. */

/** A class per differing row, with where the treatment lives.
 *
 *  The header of this file has said since it was written that the cases are
 *  **classified, not thresholded** -- "a count of differences says nothing".
 *  Then the oracle column was merged, the count became nine, and the count
 *  was the whole output. The classes existed only as prose in
 *  `sqlscript-lower.mjs`, one comment per dialect entry, with nothing tying
 *  them to the rows they answer.
 *
 *  So they are collected, and the collection is checked in both directions
 *  (`unclassified()` below): a row that differs and has no verdict, and a
 *  verdict for a row that agrees again. The second is the one that rots --
 *  it reads as coverage.
 *
 *  **What this table is about matters: the rows measure the RAW engines.**
 *  Most of these differences never reach a body, because the lowering
 *  rewrites them; `div_zero` and `like_case` are the clearest cases, where
 *  the engine still differs here and the runtime does not. A verdict saying
 *  `done: true` means the treatment exists at `where`; it does not claim the
 *  row will stop differing in this table, and it never will.
 *
 *  `measured` names the suite that watches the treatment, and is absent where
 *  nothing does -- which is a smaller claim than the code deserves in two
 *  places and is written that way on purpose. */
export const VERDICTS = {
  int_div: {class: "typed", done: true,
    where: "sqlscript-lower.mjs DIALECTS.sqlite.divide -- ((a) * 1.0 / (b))",
    measured: "test/sqlscript-values.mjs: division differs by engine exactly where the conformance table said",
    why: "HANA's / over two integers yields a DECIMAL; SQLite truncates. The form has to be chosen from the HANA result type, which is what makes it typed rather than a rewrite."},
  int_div_neg: {class: "typed", done: true,
    where: "the same entry: one rewrite answers both rows",
    measured: "test/sqlscript-treatments.mjs: int_div_neg -- the forced decimal fixes the sign too",
    why: "the sign half of the same divergence. sql.js truncates toward zero and HANA does not, and the forced decimal fixes both -- but the suite above only asserts the positive case, so this row is covered by the same code and not by its own measurement."},
  dec_arith: {class: "typed", done: true,
    where: "DIALECTS.sqlite.decArith -- ROUND(e, scale), for + and - only",
    measured: "test/sqlscript-treatments.mjs: dec_arith, and that an engine with decimals is left alone",
    why: "DECIMAL(15,2) + DECIMAL(15,2). DuckDB has a real decimal and agrees with HANA; SQLite has none and adds in binary floating point. Nothing in the lowering addresses it -- this is the one row of the nine with no treatment anywhere, and it is the one most likely to reach a body unnoticed, because it answers a number that is nearly right."},
  cast_bad: {class: "refuse", done: true,
    where: "sqlscript-lower.mjs DIALECTS.sqlite.castInt -- throws Refused",
    measured: "test/sqlscript-values.mjs: sql.js refuses the cast it cannot make raise, and DuckDB raises",
    why: "SQLite's CAST returns 0 where HANA raises, which is a different program and not a different number. No expression makes it raise, so the dialect declines the node instead of answering quietly."},
  div_zero: {class: "compat", done: true,
    where: "DIALECTS.duckdb.guardZero -- CASE WHEN divisor = 0 THEN error(...); sqlite has none, deliberately",
    measured: "test/sqlscript-treatments.mjs: div_zero -- DuckDB raises, and SQLite's NULL is pinned rather than remembered",
    why: "DuckDB can be made to raise and is. SQLite cannot raise at all, so faithfulness would mean refusing division outright -- a common operator declined for a rare case. That trade is written down in the dialect and the row goes on being measured."},
  like_case: {class: "compat", done: true,
    where: "the CONNECTION, not the dialect: PRAGMA case_sensitive_like = ON in tools/sqljs-native.mjs and tools/sqlite-file-client.mjs",
    measured: "test/sqlscript-treatments.mjs: like_case -- asserted through the client, since that is where the treatment is",
    why: "SQLite's LIKE is case-insensitive for ASCII unless the connection says otherwise. The fix is connection-scoped and survives transactions, so the dialect passes LIKE through -- which means this table, which opens its own connections, keeps showing the difference while the runtime does not have it."},
  cast_char_narrow: {class: "compat", done: true,
    where: "DIALECTS.duckdb.castChar and DIALECTS.sqlite.castChar -- SUBSTR(CAST(e AS VARCHAR), 1, n)",
    measured: "test/sqlscript-treatments.mjs: cast_char_narrow",
    why: "HANA truncates a CAST to a narrower character type and neither other engine does. One expression serves both dialects."},
  cast_round: {class: "compat", done: true,
    where: "DIALECTS.duckdb.castInt -- CAST(TRUNC(CAST(e AS DOUBLE)) AS INTEGER)",
    measured: "test/sqlscript-treatments.mjs: cast_round",
    why: "HANA truncates toward zero where DuckDB rounds. This one shipped wrong before the oracle column existed, which is the strongest argument in this file for tracking the oracle."},
  fn_log: {class: "refuse", done: true,
    where: "sqlscript-lower.mjs PORTABLE -- LOG is not in it, and an unknown function is refused rather than rendered",
    measured: "test/sqlscript-treatments.mjs: fn_log -- the lowering declines",
    why: "HANA takes LOG(base, x) and refuses the one-argument form. The two SQLite builds disagree with each other here -- base ten under Node, natural in the browser -- which is what makes this row the one that catches a build standing in for another."},
};

/** Both directions, because a table of verdicts ages exactly like the notes
 *  this repository already grew a checker for. */
export function unclassified(differing, verdicts = VERDICTS) {
  const differs = new Set(differing);
  return {
    unjudged: [...differs].filter((id) => verdicts[id] === undefined),
    stale: Object.keys(verdicts).filter((id) => differs.has(id) === false),
  };
}

export const ORACLE = "test/sqlscript-hana-oracle.json";

/** What a stored column may be used for, decided without reading a file.
 *
 *  Three answers, and the third is the one instruments here keep losing:
 *  usable, refused, and **usable but incomplete**. A column measured before
 *  a case existed has nothing to say about that case, and the comparison
 *  already knows to call such a row unmeasured -- what it could not know is
 *  the other direction, a stored answer for a case that no longer exists.
 *  That one means the oracle was measured against a different list and is
 *  quietly older than it looks, which is exactly how a fixture drifts by
 *  standing still. So it is reported rather than ignored. */
export function oracleFrom(file, fixture, caseIds) {
  if (file?.hana === undefined) {
    return {refused: "carries no hana column"};
  }
  if (file.fixture !== undefined && file.fixture !== fixture) {
    return {refused: `was measured on the ${file.fixture} fixture and this run is ${fixture}`};
  }
  const known = new Set(caseIds);
  return {
    hana: file.hana,
    measuredAt: file.measuredAt,
    build: file.builds?.hana ?? undefined,
    // a case the oracle never answered: the comparison calls it unmeasured
    missing: caseIds.filter((id) => file.hana[id] === undefined),
    // and a stored answer for a case nobody asks any more
    stale: Object.keys(file.hana).filter((id) => known.has(id) === false),
  };
}

/** where the column came from, in the words the header prints */
export function oracleSource(from, at, build) {
  const when = at === undefined ? "date not recorded" : `measured ${at}`;
  return `hana: ${build ?? "build not recorded"} (${when}, from ${from})`;
}

async function main() {
  const {engines, builds} = await measureEngines();

  // a column measured elsewhere (HANA Express lives on another machine) merges in
  if (process.argv.includes("--hana")) {
    try {
      engines.hana = await runHana();
    } catch (error) {
      console.error("hana: " + (error.message ?? error));
    }
  }
  // Where the oracle column comes from when this machine has no HANA:
  // `--merge <file>` names one, `--no-oracle` asks for none (which is how the
  // stand-in path stays testable), and otherwise the tracked one is used. A
  // default that has to be remembered is a default nobody gets.
  const asked = process.argv.includes("--merge") ? process.argv[process.argv.indexOf("--merge") + 1] : undefined;
  const merged = asked ?? (process.argv.includes("--no-oracle") || engines.hana !== undefined
    || existsSync(ORACLE) === false ? undefined : ORACLE);
  let oracleNote;
  if (merged !== undefined) {
    const file = JSON.parse(readFileSync(merged, "utf8"));
    const use = oracleFrom(file, FIXTURE, CASES.map((c) => c.id));
    if (use.refused !== undefined) {
      // An explicitly named file that cannot be used is an error: somebody
      // asked for it by name. The tracked one is a default, so a refusal
      // there falls back to the stand-in and says so -- the run still works
      // with `--padded`, which is the whole reason the other fixture exists.
      console.error(`refusing the oracle: ${merged} ${use.refused}.` +
        (file.fixture !== undefined ? ` Re-measure it, or ${file.fixture === "padded" ? "add --padded" : "drop --padded"}.` : ""));
      if (asked !== undefined) process.exit(2);
    } else {
      engines.hana = use.hana;
      oracleNote = oracleSource(merged, use.measuredAt, use.build);
      if (use.stale.length > 0) {
        console.error(`the oracle answers ${use.stale.length} case(s) this list no longer has ` +
          `(${use.stale.join(", ")}): it was measured against a different list and is older than it looks.`);
      }
    }
  }
  if (process.argv.includes("--json")) {
    // **`builds` travels with the column.** The oracle merged in today was
    // measured on 2026-09-19 and carries no engine version, because this dump
    // did not write one -- so the tracked file says `null` rather than a
    // guess, and the next measurement will not have to.
    console.log(JSON.stringify({fixture: FIXTURE, cases: CASES, builds: {...builds, ...BUILDS}, ...engines}, null, 1));
  } else {
    const names = Object.keys(engines);
    // the header says which BUILD answered, not only which name: two of these
    // columns are SQLite and they are not the same SQLite
    console.log(`fixture: ${FIXTURE} (the rows as they are written into the table)`);
    console.log(names.map((n) => (n === "hana" && oracleNote !== undefined
      ? oracleNote
      : `${n}: ${BUILDS[n] ?? "build not recorded"}`)).join("\n"));
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
    const unmeasured = [];
    for (const one of CASES) {
      // A row the oracle has not answered is NOT a difference - it is a row
      // nobody has measured, and counting it as a difference is the instrument
      // reporting its own incompleteness as a finding. Three cases added after
      // the oracle column was captured did exactly that until this line existed.
      if (normalise(engines[oracle][one.id]).kind === "missing") {
        unmeasured.push(one);
        continue;
      }
      const differs = others.filter((n) => show(engines[n][one.id]) !== show(engines[oracle][one.id]));
      const actually = others.filter((n) => !agree(engines[n][one.id], engines[oracle][one.id]));
      if (differs.length > 0) nominal.push({one, who: differs});
      if (actually.length > 0) real.push({one, who: actually});
    }
    const compared = CASES.length - unmeasured.length;
    console.log(`against ${oracle}: ${nominal.length} of ${compared} rows compared differ nominally, **${real.length} after normalisation**`);
    if (unmeasured.length > 0) {
      console.log(`  NOT measured against ${oracle} (re-run the oracle column): ${unmeasured.map((one) => one.id).join(", ")}`);
    }
    // per engine, because "nine rows differ" is not a number anybody can act
    // on: one engine may account for all of them
    const comparable = CASES.filter((one) => normalise(engines[oracle][one.id]).kind !== "missing");
    for (const name of others) {
      const nom = comparable.filter((one) => show(engines[name][one.id]) !== show(engines[oracle][one.id])).length;
      const act = comparable.filter((one) => !agree(engines[name][one.id], engines[oracle][one.id])).length;
      console.log(`  ${name.padEnd(8)} ${nom} nominal, ${act} real`);
    }
    const formattingOnly = nominal.filter((n) => !real.some((r) => r.one.id === n.one.id));
    if (formattingOnly.length > 0) {
      console.log(`  formatting only, not behaviour: ${formattingOnly.map((f) => f.one.id).join(", ")}`);
    }
    for (const {one, who} of real) {
      const v = VERDICTS[one.id];
      const verdict = v === undefined ? "UNCLASSIFIED" : `${v.class}${v.done ? "" : " (no treatment yet)"}`;
      console.log(`  ${one.id.padEnd(17)} ${who.join(",").padEnd(14)} ${verdict.padEnd(24)} ${one.why}`);
      if (v?.where !== undefined) console.log(`  ${" ".repeat(17)} ${" ".repeat(14)} -> ${v.where}`);
    }
    // The two ways this table can lie about itself, asked of the run that
    // just happened rather than of a list somebody keeps.
    if (oracle === "hana") {
      const {unjudged, stale} = unclassified(real.map(({one}) => one.id));
      for (const id of unjudged) console.log(`  ${id} differs from HANA and has no class: the count is not the verdict.`);
      for (const id of stale) console.log(`  ${id} has a class and no longer differs -- the verdict is about a row that agrees.`);
    }
    // This footer used to end "the HANA column has to be merged in before any
    // of them can be assigned" -- and it is printed **only** when that column
    // is there, since everything above it compares against the oracle. So it
    // asked for the one thing that had just been done. A closing line that
    // names the next step is read as the next step; one that names a step
    // already taken teaches the reader to skip the footer (2026-09-19).
    if (oracle === "hana") {
      // **The footer names what is not done.** It used to ask for the HANA
      // column and was printed only where that column was present, so it
      // asked for the thing that had just happened; then it asked for classes
      // after the classes existed. A closing line that names a step already
      // taken teaches the reader to skip the footer, so this one is derived
      // from the table rather than written under it.
      const owed = real.map(({one}) => one.id).filter((id) => VERDICTS[id]?.done === false);
      const unwatched = real.map(({one}) => one.id)
        .filter((id) => VERDICTS[id]?.done === true && VERDICTS[id]?.measured === undefined);
      console.log(`\n${real.length} rows differ from the oracle and ${real.length - owed.length} have a treatment.`);
      if (owed.length > 0) {
        console.log(`  no treatment anywhere: ${owed.join(", ")} -- this is the work, not the count.`);
      }
      if (unwatched.length > 0) {
        console.log(`  treated, but no suite watches the treatment: ${unwatched.join(", ")}`);
        console.log("  (the class was read off the dialect; reading and running find different things.)");
      }
    } else {
      console.log("\nA count is not the verdict. Each differing row needs a class -");
      console.log("native / rewrite / typed / compat / host / refuse - and the");
      // when the oracle is a stand-in, a class assigned against DuckDB is a
      // class assigned against a guess
      console.log(`HANA column is absent, so this compares against ${oracle.toUpperCase()}, ` +
        "a stand-in: merge it before assigning any.");
    }
  }

}

if (basename(process.argv[1] ?? "") === "sqlscript-conformance.mjs") await main();
