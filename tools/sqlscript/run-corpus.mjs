// Every lowerable corpus body, run both ways against tables invented from
// its own plan.
//
// The number this replaces was seven, and seven was a property of the filter
// rather than of the corpus (fable-osd, 2026-09-19). `check-corpus.mjs`
// could only run **self-contained** bodies -- ones reading nothing but their
// own IN table parameters -- and a body that divides, casts or concatenates
// almost always reads a table. So the filter that made bodies runnable was
// the filter that removed everything worth looking at, and "0 of 7 can
// diverge" said nothing about SQLScript at all.
//
// Two things from the plan remove the need to wait for real data:
//
//   the tables   `tableShapesFor` -- what is DONE to a column says enough to
//                build something the body will run against
//   the rows     `adversarialRows` -- a cast diverges on the row that is not
//                a number, a division on the row where the divisor is zero
//
// **What this does and does not measure, printed next to the numbers rather
// than buried here.** It compares *fusing against forcing*: one statement
// against the same plan materialised step by step. It does **not** check
// that a body answers what it answers on a real system -- there is no real
// data, and with invented tables that claim is unreachable in principle.
// Two different sentences; the run prints both so nobody merges them.
//
//   node tools/sqlscript/run-corpus.mjs [.local/a4h-export] [--limit n]
import {readFileSync, readdirSync} from "node:fs";
import {basename, join} from "node:path";
import {lex} from "./lexer.mjs";
import {parse} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {toIr} from "./to-ir.mjs";
import {bodiesOf, classesIn} from "./coverage.mjs";
import {adversarialRows, tableShapesPerTable, effects} from "../sqlscript-ir.mjs";
import {lower} from "../sqlscript-lower.mjs";
import {runBothWays, compare} from "../sqlscript-eager.mjs";

const TEACHING = /^(SABAPDEMOS|SABAP_DEMOS_|SABP_COMPILER|SABP_UNIT_DOUBLE_|SDDIC_ADT_TEST|SACMTST|S_ESH_TST_AUTOMATION|BW4_PREVIEW_TEST)/;

/** every body of the working corpus that reaches an engine */
export function lowerable(root = ".local/a4h-export", scratch = "/tmp/sqlscript-run") {
  const out = [];
  for (const zip of readdirSync(root).filter((f) => f.endsWith(".zip"))) {
    const pkg = zip.replace(/\.zip$/, "");
    if (TEACHING.test(pkg)) continue;
    for (const file of classesIn(join(root, zip), join(scratch, pkg))) {
      const name = file.split("/").pop();
      for (const one of bodiesOf(readFileSync(file, "utf8"), name)) {
        if (one.language !== "SQLSCRIPT") continue;
        let ir;
        try {
          ir = toIr(parse(new Body(), lex(one.body)), {catalogue: {}, signature: one.signature});
          lower(ir.rel, "duckdb");
        } catch {
          continue;
        }
        out.push({file: name, method: one.signature?.name ?? "?", ir});
      }
    }
  }
  return out;
}

const DUCK = {I: "INTEGER", P: "DECIMAL(15,2)", STRING: "VARCHAR", C: "VARCHAR", D: "DATE", BOOL: "BOOLEAN"};
const duckType = (t) => DUCK[t?.abap] ?? "VARCHAR";

/** A value that fits a column, for the rows that are NOT trying to break it.
 *  Two of them, because a plan with a join or a filter needs more than one
 *  row before it has anything to answer with. */
const plausible = (type, n) => (type?.abap === "I" ? n + 1
  : type?.abap === "P" ? `${n + 1}.50`
  : type?.abap === "D" ? "2026-01-0" + (n + 1)
  : type?.abap === "BOOL" ? (n === 0)
  : `v${n + 1}`);

/** Build the tables the plan reads, fill them, and hand back the schema.
 *
 *  The first version gave **every table every column**, and it was the
 *  reason seven bodies died on `Ambiguous reference to column name`: two
 *  tables both carrying `A` make `A` mean nothing, which is the very
 *  ambiguity the plan had. fable-osd's `attributeColumns` reads the
 *  attribution out of the join predicate instead -- `ON a = b` compares one
 *  side with the other, so `a` lives under the left subtree and `b` under
 *  the right -- and says nothing where nothing can be read: a self-join, or
 *  a side holding more than one table. A column nobody can place stays
 *  `unattributed`, and a body with one is **refused rather than run**,
 *  because a fixture we cannot describe is not evidence. */
async function build(client, shapes, hazards) {
  const columnsOf = (table) => Object.entries(shapes.perTable[table] ?? {}).map(([c, one]) => [c, one.type]);
  if (shapes.tables.every((t) => columnsOf(t).length === 0)) return undefined;

  const schema = {};
  for (const [name, one] of Object.entries(shapes.columns)) schema[name] = one.type;

  for (const table of shapes.tables) {
    const columns = columnsOf(table);
    if (columns.length === 0) continue;
    await client.native({sql: `DROP TABLE IF EXISTS "${table}"`, expect: "none"});
    await client.native({
      sql: `CREATE TABLE "${table}" (${columns.map(([c, t]) => `"${c}" ${duckType(t)}`).join(", ")})`,
      expect: "none",
    });
    const rows = [];
    for (let n = 0; n < 2; n += 1) rows.push(columns.map(([, t]) => plausible(t, n)));
    // and the rows the plan asked for, each one changing only its own column
    for (const hazard of hazards) {
      if (!columns.some(([c]) => c === hazard.column)) continue;
      rows.push(columns.map(([c, t]) => (c === hazard.column ? hazard.value : plausible(t, 0))));
    }
    for (const row of rows) {
      await client.native({
        sql: `INSERT INTO "${table}" VALUES (${row.map(() => "?").join(", ")})`,
        params: row.map((v, i) => ({name: `p${i}`, value: v, type: v === null ? "STRING" : undefined, isNull: v === null})),
        expect: "none",
      });
    }
  }
  return schema;
}

