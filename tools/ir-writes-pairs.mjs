// The write pairs: each case's statement lowered per dialect, {sql, params}
// or the refusal, written to test/fixtures/ir-pairs/writes.json. A port of
// the write rendering (the Go runtime's) must give the same bytes on the same
// cases; test/ir-writes.mjs checks the file is current and runs every case on
// DuckDB and SQLite.
//
//   node tools/ir-writes-pairs.mjs           write the file
//   node tools/ir-writes-pairs.mjs --check   exit 1 when it is stale
import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {insertRows, insertFrom, update, remove, upsert, bindRows, bindValue} from "./ir-writes.mjs";
import {lower, Refused} from "./sqlscript-lower.mjs";
import {T, lit, col, bin, scan, filter, project} from "./sqlscript-ir.mjs";
import {runsAs} from "./osd-main.mjs";

export const SCHEMA = {MANDT: {abap: "C", len: 3}, ID: {abap: "I"}, TXT: {abap: "C", len: 10}};
export const KEY = ["MANDT", "ID"];
const COLS = ["MANDT", "ID", "TXT"];
const eq = (c, v) => bin("=", col(c, SCHEMA[c]), lit(v, SCHEMA[c]), T.bool);
const and = (a, b) => bin("AND", a, b, T.bool);
const rows = (...list) => bindRows(COLS, SCHEMA, list);

// the table before every case: (001, 1, one), (001, 2, two), (002, 1, other)
export const SEED = [["001", 1, "one"], ["001", 2, "two"], ["002", 1, "other"]];

