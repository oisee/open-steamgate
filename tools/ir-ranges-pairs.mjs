// The ranges pairs: for each case, rangesPredicate() lowered per dialect,
// {sql, params}, written to test/fixtures/ir-pairs/ranges.json. A port of
// rangesPredicate (the Go runtime's) must give the same bytes on the same
// cases; test/ir-ranges.mjs checks this file is current, so it cannot drift
// from the code that writes it.
//
//   node tools/ir-ranges-pairs.mjs           write the file
//   node tools/ir-ranges-pairs.mjs --check   exit 1 when it is stale
import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {rangesPredicate, lowerPredicate} from "./ir-ranges.mjs";

const C10 = {abap: "C", len: 10};
const N4 = {abap: "C", len: 4};
const I = {abap: "I"};
const r = (SIGN, OPTION, LOW, HIGH) => (HIGH === undefined ? {SIGN, OPTION, LOW} : {SIGN, OPTION, LOW, HIGH});

export const CASES = [
  {name: "empty ranges: no restriction", type: C10, rows: []},
  {name: "I EQ", type: C10, rows: [r("I", "EQ", "A")]},
  {name: "I EQ, CHAR with trailing blanks", type: C10, rows: [r("I", "EQ", "A    ")]},
  {name: "I EQ twice", type: C10, rows: [r("I", "EQ", "A"), r("I", "EQ", "B")]},
  {name: "E EQ only", type: C10, rows: [r("E", "EQ", "A")]},
  {name: "I BT and E EQ", type: C10, rows: [r("I", "BT", "A", "M"), r("E", "EQ", "C")]},
  {name: "I NB", type: C10, rows: [r("I", "NB", "B", "D")]},
  {name: "I NE GT GE LT LE", type: I, rows: [r("I", "NE", 1), r("I", "GT", 2), r("I", "GE", 3), r("I", "LT", 4), r("I", "LE", 5)]},
  {name: "I CP with * + and an escaped *", type: C10, rows: [r("I", "CP", "T*1#*+")]},
  {name: "I CP with a literal % and _", type: C10, rows: [r("I", "CP", "50%_off*")]},
  {name: "I CP with trailing blanks", type: C10, rows: [r("I", "CP", "T*   ")]},
  {name: "E NP", type: C10, rows: [r("E", "NP", "X*")]},
  {name: "I EQ, NUMC zero-padded", type: N4, kind: "NUMC", rows: [r("I", "EQ", "7")]},
];
export const DIALECT_ORDER = ["sqlite", "duckdb", "postgres", "hana"];

export function pairs() {
  return CASES.map((one) => ({
    name: one.name, column: "COL", type: one.type, ...(one.kind === undefined ? {} : {kind: one.kind}), rows: one.rows,
    lowered: Object.fromEntries(DIALECT_ORDER.map((dialect) =>
      [dialect, lowerPredicate(rangesPredicate("COL", one.type, one.rows, {kind: one.kind}), dialect)])),
  }));
}

export const PAIRS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ir-pairs", "ranges.json");
const render = () => JSON.stringify({
  note: "rangesPredicate(COL, type, rows) lowered per dialect by tools/ir-ranges-pairs.mjs; a port must give the same {sql, params} bytes",
  pairs: pairs(),
}, undefined, 2) + "\n";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = render();
  if (process.argv.includes("--check")) {
    const current = existsSync(PAIRS_FILE) ? readFileSync(PAIRS_FILE, "utf8") : "";
    if (current !== text) { console.error(`${PAIRS_FILE} is stale: run node tools/ir-ranges-pairs.mjs`); process.exit(1); }
    console.log("ranges pairs current");
  } else {
    mkdirSync(dirname(PAIRS_FILE), {recursive: true});
    writeFileSync(PAIRS_FILE, text);
    console.log(`wrote ${PAIRS_FILE}: ${CASES.length} cases x ${DIALECT_ORDER.length} dialects`);
  }
}
export {render};
