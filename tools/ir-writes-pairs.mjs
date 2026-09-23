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
import {insertRows, insertFrom, update, remove, upsert, bindRows} from "./ir-writes.mjs";
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
  {name: "MODIFY of key columns only", stmt: () => upsert("T", KEY, bindRows(KEY, SCHEMA, [{mandt: "001", id: 1}, {mandt: "001", id: 8}]), KEY)},
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
export const render = () => JSON.stringify({
  note: "write statements lowered per dialect by tools/ir-writes-pairs.mjs; a port must give the same {sql, params} bytes. Table T (MANDT C3, ID I, TXT C10), key (MANDT, ID), seeded with SEED before each case.",
  seed: SEED, key: KEY, schema: SCHEMA,
  pairs: pairs(),
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
    console.log(`wrote ${PAIRS_FILE}: ${CASES.length} cases x ${DIALECT_ORDER.length} dialects`);
  }
}