export const CASES = [
  {name: "INSERT one row, CHAR bound right-trimmed", stmt: () => insertRows("T", COLS, rows({mandt: "001", id: 3, txt: "three  "}))},
  {name: "INSERT two rows", stmt: () => insertRows("T", COLS, rows({mandt: "001", id: 3, txt: "three"}, {mandt: "001", id: 4, txt: "four"}))},
  {name: "INSERT a duplicate key: the engine raises", stmt: () => insertRows("T", COLS, rows({mandt: "001", id: 1, txt: "again"}))},
  {name: "INSERT skipping duplicate keys", stmt: () => insertRows("T", COLS, rows({mandt: "001", id: 1, txt: "again"}, {mandt: "001", id: 5, txt: "five"}), {onDuplicate: "ignore"})},
  {name: "INSERT FROM a select", stmt: () => insertFrom("T", COLS, project(filter(scan("T"), eq("MANDT", "002")),
    [{as: "MANDT", expr: lit("003", SCHEMA.MANDT)}, {as: "ID", expr: col("ID", SCHEMA.ID)}, {as: "TXT", expr: col("TXT", SCHEMA.TXT)}]))},
  {name: "UPDATE one row by key", stmt: () => update("T", [{col: "TXT", expr: lit("uno", SCHEMA.TXT)}], and(eq("MANDT", "001"), eq("ID", 1)))},
  {name: "UPDATE every row of a client", stmt: () => update("T", [{col: "TXT", expr: lit("x", SCHEMA.TXT)}], eq("MANDT", "001"))},
  {name: "DELETE one row by key", stmt: () => remove("T", and(eq("MANDT", "001"), eq("ID", 2)))},
  {name: "MODIFY: one row updated, one inserted", stmt: () => upsert("T", COLS, rows({mandt: "001", id: 1, txt: "uno"}, {mandt: "001", id: 7, txt: "seven"}), KEY)},
  {name: "INSERT FROM TABLE with a duplicate: the others written, the host raises", stmt: () => insertRows("T", COLS,
    rows({mandt: "001", id: 3, txt: "b"}, {mandt: "001", id: 1, txt: "dup"}, {mandt: "001", id: 4, txt: "c"}), {onDuplicate: "raise"})},
  {name: "INSERT FROM TABLE with a duplicate inside the table: the first written", stmt: () => insertRows("T", COLS,
    rows({mandt: "001", id: 5, txt: "first"}, {mandt: "001", id: 5, txt: "second"}), {onDuplicate: "raise"})},
  {name: "INSERT FROM a select, skipping duplicate keys", stmt: () => insertFrom("T", COLS, project(scan("T"),
    [{as: "MANDT", expr: col("MANDT", SCHEMA.MANDT)}, {as: "ID", expr: bin("+", col("ID", SCHEMA.ID), lit(1, SCHEMA.ID), SCHEMA.ID)}, {as: "TXT", expr: col("TXT", SCHEMA.TXT)}]),
    {onDuplicate: "ignore"})},
  {name: "MODIFY with a key twice: the last row wins", stmt: () => upsert("T", COLS, rows({mandt: "001", id: 1, txt: "a"}, {mandt: "001", id: 1, txt: "b"}), KEY)},
  {name: "MODIFY with a field left out writes its initial value", stmt: () => upsert("T", COLS, rows({mandt: "001", id: 8}), KEY)},
];
// a table with packed columns: an amount (P 15,2) and a TIMESTAMP (P 15,0)
export const P_SCHEMA = {MANDT: {abap: "C", len: 3}, ID: {abap: "I"}, AMOUNT: {abap: "P", len: 15, dec: 2}, TS: {abap: "P", len: 15, dec: 0}};
const P_COLS = ["MANDT", "ID", "AMOUNT", "TS"];
const prow = (...list) => bindRows(P_COLS, P_SCHEMA, list);
const peq = (c, v) => bin("=", col(c, P_SCHEMA[c]), lit(v, P_SCHEMA[c]), T.bool);
export const P_SEED = [["001", 1, "10.00", "20260924120000"], ["001", 2, "0.50", "20260101000000"]];
export const P_CASES = [
  {name: "INSERT a packed amount and a TIMESTAMP, as decimal strings of the type", stmt: () => insertRows("P", P_COLS,
    prow({mandt: "001", id: 3, amount: "12.5", ts: "20260924123456"}))},
  {name: "INSERT a packed value given as a number", stmt: () => insertRows("P", P_COLS, prow({mandt: "001", id: 4, amount: 3, ts: 20260924000000}))},
  {name: "INSERT a negative amount", stmt: () => insertRows("P", P_COLS, prow({mandt: "001", id: 5, amount: "-7.25", ts: "0"}))},
  {name: "MODIFY with the packed fields left out writes their initial values", stmt: () => upsert("P", P_COLS, prow({mandt: "001", id: 6}), ["MANDT", "ID"])},
  {name: "UPDATE a packed amount by key", stmt: () => update("P", [{col: "AMOUNT", expr: bindValue("99.99", P_SCHEMA.AMOUNT)}], bin("AND", peq("MANDT", "001"), peq("ID", 1), T.bool))},
  {name: "MODIFY a TIMESTAMP on an existing row", stmt: () => upsert("P", P_COLS, prow({mandt: "001", id: 2, amount: "0.5", ts: "20261231235959"}), ["MANDT", "ID"])},
  // arithmetic with a packed parameter: the placeholder says its type, or
  // DuckDB reads the bound text as VARCHAR (a Binder Error, or '12.50' * 2
  // cast to INTEGER and answered as 26) and SQLite compares it as text
  {name: "UPDATE an amount by arithmetic on a packed parameter", stmt: () => update("P",
    [{col: "AMOUNT", expr: bin("*", col("AMOUNT", P_SCHEMA.AMOUNT), bindValue("2", P_SCHEMA.AMOUNT), P_SCHEMA.AMOUNT)}],
    bin("AND", peq("MANDT", "001"), peq("ID", 1), T.bool))},
  {name: "UPDATE where arithmetic on a packed column meets a packed parameter", stmt: () => update("P",
    [{col: "TS", expr: bindValue("1", P_SCHEMA.TS)}],
    bin("=", bin("+", col("AMOUNT", P_SCHEMA.AMOUNT), bindValue("0", P_SCHEMA.AMOUNT), P_SCHEMA.AMOUNT), bindValue("10", P_SCHEMA.AMOUNT), T.bool))},
  {name: "INSERT the product of a packed parameter and an integer", stmt: () => insertRows("P", P_COLS,
    [[bindValue("001", P_SCHEMA.MANDT), bindValue(7, P_SCHEMA.ID),
      bin("*", bindValue("12.50", P_SCHEMA.AMOUNT), lit(2, T.int), P_SCHEMA.AMOUNT), bindValue("0", P_SCHEMA.TS)]])},
];
// a wide packed column, P 31,14: past a double's 15 digits, so a value that
// reaches the engine as a JavaScript number arrives rounded. Exact on the
// engines with a decimal type; SQLite has none (NUMERIC affinity, a REAL).
export const W_SCHEMA = {MANDT: {abap: "C", len: 3}, ID: {abap: "I"}, BIG: {abap: "P", len: 31, dec: 14}};
const W_COLS = ["MANDT", "ID", "BIG"];
const wrow = (...list) => bindRows(W_COLS, W_SCHEMA, list);
export const W_SEED = [["001", 1, "0.00000000000001"]];
export const W_EXACT = ["duckdb", "postgres", "hana"];
export const W_CASES = [
  {name: "INSERT a P 31,14 value with all 31 digits", stmt: () => insertRows("W", W_COLS,
    wrow({mandt: "001", id: 2, big: "12345678901234567.12345678901234"}))},
  {name: "UPDATE a P 31,14 value to its negative extreme", stmt: () => update("W",
    [{col: "BIG", expr: bindValue("-99999999999999999.99999999999999", W_SCHEMA.BIG)}],
    bin("AND", bin("=", col("MANDT", W_SCHEMA.MANDT), lit("001", W_SCHEMA.MANDT), T.bool), bin("=", col("ID", W_SCHEMA.ID), lit(1, W_SCHEMA.ID), T.bool), T.bool))},
];
// a RAW(4): its value is 8 hex digits in upper case; what a write gives it is
// cut or padded with 00 to 4 bytes, and a text goes by ABAP's c -> x rule
// (the longest prefix of [0-9A-F], an odd count padded with a 0) -- measured
// on A4H by the zvdb agent, 2026-09-24
export const R_SCHEMA = {MANDT: {abap: "C", len: 3}, ID: {abap: "I"}, R: {abap: "X", len: 4}};
const R_COLS = ["MANDT", "ID", "R"];
const rrow = (...list) => bindRows(R_COLS, R_SCHEMA, list);
export const R_SEED = [["001", 1, "0000000A"]];
export const R_CASES = [
  {name: "INSERT a RAW as its 8 hex digits", stmt: () => insertRows("R", R_COLS, rrow({mandt: "001", id: 2, r: "DEADBEEF"}))},
  {name: "INSERT a short RAW: padded with 00", stmt: () => insertRows("R", R_COLS, rrow({mandt: "001", id: 3, r: "12"}))},
  {name: "INSERT a long RAW: cut to 4 bytes", stmt: () => insertRows("R", R_COLS, rrow({mandt: "001", id: 4, r: "1234567890"}))},
  {name: "INSERT a text by the c -> x rule: the hex prefix, an odd count padded", stmt: () => insertRows("R", R_COLS, rrow({mandt: "001", id: 5, r: "ABCg12"}))},
  {name: "MODIFY with the RAW left out writes 4 zero bytes", stmt: () => upsert("R", R_COLS, rrow({mandt: "001", id: 6}), ["MANDT", "ID"])},
];
export const DIALECT_ORDER = ["sqlite", "duckdb", "postgres", "hana"];