export async function run(root, limit = Infinity) {
  const {DuckDBDatabaseClient} = await import("../duckdb-client.mjs");
  const client = new DuckDBDatabaseClient({path: ":memory:"});
  await client.connect();

  const report = {lowered: 0, ran: 0, canDiverge: 0, diverged: [], refused: new Map(), writes: 0,
    unplaceable: 0, multiTable: 0};
  try {
    for (const one of lowerable(root)) {
      report.lowered += 1;
      if (report.ran >= limit) continue;
      if (effects(one.ir.rel).writes.length > 0) {
        // running a writing plan twice writes twice; the refusal is upstream
        report.writes += 1;
        continue;
      }
      const shapes = tableShapesPerTable(one.ir.rel);
      if (shapes.tables.length === 0) {
        report.refused.set("reads no table", (report.refused.get("reads no table") ?? 0) + 1);
        continue;
      }
      // Counted **before** the refusal below, because a counter placed after
      // the branch that removes its own subjects prints an impossible
      // sentence: the first run of this said "1 of the bodies read more than
      // one table; 11 of those were refused". Arithmetic that cannot be true
      // is the friendly kind of defect -- it announces itself.
      if (shapes.tables.length > 1) report.multiTable += 1;
      // **A column nobody can place is a refusal, not a guess.** With one
      // table it cannot happen; with several it means the join predicate did
      // not say where the column lives -- a self-join, or a side that is
      // itself a join. Running anyway would need a fixture whose meaning we
      // could not state, and a comparison on one of those proves nothing
      // about either engine.
      if (shapes.tables.length > 1 && shapes.unattributed.length > 0) {
        report.unplaceable += 1;
        report.refused.set("a column no join predicate can place", (report.refused.get("a column no join predicate can place") ?? 0) + 1);
        continue;
      }
      let schema;
      try {
        const hazards = adversarialRows(one.ir.rel, {});
        schema = await build(client, shapes, hazards);
        if (schema === undefined) {
          report.refused.set("no column the plan names", (report.refused.get("no column the plan names") ?? 0) + 1);
          continue;
        }
        const hazardous = adversarialRows(one.ir.rel, schema).length > 0;
        const {fused, eager} = await runBothWays(client, one.ir.rel, "duckdb");
        const verdict = compare(fused, eager);
        // **A refused statement is not a divergence and not a run.** The
        // engine declined the SQL, which here means the invented table did
        // not fit the plan -- our scaffolding, not the engines disagreeing.
        // Counting it as a disagreement would have been the loudest possible
        // version of the mistake this whole file exists to avoid: 39 of the
        // first 67 landed here and read as "39 divergences found".
        if (verdict.kind === "statement-refused") {
          const why = String(verdict.raised ?? "").split("\n")[0].slice(0, 70);
          report.refused.set(`the invented table did not fit: ${why}`,
            (report.refused.get(`the invented table did not fit: ${why}`) ?? 0) + 1);
          continue;
        }
        report.ran += 1;
        if (hazardous) report.canDiverge += 1;
        if (verdict.agree === false) {
          report.diverged.push({...one, verdict, hazardous});
        }
      } catch (error) {
        const why = String(error.message ?? error).split("\n")[0].slice(0, 70);
        report.refused.set(why, (report.refused.get(why) ?? 0) + 1);
      } finally {
        for (const table of shapes.tables) {
          await client.native({sql: `DROP TABLE IF EXISTS "${table}"`, expect: "none"}).catch(() => undefined);
        }
      }
    }
  } finally {
    await client.disconnect();
  }
  return report;
}

if (basename(process.argv[1] ?? "") === "run-corpus.mjs") {
  const at = process.argv.indexOf("--limit");
  const report = await run(process.argv[2]?.startsWith("--") ? undefined : process.argv[2],
    at === -1 ? Infinity : Number(process.argv[at + 1]));
  console.log(`${report.lowered} bodies reach an engine`);
  console.log(`${report.ran} were run both ways against tables invented from their own plans`);
  console.log(`${report.canDiverge} of those contain an expression that can diverge at all`);
  console.log(`${report.diverged.length} disagreed between fused and forced`);
  for (const one of report.diverged) {
    console.log(`\n  ${one.file} ${one.method}: ${one.verdict.kind ?? "disagreed"}`);
  }
  console.log(`\n${report.multiTable} of the bodies read more than one table; ${report.unplaceable} of those were refused`);
  console.log("because a column was named only by an outer predicate whose side holds more than one table,");
  console.log("or by a self-join -- nobody can say which table it belongs to, so nobody builds it a fixture.");
  if (report.writes > 0) console.log(`\n${report.writes} refused before running: the plan writes`);
  if (report.refused.size > 0) {
    console.log("\ncould not be run:");
    for (const [why, n] of [...report.refused].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${String(n).padStart(4)}  ${why}`);
    }
  }
  console.log("\nThis compares FUSING against FORCING on invented data. It does not check that");
  console.log("a body answers what it answers on a real system: there is no real data here, and");
  console.log("with invented tables that claim is unreachable in principle. Two sentences.");
  process.exit(0);
}
