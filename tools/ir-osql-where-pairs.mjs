// The dynamic-WHERE pairs: for each case, osqlWherePredicate() lowered per
// dialect, {sql, params}, or the error it raises, written to
// test/fixtures/ir-pairs/osql-where.json. A port of osqlWherePredicate (the
// Go runtime's) must give the same bytes on the same cases;
// test/ir-osql-where.mjs checks this file is current.
//
//   node tools/ir-osql-where-pairs.mjs           write the file
//   node tools/ir-osql-where-pairs.mjs --check   exit 1 when it is stale
import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {osqlWherePredicate, errorCode} from "./ir-osql-where.mjs";
import {lowerPredicate} from "./ir-ranges.mjs";
import {runsAs} from "./osd-main.mjs";

// the shape of SFLIGHT, which the A4H measurement ran on (docs/osql-where.md):
// CHAR3, NUMC4, INT4, CURR 15,2, and a STRING for the string case
export const COLUMNS = {
  CARRID: {type: {abap: "C", len: 3}},
  CONNID: {type: {abap: "C", len: 4}, kind: "NUMC"},
  SEATSMAX: {type: {abap: "I"}},
  PRICE: {type: {abap: "P", len: 15, dec: 2}},
  NOTE: {type: {abap: "STRING"}},
};

export const CASES = [
  // what A4H answered with rows
  {name: "empty: every row", where: ""},
  {name: "blank: every row", where: "   "},
  {name: "equality on CHAR", where: "carrid = 'LH'"},
  {name: "a column name in any case", where: "Carrid = 'LH'"},
  {name: "a literal is case-sensitive", where: "carrid = 'lh'"},
  {name: "a CHAR literal cut to the column's length", where: "carrid = 'LH X'"},
  {name: "a doubled quote is one quote", where: "carrid = 'L''H'"},
  {name: "a quoted number against INT4", where: "seatsmax = '385'"},
  {name: "an unquoted number against INT4", where: "seatsmax = 385"},
  {name: "NUMC zero-padded, quoted", where: "connid = '400'"},
  {name: "NUMC zero-padded, unquoted", where: "connid = 400"},
  {name: "a decimal against a packed column", where: "price > '500.5'"},
  {name: "keyword comparisons", where: "carrid EQ 'LH' OR carrid NE 'AA'"},
  {name: "every comparison", where: "seatsmax < 1 OR seatsmax > 2 OR seatsmax <= 3 OR seatsmax >= 4 OR seatsmax <> 5"},
  {name: "AND binds tighter than OR", where: "carrid = 'LH' OR carrid = 'AA' AND seatsmax > 300"},
  {name: "parentheses", where: "( carrid = 'LH' OR carrid = 'AA' ) AND seatsmax > 300"},
  {name: "NOT without parentheses", where: "NOT carrid = 'LH'"},
  {name: "NOT ( ... ), as the producers write it", where: "NOT ( carrid = 'LH' )"},
  {name: "BETWEEN", where: "connid BETWEEN '0000' AND '0400'"},
  {name: "NOT BETWEEN", where: "connid NOT BETWEEN '0' AND '400'"},
  {name: "LIKE", where: "carrid LIKE 'L%'"},
  {name: "NOT LIKE", where: "carrid NOT LIKE 'L%'"},
  {name: "LIKE with ESCAPE", where: "carrid LIKE 'L#_' ESCAPE '#'"},
  {name: "IN", where: "carrid IN ('LH','AA')"},
  {name: "NOT IN", where: "carrid NOT IN ('LH')"},
  {name: "IS NULL", where: "carrid IS NULL"},
  {name: "IS NOT NULL", where: "carrid IS NOT NULL"},
  {name: "a STRING column", where: "note = 'a b '"},
  {name: "a select-options group as the request context writes it", where: "( CARRID = 'LH' OR CARRID = 'AA' ) AND ( NOT ( SEATSMAX > 300 ) )"},
  // what A4H refused, and how
  {name: "an unknown column is semantics", where: "nosuch = '1'"},
  {name: "a literal on the left is semantics", where: "1 = 1"},
  {name: "a missing value is syntax", where: "carrid = "},
  {name: "!= is syntax", where: "carrid != 'LH'"},
  {name: "an unterminated literal is syntax", where: "carrid = 'LH"},
  {name: "text against INT4 is a dump", where: "seatsmax = 'abc'"},
  // what is not carried
  {name: "a host variable is refused", where: "carrid = lv_c"},
  {name: "a column against a column is refused", where: "carrid = connid"},
  {name: "a qualified name is refused", where: "sflight~carrid = 'LH'"},
  {name: "an unquoted number against CHAR is refused", where: "carrid = 5"},
  {name: "a NUMC literal that is not digits is refused", where: "connid = 'A1'"},
];
export const DIALECT_ORDER = ["sqlite", "duckdb", "postgres", "hana"];

function outcome(one) {
  let pred;
  try { pred = osqlWherePredicate(one.where, COLUMNS); }
  catch (error) { return {outcome: errorCode(error)}; }
  if (pred === undefined) return {outcome: {every: true}};
  return {lowered: Object.fromEntries(DIALECT_ORDER.map((dialect) => [dialect, lowerPredicate(pred, dialect)]))};
}

export function pairs() {
  return CASES.map((one) => ({name: one.name, where: one.where, ...outcome(one)}));
}

export const PAIRS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ir-pairs", "osql-where.json");
const render = () => JSON.stringify({
  note: "osqlWherePredicate(where, columns) lowered per dialect by tools/ir-osql-where-pairs.mjs over the columns below; a port must give the same {sql, params} bytes, or the same error. {every: true} is no condition. BETWEEN renders as (>= AND <=), as the ranges do.",
  columns: COLUMNS,
  pairs: pairs(),
}, undefined, 2) + "\n";

if (runsAs("ir-osql-where-pairs.mjs")) {
  const text = render();
  if (process.argv.includes("--check")) {
    const current = existsSync(PAIRS_FILE) ? readFileSync(PAIRS_FILE, "utf8") : "";
    if (current !== text) { console.error(`${PAIRS_FILE} is stale: run node tools/ir-osql-where-pairs.mjs`); process.exit(1); }
    console.log("osql-where pairs current");
  } else {
    mkdirSync(dirname(PAIRS_FILE), {recursive: true});
    writeFileSync(PAIRS_FILE, text);
    console.log(`wrote ${PAIRS_FILE}: ${CASES.length} cases x ${DIALECT_ORDER.length} dialects`);
  }
}
export {render};
