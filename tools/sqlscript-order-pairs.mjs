// The order pairs: how the portable runtime decides the order a cursor's
// rows come in, case by case, written to test/fixtures/ir-pairs/order.ndjson
// (one JSON object per line; `.ndjson`, since `.jsonl` is ignored). A port
// of the rule (the Go runtime's) must give the same answers on the same
// cases; test/sqlscript-order-pairs.mjs checks the file is current.
//
// Three kinds of line:
//   orderOf    an IR relation and the orders of the table variables it
//              reads -> {kind, why, basis, ties} (orderOf)
//   ordered    a frozen relation -> the rewritten relation's keys and ties,
//              its SQL per dialect, and the rows it visits on DuckDB, SQLite
//              and sql.js (which must agree) -- or {refused: "order"}
//   procedure  a SQLScript body -> the order of each FOR loop's cursor, or
//              the refusal (reason and message)
// The facts behind the rule are in docs/sqlscript-hana-observed.md, "The
// order a cursor's rows come in".
//
//   node tools/sqlscript-order-pairs.mjs           write the file
//   node tools/sqlscript-order-pairs.mjs --check   exit 1 when it is stale
import {readFileSync, writeFileSync, mkdirSync, existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {orderOf, compileProcedure, ORDER_OBSERVED} from "./sqlscript-to-procedure-ir.mjs";
import {orderedRelation} from "./sqlscript-procedure-ir.mjs";
import {lower} from "./sqlscript-lower.mjs";
import {T, lit, col, bin, scan, filter, project, order, union, join as joinRel, aggregate, limit, subquery} from "./sqlscript-ir.mjs";
import {runsAs} from "./osd-main.mjs";

const DIALECTS = ["duckdb", "sqlite", "postgres", "hana"];
const n = col("N", T.int);
const k = col("K", T.int);
const it = {rel: "var", name: "IT"};
const CALLER = {IT: {kind: "defined", why: "the caller's rows of :it", basis: ORDER_OBSERVED, ties: null}};
// the caller's rows, as the destination hands them over: one DUMMY row each
const rowsOf = (list, types = {N: T.int, K: T.int}) => union(list.map((row) =>
  project(scan("DUMMY"), Object.entries(types).map(([name, type], i) => ({as: name, expr: lit(row[i], type)})))), true);
const IT_ROWS = rowsOf([[3, 30], [1, 10], [2, 20]]);

export const ORDER_OF = [
  {id: "one row", rel: scan("DUMMY")},
  {id: "the caller's rows", rel: it},
  {id: "a filter keeps it", rel: filter(it, bin(">", k, lit(10, T.int), T.bool))},
  {id: "a projection keeps it", rel: project(it, [{as: "N", expr: n}])},
  {id: "a filter with a subquery is a semi-join", rel: filter(it, subquery("exists", it))},
  {id: "DISTINCT", rel: {...project(it, [{as: "N", expr: n}]), distinct: true}},
  {id: "a window in the projection", rel: project(it, [{as: "R", expr: {node: "call", fn: "ROW_NUMBER", args: [], window: {orderBy: []}, type: T.int}}])},
  {id: "the cursor's own ORDER BY", rel: order(project(it, [{as: "N", expr: n}, {as: "K", expr: k}]), [{col: "K", desc: false}])},
  {id: "an ORDER BY inside", rel: project(order(it, [{col: "K", desc: false}]), [{as: "N", expr: n}])},
  {id: "a renamed key", rel: project(filter(it, bin(">", k, lit(0, T.int), T.bool)), [{as: "KK", expr: k}, {as: "N", expr: n}])},
  {id: "a union", rel: union([it, it], true)},
  {id: "grouping", rel: aggregate(it, [n], [])},
  {id: "LIMIT", rel: limit(it, 2)},
  {id: "a join", rel: joinRel(it, it, lit(true, T.bool))},
  {id: "a database table", rel: scan("SFLIGHT")},
  {id: "a variable nobody gave an order", rel: {rel: "var", name: "LT"}},
];

export const ORDERED = [
  {id: "the caller's positions", frozen: IT_ROWS},
  {id: "positions through a projection", frozen: project(IT_ROWS, [{as: "N", expr: n}])},
  {id: "the cursor's own ORDER BY, two keys", frozen: order(project(IT_ROWS, [{as: "N", expr: n}, {as: "K", expr: k}]), [{col: "K", desc: true}, {col: "N", desc: false}])},
  {id: "the cursor's own ORDER BY on a renamed column", frozen: order(project(IT_ROWS, [{as: "KK", expr: k}, {as: "N", expr: n}]), [{col: "KK", desc: false}])},
  // rows equal in the ORDER BY: only the key columns are written in visit
  {id: "ties in the data: rows equal in the ORDER BY", frozen: order(project(rowsOf([[3, 1], [1, 2], [2, 1], [4, 2]]), [{as: "N", expr: n}, {as: "K", expr: k}]), [{col: "K", desc: false}])},
  {id: "an ORDER BY key the projection drops is carried", frozen: order(project(IT_ROWS, [{as: "N", expr: n}]), [{col: "K", desc: true}])},
  {id: "NULL first ascending", frozen: order(project(rowsOf([[2, 1], [null, 2], [1, 3]]), [{as: "N", expr: n}]), [{col: "N", desc: false}])},
  {id: "NULL last descending", frozen: order(project(rowsOf([[2, 1], [null, 2], [1, 3]]), [{as: "N", expr: n}]), [{col: "N", desc: true}])},
  {id: "an int64 past 2^31 reads as itself", frozen: rowsOf([[5000000000, 1], [3, 2]], {N: T.int8, K: T.int})},
  {id: "an ORDER BY inside is no order", frozen: project(order(IT_ROWS, [{col: "K", desc: false}]), [{as: "N", expr: n}])},
  {id: "a database table has no positions", frozen: scan("SFLIGHT")},
  {id: "DISTINCT has no order", frozen: {...project(IT_ROWS, [{as: "N", expr: n}]), distinct: true}},
  {id: "DISTINCT under an ORDER BY on a column it does not output", frozen: order({...project(IT_ROWS, [{as: "N", expr: n}]), distinct: true}, [{col: "K", desc: false}])},
  {id: "a union of relations with several rows each", frozen: union([IT_ROWS, IT_ROWS], true)},
  {id: "a union without ALL", frozen: union(IT_ROWS.inputs, false)},
  {id: "LIMIT", frozen: limit(IT_ROWS, 2)},
  {id: "a join", frozen: joinRel(IT_ROWS, IT_ROWS, lit(true, T.bool))},
  {id: "grouping", frozen: aggregate(IT_ROWS, [n], [])},
];

// the procedural cases: a clean-room class with a table of (n, k) coming in
const TYPES = new Map([["TT", {kind: "table", of: "TY"}],
  ["TY", {kind: "structure", components: [{name: "n", abapType: "i"}, {name: "k", abapType: "i"}]}]]);
const SIG = {name: "M", kind: "METHOD", parameters: [
  {name: "it", direction: "IN", abapType: "tt"}, {name: "ev", direction: "OUT", abapType: "string"}]};
const LOOP = (cursor, prologue = "", read = "r.n") => `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR ${cursor};
  ${prologue} FOR r AS c DO v = :v || ${read}; END FOR; ev = :v;`;
export const PROCEDURE = [
  {id: "over the caller's rows", body: LOOP("SELECT n, k FROM :it")},
  {id: "its own ORDER BY over every column read", body: LOOP("SELECT n, k FROM :it ORDER BY k, n")},
  {id: "ties: ORDER BY K, the row carries N too", body: LOOP("SELECT n, k FROM :it ORDER BY k")},
  {id: "a renamed key it reads", body: LOOP("SELECT n AS m FROM :it ORDER BY m", "", "r.m")},
  {id: "an ORDER BY inside a table variable", body: LOOP("SELECT n, k FROM :lt", "lt = SELECT n, k FROM :it ORDER BY k, n;")},
  {id: "DISTINCT", body: LOOP("SELECT DISTINCT n FROM :it")},
  {id: "the same order on both branches", body: LOOP("SELECT n FROM :lt",
    "IF 1 = 1 THEN lt = SELECT n FROM :it; ELSE lt = SELECT n FROM :it WHERE n > 0; END IF;")},
  {id: "different orders on the branches", body: LOOP("SELECT n FROM :lt",
    "IF 1 = 1 THEN lt = SELECT n FROM :it; ELSE lt = SELECT DISTINCT n FROM :it; END IF;")},
  {id: "a later assignment replaces an earlier", body: LOOP("SELECT n FROM :lt",
    "lt = SELECT DISTINCT n FROM :it; lt = SELECT n FROM :it;")},
  {id: "assigned inside a WHILE", body: `DECLARE v NVARCHAR(100) = ''; DECLARE i INTEGER = 0; DECLARE CURSOR c FOR SELECT n FROM :lt;
    lt = SELECT n FROM :it; WHILE :i < 2 DO lt = SELECT n FROM :lt WHERE n > :i; i = :i + 1; END WHILE;
    FOR r AS c DO v = :v || r.n; END FOR; ev = :v;`},
  {id: "a loop over the cursor inside a loop over it", body: `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it;
    FOR r AS c DO FOR s AS c DO v = :v || s.n; END FOR; END FOR; ev = :v;`},
  {id: "a table it reads assigned inside the loop", body: `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :lt; lt = SELECT n FROM :it;
    FOR r AS c DO lt = SELECT n FROM :it WHERE n > 1; v = :v || r.n; END FOR; ev = :v;`},
  {id: "a UNION ALL", body: LOOP("SELECT n FROM :it UNION ALL SELECT n FROM :it")},
  {id: "grouping", body: LOOP("SELECT n, COUNT(*) AS c FROM :it GROUP BY n")},
  {id: "grouping with its own ORDER BY", body: LOOP("SELECT n, COUNT(*) AS c FROM :it GROUP BY n ORDER BY n")},
  {id: "LIMIT", body: LOOP("SELECT n FROM :it LIMIT 2")},
  {id: "a subquery in the WHERE", body: LOOP("SELECT n FROM :it WHERE n IN (SELECT n FROM :it WHERE k > 10)")},
  {id: "a table variable a CALL filled", body: LOOP("SELECT n FROM :lt", "CALL other(:it, lt);")},
  {id: "a cursor with arguments", body: `DECLARE v NVARCHAR(100) = ''; DECLARE CURSOR c FOR SELECT n FROM :it; FOR r AS c(1) DO v = :v || r.n; END FOR; ev = :v;`},
];

/** plain JSON of an order (Sets as sorted arrays) */
const plainOrder = (o) => ({kind: o.kind, why: o.why, ...(o.basis === undefined ? {} : {basis: o.basis}),
  ties: o.ties === null || o.ties === undefined ? null : [...o.ties].sort()});

async function engines() {
  const {DuckDBDatabaseClient} = await import("./duckdb-client.mjs");
  const {FileSqliteClient} = await import("./sqlite-file-client.mjs");
  const initSqlJs = (await import("sql.js")).default;
  const {installNative} = await import("./sqljs-native.mjs");
  const SQL = await initSqlJs({locateFile: () => new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname});
  const sqljs = {sqlite: new SQL.Database()};
  installNative(sqljs);
  const duck = new DuckDBDatabaseClient({path: ":memory:"});
  await duck.connect();
  const lite = new FileSqliteClient({path: ":memory:"});
  await lite.connect();
  return {list: [["duckdb", "duckdb", duck], ["sqlite", "sqlite", lite], ["sql.js", "sqlite", sqljs]],
    close: async () => { await duck.disconnect(); await lite.disconnect(); }};
}

/** a value as the pairs write it: text, so an int64 and a NULL read the same everywhere */
const cell = (v) => (v === null || v === undefined ? null : String(v));

export async function pairs() {
  const out = [{kind: "header", note: "the order a cursor's rows come in, as tools/sqlscript-to-procedure-ir.mjs (orderOf) and tools/sqlscript-procedure-ir.mjs (orderedRelation) decide it; a port gives the same answers, SQL bytes and rows",
    conventions: [
      "normative: kind, basis, ties, keys, sql, visit, and a refusal's reason; informative: why and message, which are the JavaScript runtime's wording and may differ in a port",
      "order: {kind: defined|inherited|unknown, why, basis: guaranteed|observed:<doc anchor>|assumed, ties: the ORDER BY key columns (sorted) or null when there are no ties}",
      "only the cursor query's own ORDER BY is defined (guaranteed); the caller's rows are defined (observed); one row (DUMMY) is defined trivially, there being nothing to order; scan, filter without a subquery, projection without a window or subquery inherit; everything else is unknown",
      "a refusal's reason is order when the rule is why, and unsupported when the body is refused for anything else (the compiler's error has no reason of its own)",
      "ties: when not null, rows equal in those columns may come in any order, so visit lists only those columns; a cursor whose row carries a column outside them is refused -- every column of the row counts as read, whether the loop reads it or not -- at run time as well as at compile time (the backstop, for a program another front end built)",
      "an INT8 literal is a JSON number up to 2^53-1 and a string past it (the same in writes.json and host-relation.json)",
      "hidden keys are __ORD<n>, numbered depth-first bottom-up (the caller's positions first, a projection's carried key after)",
      "every ORDER BY is written ASC NULLS FIRST / DESC NULLS LAST; an integer placeholder on SQLite is CAST(? AS INTEGER)",
      "rows: each visited row's columns as text (null for NULL), identical on DuckDB, SQLite and sql.js",
    ]}];
  for (const one of ORDER_OF) out.push({kind: "orderOf", id: one.id, rel: one.rel, orders: CALLER, expect: plainOrder(orderOf(one.rel, new Map(Object.entries(CALLER))))});
  const {list, close} = await engines();
  try {
    for (const one of ORDERED) {
      const known = orderedRelation(one.frozen);
      if (known === undefined) { out.push({kind: "ordered", id: one.id, frozen: one.frozen, expect: {refused: "order"}}); continue; }
      const query = known.keys.length > 0 ? order(known.rel, known.keys) : known.rel;
      const sql = Object.fromEntries(DIALECTS.map((d) => [d, lower(query, d)]));
      let visit;
      for (const [name, dialect, client] of list) {
        const {rows} = await client.native({...lower(query, dialect), expect: "rows"});
        // with ties, rows equal in the ORDER BY may come in any order: only
        // the key columns are compared and written
        const shown = (c) => !c.startsWith("__ORD") && (known.ties === null || known.ties.has(c.toUpperCase()));
        const seen = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([c]) => shown(c)).map(([c, v]) => [c.toUpperCase(), cell(v)])));
        if (visit === undefined) visit = seen;
        else if (JSON.stringify(seen) !== JSON.stringify(visit)) throw new Error(`order pairs: ${one.id} visits differently on ${name}: ${JSON.stringify(seen)} vs ${JSON.stringify(visit)}`);
      }
      out.push({kind: "ordered", id: one.id, frozen: one.frozen,
        expect: {keys: known.keys, ties: known.ties === null ? null : [...known.ties].sort(), sql, visit}});
    }
  } finally { await close(); }
  for (const one of PROCEDURE) {
    let expect;
    try {
      const program = compileProcedure({...SIG, body: one.body}, TYPES, {});
      const loops = [];
      const walk = (body) => body.forEach((s) => { if (s.stmt === "for-cursor") loops.push({cursor: s.cursorName, order: plainOrder(s.order)}); walk(s.body ?? []); (s.branches ?? []).forEach((b) => walk(b.body ?? [])); walk(s.otherwise ?? []); });
      walk(program.body);
      expect = {loops};
    } catch (error) {
      expect = {refused: error.reason ?? "unsupported", message: error.message};
    }
    out.push({kind: "procedure", id: one.id, body: one.body, expect});
  }
  return out;
}

export const PAIRS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ir-pairs", "order.ndjson");
export const render = async () => (await pairs()).map((line) => JSON.stringify(line)).join("\n") + "\n";

if (runsAs("sqlscript-order-pairs.mjs")) {
  const text = await render();
  if (process.argv.includes("--check")) {
    const current = existsSync(PAIRS_FILE) ? readFileSync(PAIRS_FILE, "utf8") : "";
    if (current !== text) { console.error(`${PAIRS_FILE} is stale: run node tools/sqlscript-order-pairs.mjs`); process.exit(1); }
    console.log("order pairs current");
  } else {
    mkdirSync(dirname(PAIRS_FILE), {recursive: true});
    writeFileSync(PAIRS_FILE, text);
    console.log(`wrote ${PAIRS_FILE}: ${text.split("\n").length - 2} cases`);
  }
}
