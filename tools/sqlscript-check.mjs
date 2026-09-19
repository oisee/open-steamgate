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
import {adversarialRows, seamType} from "./sqlscript-ir.mjs";

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

/** a benign value of the right shape, for the columns a hazard row does not care about */
function benign(type) {
  const letter = (typeof type === "string" ? type : type?.abap ?? "C").charAt(0).toUpperCase();
  return ["I", "P", "F", "B", "S"].includes(letter) ? 1 : "x";
}

/**
 * Put the rows the plan asks for into a table, and say what went in.
 *
 * Without this the comparison is pointed at data somebody invented to look
 * plausible, and plausible data does not contain the row a cast fails on.
 * With it, "no difference" becomes a statement about the body rather than
 * about our imagination.
 *
 * Only suggestions whose column exists in the schema are inserted; the rest
 * are returned unplanted, because a column we would have to invent is a
 * fixture we would be writing on the plan's behalf.
 */
export async function plantHazards(client, rel, {table, schema, fill = {}, quote = (id) => `"${id}"`}) {
  const wanted = adversarialRows(rel, schema);
  const columns = Object.keys(schema);
  const planted = [];
  const unplanted = [];
  for (const one of wanted) {
    if (one.known !== true) {
      unplanted.push(one);
      continue;
    }
    // The plan names the hazardous column and its value. Every OTHER column
    // is the caller's business, and `fill` is where the caller's knowledge of
    // the body goes: if the body filters on a column, the hazard row has to
    // carry a value that the filter removes, or the two runs will both raise
    // and the comparison will say nothing.
    const values = columns.map((name) => (name === one.column
      ? one.value
      : Object.prototype.hasOwnProperty.call(fill, name) ? fill[name] : benign(schema[name])));
    await client.native({
      sql: `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      expect: "none",
      // seamType, not the raw type object: the seam speaks an ABAP type
      // letter with length, and handing it our node type is the same
      // boundary mistake the value suite caught once already
      params: columns.map((name, index) => ({
        name, value: values[index], type: seamType(schema[name]), isNull: values[index] === null,
      })),
    });
    planted.push(one);
  }
  return {planted, unplanted};
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
    if (rest.includes("--adversarial")) {
      const rel = planOf(body);
      const {planted, unplanted} = await plantHazards(client, rel, {table: "SRC", schema: CATALOGUE.SRC});
      for (const one of planted) console.log(`planted ${one.column} = ${JSON.stringify(one.value)} - ${one.why}`);
      for (const one of unplanted) console.log(`NOT planted: ${one.column} is not in the schema - ${one.why}`);
      if (planted.length === 0) console.log("the plan asks for no hazardous row: nothing in it can behave differently");
      console.log("");
    }
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