function rendered(stmt, dialect) {
  try { return lower(stmt, dialect); }
  catch (error) {
    if (error instanceof Refused) return {refused: error.message};
    throw error;
  }
}

export function pairs() {
  return CASES.map((one) => {
    const stmt = one.stmt();
    return {name: one.name, statement: stmt, lowered: Object.fromEntries(DIALECT_ORDER.map((dialect) => [dialect, rendered(stmt, dialect)]))};
  });
}

export const PAIRS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ir-pairs", "writes.json");
export function packedPairs() {
  return P_CASES.map((one) => {
    const stmt = one.stmt();
    return {name: one.name, statement: stmt, lowered: Object.fromEntries(DIALECT_ORDER.map((dialect) => [dialect, rendered(stmt, dialect)]))};
  });
}

export function widePairs() {
  return W_CASES.map((one) => {
    const stmt = one.stmt();
    return {name: one.name, statement: stmt, lowered: Object.fromEntries(DIALECT_ORDER.map((dialect) => [dialect, rendered(stmt, dialect)]))};
  });
}

export function rawPairs() {
  return R_CASES.map((one) => {
    const stmt = one.stmt();
    return {name: one.name, statement: stmt, lowered: Object.fromEntries(DIALECT_ORDER.map((dialect) => [dialect, rendered(stmt, dialect)]))};
  });
}

export const render = () => JSON.stringify({
  note: "write statements lowered per dialect by tools/ir-writes-pairs.mjs; a port must give the same {sql, params} bytes. Table T (MANDT C3, ID I, TXT C10), key (MANDT, ID), seeded with SEED before each case.",
  seed: SEED, key: KEY, schema: SCHEMA,
  pairs: pairs(),
  packed: {
    note: "Table P (MANDT C3, ID I, AMOUNT P 15,2, TS P 15,0 -- a TIMESTAMP), key (MANDT, ID), seeded with seed before each case. A packed value is a decimal string with exactly the type's decimals; more non-zero decimals than the type, or more digits than its length, is refused (an ABAP work area cannot hold it), not rounded.",
    seed: P_SEED, schema: P_SCHEMA, pairs: packedPairs(),
  },
  wide: {
    note: "Table W (MANDT C3, ID I, BIG P 31,14), key (MANDT, ID), seeded with seed before each case. Every packed parameter binds as its decimal string, never as a JavaScript number: 31 digits do not survive a double. The engines in exact read BIG back digit for digit; SQLite has no decimal type and keeps a REAL.",
    seed: W_SEED, schema: W_SCHEMA, exact: W_EXACT, pairs: widePairs(),
  },
  raw: {
    note: "Table R (MANDT C3, ID I, R RAW(4) stored as its 8 hex digits in upper case, as the transpiler's schema has it), key (MANDT, ID), seeded with seed before each case. A written RAW is cut or padded with 00 to its length; a text goes by ABAP's c -> x rule; an initial RAW is its zero bytes, never empty.",
    seed: R_SEED, schema: R_SCHEMA, pairs: rawPairs(),
  },
}, undefined, 2) + "\n";

if (runsAs("ir-writes-pairs.mjs")) {
  const text = render();
  if (process.argv.includes("--check")) {
    const current = existsSync(PAIRS_FILE) ? readFileSync(PAIRS_FILE, "utf8") : "";
    if (current !== text) { console.error(`${PAIRS_FILE} is stale: run node tools/ir-writes-pairs.mjs`); process.exit(1); }
    console.log("write pairs current");
  } else {
    mkdirSync(dirname(PAIRS_FILE), {recursive: true});
    writeFileSync(PAIRS_FILE, text);
    console.log(`wrote ${PAIRS_FILE}: ${CASES.length + P_CASES.length + W_CASES.length} cases x ${DIALECT_ORDER.length} dialects`);
  }
}
