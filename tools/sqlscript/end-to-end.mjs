// The whole chain, on one body, against every engine that can carry it.
//
//   text -> lex -> parse -> bind & type -> lower -> native() -> values
//
// Until now each stage was tested against the next one's fixtures. This runs
// a body a person could have typed all the way to rows, on HANA, DuckDB and
// sql.js, and compares the **values** -- which is the comparison the
// conformance table established is the only defensible one, because an
// exception is a property of the plan rather than of the program
// (docs/sqlscript-hana-observed.md).
//
//   node tools/sqlscript/end-to-end.mjs            # the local engines
//   node tools/sqlscript/end-to-end.mjs --hana     # and HANA Express
import {lex} from "./lexer.mjs";
import {parse} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {toIr} from "./to-ir.mjs";
import {lower} from "../sqlscript-lower.mjs";

/** the fixture, in our own DDIC shapes, written once for every engine */
export const CATALOGUE = {SRC: {K: {abap: "C", len: 4}, N: {abap: "I"}}};
const ROWS = [["a", 1], ["b", 2], ["c", 3]];

/** a body a person could have typed: assign, filter, read */
export const BODY = `
  lt = SELECT k, n FROM src WHERE n > 1;
  SELECT k, n FROM :lt ORDER BY k;
`;

export function compile(body, dialect, catalogue = CATALOGUE) {
  const ir = toIr(parse(new Body(), lex(body)), {catalogue});
  return {ir, ...lower(ir.rel, dialect)};
}

async function onEngine(label, client, dialect, quote) {
  const out = {engine: label};
  try {
    await client.native({sql: `CREATE TABLE ${quote("SRC")} (${quote("K")} VARCHAR, ${quote("N")} INTEGER)`, expect: "none"});
    for (const [k, n] of ROWS) {
      await client.native({sql: `INSERT INTO ${quote("SRC")} VALUES (?, ?)`, expect: "none",
        params: [{name: "k", value: k, type: "C"}, {name: "n", value: n, type: "I"}]});
    }
    const {sql, params} = compile(BODY, dialect);
    out.sql = sql;
    out.statements = 1;
    const answer = await client.native({sql, params});
    out.rows = answer.rows;
  } catch (error) {
    out.error = String(error.message ?? error).split("\n")[0].slice(0, 120);
  }
  return out;
}

export async function run({hana = false} = {}) {
  const results = [];

  const {DuckDBDatabaseClient} = await import("../duckdb-client.mjs");
  const duck = new DuckDBDatabaseClient({});
  await duck.connect();
  results.push(await onEngine("duckdb", duck, "duckdb", (s) => `"${s}"`));
  await duck.disconnect();

  const {installNative} = await import("../sqljs-native.mjs");
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({locateFile: () => new URL("../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).pathname});
  const js = installNative({sqlite: new SQL.Database()});
  results.push(await onEngine("sqljs", js, "sqlite", (s) => `"${s}"`));

  if (hana) {
    const {HanaDatabaseClient} = await import("../hana-client.mjs");
    const c = new HanaDatabaseClient({schema: "OSD_E2E"});
    await c.connect();
    await c.native({sql: `DROP TABLE "SRC"`, expect: "none"}).catch(() => undefined);
    results.push(await onEngine("hana", c, "hana", (s) => `"${s}"`));
    await c.disconnect();
  }
  return results;
}

if (process.argv[1]?.endsWith("end-to-end.mjs")) {
  const results = await run({hana: process.argv.includes("--hana")});
  for (const r of results) {
    console.log(`\n${r.engine}`);
    console.log(`  sql   ${r.sql ?? "-"}`);
    console.log(`  rows  ${r.error ?? JSON.stringify(r.rows)}`);
  }
  const shapes = results.filter((r) => r.rows !== undefined)
    .map((r) => JSON.stringify(r.rows.map((row) => Object.values(row))));
  console.log("");
  console.log(new Set(shapes).size <= 1
    ? `the same values on all ${shapes.length} engines that answered`
    : `VALUES DIFFER between the engines -- that is the finding, not a failure`);
  process.exit(0);
}
