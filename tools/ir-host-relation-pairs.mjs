// The host-relation pairs: what a host relation holds for given rows, and
// what a query over it answers, written to test/fixtures/ir-pairs/
// host-relation.json. The Go runtime's virtual table must hold the same
// values (column by column, as text) and give the same answers;
// test/ir-host-relation.mjs checks the file is current and that DuckDB and
// SQLite, through tools/ir-host-relation.mjs, answer what it says.
//
//   node tools/ir-host-relation-pairs.mjs           write the file
//   node tools/ir-host-relation-pairs.mjs --check   exit 1 when it is stale
import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {boundRows, columnType, hostPlan, objectRows, ORDINAL} from "./ir-host-relation.mjs";
import {lower} from "./sqlscript-lower.mjs";
import {T, lit, col, bin, project, filter, order} from "./sqlscript-ir.mjs";
import {runsAs} from "./osd-main.mjs";

export const DIALECTS = ["sqlite", "duckdb", "postgres", "hana"];
// INT8 values are given as strings in this file (JSON has no 64-bit
// integer); a host hands them over as a BigInt or a number
export const SCHEMA = {MANDT: T.char(3), ID: T.int, BIG: T.int8, AMOUNT: T.dec(15, 2), DAY: T.date, NOTE: T.str};
const S = SCHEMA;

export const CASES = [
  {name: "every type, as ABAP holds it: CHAR right-trimmed, P the decimal string, a trailing sign, a blank date, INT8 past 2^53",
    rows: [
      {MANDT: "001", ID: 3, BIG: "9007199254740993", AMOUNT: "12.5", DAY: "20260924", NOTE: "three"},
      {MANDT: "001 ", ID: 1, BIG: "-5", AMOUNT: 3, DAY: "", NOTE: ""},
      {MANDT: "002", ID: 2, BIG: "12", AMOUNT: "0.5-", DAY: "20261231", NOTE: "two"},
    ],
    query: () => undefined},
  {name: "a field the row does not name is the type's initial value", rows: [{ID: 7}], query: () => undefined},
  {name: "a filter with arithmetic on a packed column, sorted: the host relation answers as the rows would",
    rows: [
      {MANDT: "001", ID: 3, AMOUNT: "10.00"}, {MANDT: "001", ID: 1, AMOUNT: "2.50"}, {MANDT: "002", ID: 2, AMOUNT: "7.75"},
    ],
    query: (source) => order(project(filter(source, bin(">", bin("*", col("AMOUNT", S.AMOUNT), lit(2, T.int), S.AMOUNT), lit("5.00", S.AMOUNT), T.bool)),
      [{as: "ID", expr: col("ID", S.ID)}, {as: "AMOUNT", expr: col("AMOUNT", S.AMOUNT)}]), [{col: "ID", desc: false}]),
    answer: [["2", "7.75"], ["3", "10.00"]]},
  // sorted where text order is not number order: a P or an INT8 held as text
  // would put "10.00" before "9.50" and "100" before "20"
  {name: "sorted by a packed column: numbers, not text", rows: [{ID: 1, AMOUNT: "10.00"}, {ID: 2, AMOUNT: "9.50"}, {ID: 3, AMOUNT: "100.00"}, {ID: 4, AMOUNT: "-2.00"}],
    query: (source) => order(project(source, [{as: "ID", expr: col("ID", S.ID)}]), [{col: "AMOUNT", desc: false}]),
    answer: [["4"], ["2"], ["1"], ["3"]]},
  {name: "sorted by an INT8 column past 2^53: numbers, not text", rows: [{ID: 1, BIG: "9007199254740993"}, {ID: 2, BIG: "20"}, {ID: 3, BIG: "100"}, {ID: 4, BIG: "-9007199254740993"}],
    query: (source) => order(project(source, [{as: "ID", expr: col("ID", S.ID)}]), [{col: "BIG", desc: true}]),
    answer: [["1"], ["3"], ["2"], ["4"]]},
  {name: "the caller's order, read through the ordinal", rows: [{ID: 30}, {ID: 10}, {ID: 20}],
    // the relation itself, below hostPlan's projection, which leaves the ordinal out
    query: (source) => order(project(source.input, [{as: "ID", expr: col("ID", S.ID)}, {as: ORDINAL, expr: col(ORDINAL, T.int)}]), [{col: ORDINAL, desc: false}]),
    answer: [["30", "0"], ["10", "1"], ["20", "2"]]},
];

const held = (rows) => boundRows(SCHEMA, objectRows(rows)).map((row, i) => [...row.map((v) => String(v.value)), String(i)]);

export function pairs() {
  const handle = {ident: "IT", ref: '"IT"'};
  return CASES.map((one) => {
    const plan = one.query(hostPlan(handle, SCHEMA));
    return {
      name: one.name,
      rows: one.rows,
      held: held(one.rows),
      ...(plan === undefined ? {} : {
        lowered: Object.fromEntries(DIALECTS.map((d) => [d, lower(plan, d, {relationRef: (h) => h.ref})])),
        answer: one.answer,
      }),
    };
  });
}

export const PAIRS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ir-pairs", "host-relation.json");

export const render = () => JSON.stringify({
  note: "Host relations (tools/ir-host-relation.mjs). A host hands rows = {length, get(i, column)}; the relation holds, per row, the schema's columns and then OSD_ORD, the row's index from 0. `held` is each value as text, as ABAP holds it: get() never answers null, a field not named is the type's initial value (C '', I/INT8 0, P '0.00', D '00000000', STRING ''), C is right-trimmed, P the decimal string of its type (abapNumber's grammar, extra decimals refused), D is CHAR 8. Rows come in index order and nothing is pushed down. The handle lives one call; a second drop is not an error. `rows` is what a host hands over: a number, a string or (INT8 past 2^53, written here as a string) a BigInt; a P may come as a number or as text, with a trailing sign. What the relation must hold, per type: I, INT8 and OSD_ORD as integers (INT8 exact past 2^53), P as a number (DECIMAL where the engine has it; SQLite keeps a REAL), C, D and STRING as text -- a P or an INT8 held as text sorts and compares wrongly, which the two sorting pairs catch. `lowered` renders the query with the relation named \"IT\" (substitute the relation's own name); a param's `type` is the ABAP type code (C(3), I, INT8, P(15,2), D, STRING); `answer` is its rows as text.",
  schema: SCHEMA,
  ordinal: ORDINAL,
  ddl: Object.fromEntries(DIALECTS.map((d) => [d, Object.fromEntries([...Object.entries(SCHEMA).map(([c, t]) => [c, columnType(t, d)]), [ORDINAL, "INTEGER"]])])),
  pairs: pairs(),
}, undefined, 2) + "\n";

if (runsAs("ir-host-relation-pairs.mjs")) {
  const text = render();
  if (process.argv.includes("--check")) {
    const current = existsSync(PAIRS_FILE) ? readFileSync(PAIRS_FILE, "utf8") : "";
    if (current !== text) { console.error(`${PAIRS_FILE} is stale: run node tools/ir-host-relation-pairs.mjs`); process.exit(1); }
    console.log("host-relation pairs current");
  } else {
    mkdirSync(dirname(PAIRS_FILE), {recursive: true});
    writeFileSync(PAIRS_FILE, text);
    console.log(`wrote ${PAIRS_FILE}: ${CASES.length} cases`);
  }
}
