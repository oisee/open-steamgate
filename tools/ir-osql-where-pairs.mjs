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
import {osqlWherePredicate, errorCode, MAX_DEPTH, MAX_TERMS, REASONS} from "./ir-osql-where.mjs";
import {lowerPredicate} from "./ir-ranges.mjs";
import {runsAs} from "./osd-main.mjs";

// the shape of SFLIGHT, which the A4H measurement ran on (docs/osql-where.md):
// CHAR3, NUMC4, INT4, CURR 15,2, DATS, and a STRING for the string case
export const COLUMNS = {
  CARRID: {type: {abap: "C", len: 3}},
  CONNID: {type: {abap: "C", len: 4}, kind: "NUMC"},
  SEATSMAX: {type: {abap: "I"}},
  PRICE: {type: {abap: "P", len: 15, dec: 2}},
  FLDATE: {type: {abap: "D"}},
  NOTE: {type: {abap: "STRING"}},
  // a RAW(4), as the zvdb agent measured RAW on A4H (a table of its own there)
  R: {type: {abap: "X", len: 4}},
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
  {name: "a date", where: "fldate = '20161115'"},
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
  {name: "a quoted literal into STRING drops trailing blanks (ABAP's C to STRING)", where: "note = 'a b '"},
  {name: "a backtick literal into STRING keeps them", where: "note = `a b `"},
  {name: "a backtick literal against CHAR", where: "carrid = `AA`"},
  {name: "an INT4 literal rounds half away from zero", where: "seatsmax = '384.5'"},
  {name: "an INT4 literal rounds down below the half", where: "seatsmax = '385.4'"},
  {name: "a leading plus", where: "seatsmax = '+385'"},
  {name: "a trailing minus is negative", where: "seatsmax = '385-'"},
  {name: "an empty literal against INT4 is 0", where: "seatsmax = ''"},
  {name: "an unquoted negative number", where: "seatsmax > -5"},
  {name: "a packed literal rounds to the column's decimals", where: "price = '422.935'"},
  {name: "a packed literal is bound as a decimal string", where: "price = '1234567890123.5'"},
  {name: "the largest packed value that fits", where: "price = '9999999999999.99'"},
  {name: "the INT4 minimum", where: "seatsmax = '2147483648-'"},
  {name: "nesting at the limit", where: "( ".repeat(256) + "carrid = 'LH'" + " )".repeat(256)},
  {name: "NOT counts toward the nesting", where: "NOT ".repeat(128) + "( ".repeat(128) + "carrid = 'LH'" + " )".repeat(128)},
  {name: "a date cut to eight characters", where: "fldate = '20161115000000'"},
  {name: "a date with dashes is cut, not read", where: "fldate = '2016-11-15'"},
  {name: "a trailing blank in a LIKE pattern on CHAR", where: "carrid LIKE 'AA '"},
  {name: "a CHAR literal is cut in UTF-16 units", where: "carrid = '\u00c4bcd'"},
  {name: "the three producers: a SADL key", where: "( CARRID = 'LH' ) AND ( CONNID = '0400' )"},
  {name: "the three producers: the search help, in lower case", where: "( carrid = 'LH' OR carrid = 'AA' ) AND ( connid = '0400' )"},
  {name: "the three producers: SE16, a negated pattern", where: "NOT ( carrid LIKE 'L%' )"},
  {name: "a select-options group as the request context writes it", where: "( CARRID = 'LH' OR CARRID = 'AA' ) AND ( NOT ( SEATSMAX > 300 ) )"},
  // what A4H refused, and how
  {name: "an unknown column is semantics", where: "nosuch = '1'"},
  {name: "a literal on the left is semantics", where: "1 = 1"},
  {name: "a missing value is syntax", where: "carrid = "},
  {name: "!= is syntax", where: "carrid != 'LH'"},
  {name: "an operator not between blanks is syntax", where: "carrid='LH'"},
  {name: "IS INITIAL is semantics", where: "carrid IS INITIAL"},
  {name: "an escaped host variable is semantics", where: "carrid = @lv_c"},
  {name: "ESCAPE with a wildcard is semantics", where: "carrid LIKE 'A%' ESCAPE '%'"},
  {name: "text against INT4 is a dump", where: "seatsmax = 'abc'"},
  {name: "an exponent against INT4 is a dump", where: "seatsmax = '1e3'"},
  {name: "past INT4 is a dump", where: "seatsmax = '99999999999'"},
  {name: "past the packed digits is a dump", where: "price = '99999999999999.99'"},
  {name: "one past the INT4 maximum is a dump", where: "seatsmax = '2147483648'"},
  {name: "nesting one past the limit", where: "( ".repeat(257) + "carrid = 'LH'" + " )".repeat(257)},
  {name: "NOT past the limit", where: "NOT ".repeat(129) + "( ".repeat(128) + "carrid = 'LH'" + " )".repeat(128)},
  {name: "comparisons past the limit", where: Array(2001).fill("carrid = 'LH'").join(" OR ")},
  {name: "a blank on one side of an operator is not measured", where: "carrid ='LH'"},
  {name: "a keyword run into its literal is not measured", where: "carrid EQ'LH'"},
  {name: "IN run into its parenthesis is not measured", where: "carrid IN('LH')"},
  {name: "IS NOT INITIAL is not measured", where: "carrid IS NOT INITIAL"},
  {name: "an unquoted decimal is not measured", where: "seatsmax = 1.5"},
  {name: "a point with no digit after is not measured", where: "seatsmax = '385.'"},
  {name: "a point with no digit before is not measured", where: "seatsmax = '.5'"},
  {name: "ESCAPE with a trailing blank is not measured", where: "carrid LIKE 'A# ' ESCAPE '#'"},
  {name: "an unterminated literal is malformed, not measured", where: "carrid = 'LH"},
  {name: "a sign on both sides is a format not measured", where: "seatsmax = '-5-'"},
  {name: "a no-break space is not a blank", where: "carrid\u00a0= 'LH'"},
  {name: "a non-BMP literal is refused", where: "carrid = '\ud83d\ude00'"},
  {name: "nesting past the limit is refused", where: "( ".repeat(300) + "carrid = 'LH'" + " )".repeat(300)},
  // what is not carried
  {name: "a host variable is refused", where: "carrid = lv_c"},
  {name: "a column against a column is refused", where: "carrid = connid"},
  {name: "a qualified name is refused", where: "sflight~carrid = 'LH'"},
  {name: "an unquoted number against CHAR is refused", where: "carrid = 5"},
  {name: "a NUMC literal that is not digits is refused", where: "connid = 'A1'"},
  // RAW(4), measured by the zvdb agent: exactly 8 hex digits in upper case
  {name: "a RAW against its 2n upper-case hex digits", where: "r = '0000000A'"},
  {name: "a RAW compared by its bytes", where: "r < '00000100'"},
  {name: "a RAW literal too short is CX_SY_OPEN_SQL_DATA_ERROR", where: "r = '12'"},
  {name: "a RAW literal too long is CX_SY_OPEN_SQL_DATA_ERROR", where: "r = '1200000000'"},
  {name: "a RAW literal in lower case is CX_SY_OPEN_SQL_DATA_ERROR", where: "r = '0000000a'"},
  {name: "a RAW literal with a blank before it is CX_SY_OPEN_SQL_DATA_ERROR", where: "r = ' 0000000A'"},
  {name: "a RAW literal that is empty is CX_SY_OPEN_SQL_DATA_ERROR", where: "r = ''"},
  {name: "an unquoted number against a RAW is CX_SY_OPEN_SQL_DATA_ERROR", where: "r = 12"},
  {name: "IN on a RAW is not measured", where: "r IN ('0000000A')"},
  {name: "BETWEEN on a RAW is not measured", where: "r BETWEEN '00000000' AND '0000000A'"},
  {name: "LIKE on a RAW is not measured", where: "r LIKE '0000%'"},
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
  note: "osqlWherePredicate(where, columns) lowered per dialect by tools/ir-osql-where-pairs.mjs over the columns below; a port must give the same {sql, params} bytes, or the same error class and reason (messages are not part of the contract). {every: true} is no condition.",
  conventions: [
    "BETWEEN renders as (>= AND <=), as the ranges do. A chain of AND or OR is a balanced tree: the first ceil(n/2) terms on the left, the rest on the right, recursively.",
    "P's len is the DDIC length in digits (T.dec(15, 2) is CURR 15,2); a value with more digits than len is a dump. A packed value is bound as a decimal string with exactly dec decimals, no -0; an INTEGER is inlined after its INT4 range check.",
    "abapNumber: only spaces around are ignored (a tab is a number format), empty is 0, a sign leads or trails, digits on both sides of a point, rounded half away from zero on the first digit past dec; a letter is a dump, any other shape is refused as 'number format'.",
    "Errors: the tokenizer runs over the whole string before the parser, so a tokenizer error wins; after that the first error from the left.",
    "Depth counts each '(' and each NOT; more than " + MAX_DEPTH + " is 'too deep'. MAX_TERMS counts comparisons (a column with its operator), not IN values; more than " + MAX_TERMS + " is 'too deep'.",
    "Blanks are space, tab, CR and LF. An operator with no blank on either side is _SYNTAX, with a blank on one side only 'malformed'; a word run into a quote or a '(' is 'malformed'.",
    "D is C(8), the literal cut. A LIKE pattern is a STRING, bound; ESCAPE is a bound one-character STRING; a trailing blank in the pattern is dropped only without an ESCAPE.",
    "A surrogate anywhere in a literal refuses it before any cut; a CHAR literal is cut in UTF-16 code units. NUMC: spaces trimmed, then zero-padded; not digits (or empty) is 'numc'.",
  ],
  reasons: REASONS,
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
