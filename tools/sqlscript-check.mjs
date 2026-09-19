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
import {adversarialRows, seamType, tableShapesFor} from "./sqlscript-ir.mjs";

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
  const abap = (typeof type === "string" ? type : type?.abap ?? "C").toUpperCase();
  if (abap === "STRING") return "x";
  return ["I", "P", "F", "B", "S"].includes(abap.charAt(0)) ? 1 : "x";
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

/** the SQL type to declare a column as, per dialect, from our own type shape */
function declaredAs(type, dialect) {
  const abap = (type?.abap ?? "C").toUpperCase();
  // STRING before the letter test, and this is not pedantry: the letters are
  // single characters, "STRING" is a word, and `charAt(0)` turned it into
  // "S" - a short integer. So a column holding text was declared INTEGER and
  // the hazard row could not be inserted at all. A test on the first letter
  // is wider than the letters it means, which is the same shape as a suffix
  // test being wider than the filename it means, one day earlier.
  if (abap === "STRING") return "VARCHAR";
  const letter = abap.charAt(0);
  if (["I", "B", "S"].includes(letter)) return "INTEGER";
  if (["P", "F"].includes(letter)) return dialect === "sqlite" ? "NUMERIC" : "DECIMAL(15,2)";
  return "VARCHAR";
}

/**
 * Run a body against tables invented from the body itself.
 *
 * The seven corpus bodies that could be compared were the self-contained
 * ones - reading nothing but their parameters - and not one of them could
 * diverge, because a body that divides or casts almost always reads a table.
 * The filter that made bodies runnable is the filter that removed everything
 * worth looking at. So the tables are built from the plan: what is done to a
 * column says enough to declare it, and the hazardous rows come from the plan
 * too.
 *
 * What this proves and what it does not, kept together on purpose. It
 * compares **fusing against forcing** on the same invented data, which is a
 * real answer about the body's shape. It says **nothing** about whether the
 * body returns what it returns on a real system, because the data is not the
 * real data - and no amount of care here can make it so.
 */
export async function runOnInventedTables(client, rel, dialect, {rows = 3} = {}) {
  const shapes = tableShapesFor(rel);
  if (shapes.tables.length === 0) {
    return {skipped: "the plan reads no table, so there is nothing to invent"};
  }
  if (shapes.ambiguous) {
    // a column reference is a bare name and the plan cannot say which table
    // it belongs to; inventing both tables with all the columns would run,
    // and would be a fixture nobody could reason about
    return {skipped: `the plan reads ${shapes.tables.length} tables and a column cannot be attributed to one`};
  }
  const table = shapes.tables[0];
  const columns = Object.entries(shapes.columns);
  if (columns.length === 0) return {skipped: "the plan names no column of the table"};

  let stage = "create the table";
  const quote = (id) => `"${id}"`;
  const schema = Object.fromEntries(columns.map(([name, one]) => [name, one.type]));
  await client.native({
    sql: `CREATE TABLE ${quote(table)} (${columns.map(([name, one]) => `${quote(name)} ${declaredAs(one.type, dialect)}`).join(", ")})`,
    expect: "none",
  });
  try {
    return await fill();
  } catch (error) {
    // Setting the fixture up is not the measurement, so a failure here is
    // reported rather than thrown: an escaping error from the scaffolding
    // looks exactly like a divergence found, and it is not one. Seen once
    // already - a conversion raised while the engine was replaying its own
    // aborted transaction, and it arrived with no JavaScript frames at all,
    // which is how long it took to place.
    if (process.env.OSD_DEBUG_INVENT === "1") console.error("stage:", stage, String(error.message ?? error).slice(0, 80));
    return {skipped: `the invented fixture could not be built or run: ${String(error.message ?? error).slice(0, 120)}`};
  } finally {
    await client.native({sql: `DROP TABLE ${quote(table)}`, expect: "none"}).catch(() => {});
  }

  async function fill() {
    stage = "insert benign rows";
    for (let i = 0; i < rows; i++) {
      await client.native({
        sql: `INSERT INTO ${quote(table)} (${columns.map(([name]) => quote(name)).join(", ")}) ` +
             `VALUES (${columns.map(() => "?").join(", ")})`,
        expect: "none",
        params: columns.map(([name, one]) => ({name, value: benignFor(one.type, i), type: seamType(one.type)})),
      });
    }
    // The fixture is committed before anything is run against it. A failure
    // in the measurement aborts the transaction it happens in, and if the
    // inserts are still inside that transaction the client replays them -
    // and the replay raises again, from no JavaScript frame at all, which
    // reads as an escaping error rather than as the failed statement it is.
    // Ending the LUW first makes the measurement's failures the
    // measurement's own.
    stage = "commit the fixture";
    await client.commit?.();
    stage = "plant the hazard";
    // The hazard row has to be one the body REMOVES, or both halves evaluate
    // the dangerous expression and both raise - which agrees, and says
    // nothing. The plan already knows which value is removed: a predicate
    // `col <> literal` names it exactly. Derived rather than asked for,
    // because the caller would be guessing at the same thing from outside.
    const {planted, unplanted} = await plantHazards(client, rel, {table, schema, fill: fillThatIsFilteredOut(rel)});
    stage = "commit the hazard";
    await client.commit?.();
    stage = "run both ways";
    const verdict = await runBothWays(client, rel, dialect);
    return {...verdict, invented: {table, columns: schema, guessed: shapes.guessed}, planted, unplanted};
  }
}

/** ordinary values, varied a little so a filter has something to remove */
function benignFor(type, i) {
  const abap = (type?.abap ?? "C").toUpperCase();
  if (abap === "STRING") return String.fromCharCode(97 + i).repeat(2);
  const letter = abap.charAt(0);
  if (["I", "B", "S", "P", "F"].includes(letter)) return i + 1;
  return String.fromCharCode(97 + i).repeat(2);
}

/** values that a `col <> literal` in the plan will remove, so a hazard row can hide behind one */
export function fillThatIsFilteredOut(rel) {
  const fill = {};
  const walkExpr = (e) => {
    if (e === undefined || e === null) return;
    if (e.node === "bin" && e.op === "<>") {
      const column = e.left?.node === "col" ? e.left.name : e.right?.node === "col" ? e.right.name : undefined;
      const literal = e.right?.node === "lit" ? e.right : e.left?.node === "lit" ? e.left : undefined;
      if (column !== undefined && literal !== undefined) fill[column] = literal.value;
    }
    for (const key of ["left", "right", "expr"]) walkExpr(e[key]);
    for (const one of e.args ?? []) walkExpr(one);
  };
  const walk = (r) => {
    if (r === undefined) return;
    walkExpr(r.pred);
    for (const item of r.items ?? []) walkExpr(item.expr);
    walkExpr(r.on);
    for (const key of ["input", "left", "right"]) walk(r[key]);
    for (const one of r.inputs ?? []) walk(one);
  };
  walk(rel);
  return fill;
}
