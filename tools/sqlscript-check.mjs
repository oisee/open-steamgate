// Take a SQLScript body as text and ask whether fusing changed its answer.
//
//   node tools/sqlscript-check.mjs "lt = SELECT k FROM src; SELECT k FROM :lt;"
//   node tools/sqlscript-check.mjs --file body.sql
//
// This is the first real use of the fused-against-forced instrument rather
// than a test of it: until the front end existed it could only be pointed at
// plans built by hand, and a plan built by hand is a plan somebody already
// understood. A body is not.
//
// What it does: parse, lower, run the plan as the splitter would (one fused
// statement), then run it again with every intermediate forced into a
// relation of its own, and compare. A difference is not automatically a
// defect - HANA fuses too, so the fused answer is the faithful one - but it
// is always a place where fusion is doing something observable, and those
// are the places worth knowing about before somebody finds one in an answer.
//
// The catalogue is the small thing the typer needs: {TABLE: {COL: type}}.
// Given none, the fixture catalogue of the end-to-end harness is used, which
// makes the tool useful on the bodies we already have and honest about the
// fact that it cannot invent a schema it was not given.
import {readFileSync} from "node:fs";
import {lex} from "./sqlscript/lexer.mjs";
import {parse} from "./sqlscript/combi.mjs";
import {Body} from "./sqlscript/expressions/index.mjs";
import {toIr} from "./sqlscript/to-ir.mjs";
import {CATALOGUE} from "./sqlscript/end-to-end.mjs";
import {runBothWays} from "./sqlscript-eager.mjs";

/** text in, relational IR out - the front end, with nothing lowered yet */
export function planOf(body, catalogue = CATALOGUE) {
  return toIr(parse(new Body(), lex(body)), {catalogue}).rel;
}

/**
 * Parse a body and run it both ways on one client.
 *
 * Returns what the comparison found plus the plan, so a caller that sees a
 * difference can look at what was fused rather than only that it was.
 */
export async function checkBody(client, body, dialect, catalogue = CATALOGUE) {
  const rel = planOf(body, catalogue);
  return {rel, ...await runBothWays(client, rel, dialect)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rest = process.argv.slice(2);
  const fileAt = rest.indexOf("--file");
  const body = fileAt === -1
    ? rest.find((argument) => !argument.startsWith("--"))
    : readFileSync(rest[fileAt + 1], "utf8");
  if (body === undefined) {
    console.error('sqlscript-check: give a body, or --file <path>');
    process.exit(2);
  }

  const {DuckDBDatabaseClient} = await import("./duckdb-client.mjs");
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();
  // the same fixture the end-to-end harness uses, so a body written against
  // it runs here without a second schema to keep in step
  await client.native({sql: `CREATE TABLE "SRC" ("K" VARCHAR, "N" INTEGER)`, expect: "none"});
  for (const [k, n] of [["a", 1], ["b", 2], ["c", 3]]) {
    await client.native({sql: `INSERT INTO "SRC" VALUES (?, ?)`, expect: "none",
      params: [{name: "k", value: k, type: "C"}, {name: "n", value: n, type: "I"}]});
  }

  try {
    const result = await checkBody(client, body, "duckdb");
    console.log(`fused:  ${result.fused.raised ?? `${result.fused.rows.length} rows in ${result.fused.statements} statement`}`);
    console.log(`forced: ${result.eager.raised ?? `${result.eager.rows.length} rows in ${result.eager.statements} statements`}`);
    if (result.agree) {
      console.log(`\nno difference (${result.both}) - fusing this body changes nothing observable`);
      process.exit(0);
    }
    console.log(`\nDIFFERENT: ${result.kind}`);
    if (result.raised !== undefined) console.log(`  the raise: ${result.raised}`);
    if (result.fused !== undefined && result.kind === "different-rows") {
      console.log(`  fused:  ${result.fused}`);
      console.log(`  forced: ${result.eager}`);
    }
    console.log("\nThis is not automatically a defect: HANA fuses as well, so the fused");
    console.log("answer is the faithful one. It is a place where fusion is observable,");
    console.log("which is worth knowing before it is found in an answer.");
    process.exit(1);
  } finally {
    await client.disconnect?.();
  }
}
