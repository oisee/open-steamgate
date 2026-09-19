// HANA against itself: the engine held still, so a difference can only be ours.
//
// Alice's framing, 2026-09-19: use HANA a second time "as a database that
// pretends not to know SQLScript". Then one engine answers the same question
// twice --
//
//   A. HANA compiling the body's own SQLScript, which is SAP's implementation
//      of the language and therefore the only ground truth we will ever have;
//   B. HANA running the ONE SQL statement our lowering makes of that body.
//
// -- and every variable but our translation is gone. Same engine, same
// version, same tables, same rows, same session. A difference here is a
// defect in the front end or the lowering, full stop, and there is nobody
// else to attribute it to.
//
// That is a different question from the two instruments next door, and the
// three together are a small design rather than three similar things:
//
//   sqlscript-conformance.mjs   varies the ENGINE      (do they mean the same?)
//   sqlscript-eager.mjs         varies the EXECUTION   (does fusing show?)
//   this file                   varies the TRANSLATION (do we mean what SAP means?)
//
// Each holds two of the three still. Only this one can convict us.
//
//   node tools/sqlscript-vs-hana.mjs <file.clas.abap>...
import {readFileSync} from "node:fs";
import {basename} from "node:path";
import {planOf} from "./sqlscript-check.mjs";
import {withInventedTables, declaredAs} from "./sqlscript-check.mjs";
import {lower} from "./sqlscript-lower.mjs";
import {schemaOf} from "./sqlscript-ir.mjs";
import {isInvalid} from "./sqlscript-eager.mjs";

/** RETURNS TABLE(...) for the wrapper, typed by our own binder.
 *
 *  Deliberately not guessed from the body's text: if our typing is wrong HANA
 *  refuses to create the function, and that refusal is a finding about our
 *  binder rather than a nuisance. What must not happen is inventing a shape
 *  wide enough to accept anything, which would hide exactly that. */
export function returnsTable(rel, catalogue) {
  const schema = schemaOf(rel, catalogue);
  const columns = Object.entries(schema).map(([name, type]) => `"${name}" ${declaredAs(type, "hana")}`);
  if (columns.length === 0) throw new Error("returnsTable: the plan projects no column");
  return `TABLE(${columns.join(", ")})`;
}

/** The wrapper, with the body put in UNCHANGED - in whichever of the two
 *  shapes the body is already written for.
 *
 *  The one property this function must have. The moment we edit the body to
 *  make it deployable we are measuring our edit against our lowering, and
 *  both halves are then ours - which is the failure the whole instrument
 *  exists to avoid. A body ending in `RETURN` is a table function; a body
 *  ending in a bare SELECT is a procedure with a result set, and turning the
 *  second into the first would mean appending a RETURN, which is an edit. So
 *  there are two wrappers and no edits, and a body that is neither is
 *  skipped and said so.
 */
export function wrapperFor(name, body, returns) {
  const last = body.trim().replace(/;\s*$/, "");
  if (/\bRETURN\b[^;]*$/i.test(last)) {
    return {kind: "function", read: `SELECT * FROM ${name}()`,
      sql: [`CREATE FUNCTION ${name} ()`, `  RETURNS ${returns}`,
        "  LANGUAGE SQLSCRIPT", "  READS SQL DATA", "AS BEGIN", body, "END;"].join("\n")};
  }
  if (/^SELECT\b/i.test(last.split(/;/).pop().trim())) {
    return {kind: "procedure", read: `CALL ${name}()`,
      sql: [`CREATE PROCEDURE ${name} ()`, "  LANGUAGE SQLSCRIPT", "  READS SQL DATA",
        "AS BEGIN", body, "END;"].join("\n")};
  }
  return {kind: "unwrappable",
    why: "the body ends in neither RETURN nor a SELECT, so it has no result we can read without editing it"};
}

/** A procedure's result set does not come back through the seam's `native`,
 *  which reads one result from a prepared statement. hdb hands a CALL its
 *  parameters first and the result sets after, so the raw driver is asked
 *  directly - inside our own tool, for our own measurement, and named here
 *  rather than hidden so that nobody takes it for part of the seam. */
export function callResultSet(client, sql) {
  return new Promise((resolve, reject) =>
    client.client.exec(sql, (err, ...rest) => {
      if (err) return reject(err);
      const table = rest.find((x) => Array.isArray(x));
      resolve((table ?? []).map((row) => Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, v === null || v === undefined ? null :
          (Buffer.isBuffer?.(v) ? v.toString("utf8") : v)]))));
    }));
}

/** A body that reads its own parameters is not self-contained, and calling it
 *  with invented arguments would compare two guesses.
 *
 *  What counts as the body's own variable is read from the body's BINDINGS -
 *  every name it assigns to and every name it declares - and not from a
 *  naming convention. The first version took `lt_`, `ls_` and `lv_` prefixes
 *  for locals, which is the house style of the corpus and not a rule of the
 *  language: the very first body put in front of it assigned to `lt`, and
 *  the instrument skipped a body it could have measured while saying, with
 *  confidence, that `lt` was a free parameter. A convention is evidence
 *  about the people who wrote the code, not about the code.
 */
export function selfContained(body) {
  const bound = new Set();
  for (const m of body.matchAll(/^[ \t]*([a-z_]\w*)\s*=/gim)) bound.add(m[1].toLowerCase());
  for (const m of body.matchAll(/\bDECLARE\s+([a-z_]\w*)/gi)) bound.add(m[1].toLowerCase());
  const free = (body.match(/:\s*[a-z_][\w]*/gi) ?? [])
    .map((u) => u.replace(/^:\s*/, "").toLowerCase())
    .filter((n) => !bound.has(n));
  return {ok: free.length === 0, free: [...new Set(free)], bound: [...bound]};
}

/** rows as a set, unless the plan asked for an order.
 *
 *  A SELECT with no ORDER BY has no order, so comparing two such answers as
 *  ordered lists invents divergences - and they would be the most convincing
 *  kind, since both halves really did return different text. Where the plan
 *  DOES order, order is part of the answer and is compared. */
export function sameRows(a, b, ordered, {numeric = false} = {}) {
  const value = (v) => {
    if (v === null || v === undefined) return null;
    const text = String(v);
    if (!numeric) return text;
    // numbers by VALUE, everything else by text: "0.50" and "0.500000" are
    // one number written twice, and "abc" and "abcd" are two strings
    const asNumber = Number(text);
    return text.trim() !== "" && Number.isFinite(asNumber) ? asNumber : text;
  };
  const shape = (rows) => {
    const each = (rows ?? []).map((r) => JSON.stringify(Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k.toUpperCase(), value(v)])
        .sort((x, y) => x[0].localeCompare(y[0])))));
    return ordered ? each : each.sort();
  };
  return JSON.stringify(shape(a)) === JSON.stringify(shape(b));
}

export function isOrdered(rel) {
  return rel?.rel === "order" || (rel?.input !== undefined && isOrdered(rel.input));
}

/**
 * The verdict, with the third value kept separate from the two.
 *
 * `scaffolding` is the one that would otherwise disguise itself: HANA
 * refusing to create the wrapper means our wrapper or our typing is wrong,
 * and reporting that as "the two halves differ" would put a defect in the
 * lowering's column that does not belong to it. Counted apart, by name.
 */
export function verdictOf(sqlscript, lowered) {
  if (sqlscript.refused !== undefined) {
    return {kind: "scaffolding", why: `HANA would not accept the body as written: ${sqlscript.refused}`};
  }
  if (lowered.raised !== undefined && isInvalid(lowered.raised)) {
    // HANA rejecting OUR statement is the clearest possible finding, and it
    // is never agreement - the same rule the fused/forced comparison learnt.
    return {kind: "our-sql-refused", agree: false, raised: lowered.raised};
  }
  const left = sqlscript.raised !== undefined;
  const right = lowered.raised !== undefined;
  if (left || right) {
    if (left && right) return {kind: "both-raised", agree: true};
    return {kind: left ? "sqlscript-raises-lowering-answers" : "lowering-raises-sqlscript-answers", agree: false,
      raised: sqlscript.raised ?? lowered.raised};
  }
  if (sameRows(sqlscript.rows, lowered.rows, sqlscript.ordered)) {
    return {kind: "same-rows", agree: true, rows: (sqlscript.rows ?? []).length};
  }
  // Normalise BEFORE counting, and print what was collapsed - the rule the
  // conformance table next door had to learn twice.
  //
  // The first live run reported `0.50` against `0.500000` as different rows.
  // Same engine, same values, and the difference is SCALE: the function
  // wrapper declares its RETURNS TABLE from our binder, so the reference
  // half is handed our type, while our lowered statement lets HANA infer its
  // own. That makes the scale ours on one side and HANA's on the other, and
  // calling it a divergence would have the instrument reporting its own
  // scaffolding. It is a real fact about our typing and it is not a
  // different answer, so it gets its own name.
  if (sameRows(sqlscript.rows, lowered.rows, sqlscript.ordered, {numeric: true})) {
    return {kind: "same-values-different-scale", agree: true,
      note: "equal as numbers, different scale: the function wrapper imposes OUR declared type on the " +
        "reference half, so a scale question is better asked in the procedure shape, which imposes none",
      sqlscript: JSON.stringify(sqlscript.rows)?.slice(0, 120), lowered: JSON.stringify(lowered.rows)?.slice(0, 120)};
  }
  return {kind: "different-rows", agree: false,
      sqlscript: JSON.stringify(sqlscript.rows)?.slice(0, 200), lowered: JSON.stringify(lowered.rows)?.slice(0, 200)};
}

/** one body, both ways, on one HANA connection */
export async function compareOnHana(client, body, {catalogue = {}, rows = 3, name = "OSD_VS_HANA"} = {}) {
  const free = selfContained(body);
  if (!free.ok) return {skipped: `the body reads ${free.free.join(", ")}, so it is not self-contained`};
  let rel;
  try {
    rel = planOf(body, catalogue);
  } catch (error) {
    return {skipped: `the front end does not read this body: ${String(error.message ?? error).slice(0, 100)}`};
  }

  return withInventedTables(client, rel, "hana", {rows}, async ({table, schema, shapes}) => {
    const invented = {...catalogue, [table]: schema};
    const quoted = `"${name}"`;
    let returns;
    try {
      returns = returnsTable(rel, invented);
    } catch (error) {
      return {kind: "scaffolding", why: `our binder gives the body no shape: ${String(error.message ?? error).slice(0, 100)}`};
    }

    const wrapper = wrapperFor(quoted, body, returns);
    if (wrapper.kind === "unwrappable") return {kind: "scaffolding", why: wrapper.why};
    const drop = wrapper.kind === "function" ? "DROP FUNCTION" : "DROP PROCEDURE";
    await client.native({sql: `${drop} ${quoted}`, expect: "none"}).catch(() => undefined);
    const sqlscript = {ordered: isOrdered(rel)};
    try {
      await client.native({sql: wrapper.sql, expect: "none"});
    } catch (error) {
      return verdictOf({refused: String(error.message ?? error).split("\n")[0].slice(0, 140)}, {});
    }
    try {
      sqlscript.rows = wrapper.kind === "function"
        ? (await client.native({sql: wrapper.read})).rows
        : await callResultSet(client, wrapper.read);
    } catch (error) {
      sqlscript.raised = String(error.message ?? error).split("\n")[0].slice(0, 140);
    }

    const ours = {};
    try {
      const {sql, params} = lower(rel, "hana");
      ours.sql = sql;
      ours.rows = (await client.native({sql, params})).rows;
    } catch (error) {
      ours.raised = String(error.message ?? error).split("\n")[0].slice(0, 140);
    }
    await client.native({sql: `${drop} ${quoted}`, expect: "none"}).catch(() => undefined);
    const verdict = verdictOf(sqlscript, ours);
    // **Both halves raising is agreement only when the DATA was the reason.**
    //
    // Here the data is ours: the table is invented, and a column the plan
    // says nothing about is GUESSED as characters. `ABS(a)` over an invented
    // text column raises on both sides, and the verdict read that as the two
    // halves agreeing -- three constructs in the first sweep reported
    // agreement while measuring nothing (2026-09-19). A guessed type is not
    // evidence, so a raise that a guess can explain is neither agreement nor
    // a divergence. It is the third value, with the columns named so it can
    // be fixed by typing them rather than by arguing about it.
    if (verdict.kind === "both-raised" && (shapes.guessed ?? []).length > 0) {
      return {kind: "both-raised-on-a-guessed-type", shape: wrapper.kind, guessed: shapes.guessed,
        why: `both halves raised, and ${shapes.guessed.join(", ")} was typed by guesswork rather than by the ` +
          "plan, so the raise may be the fixture's and not the body's", sql: ours.sql};
    }
    return {...verdict, shape: wrapper.kind, sql: ours.sql};
  });
}

async function main(files) {
  const {HanaDatabaseClient} = await import("./hana-client.mjs");
  const client = new HanaDatabaseClient({schema: process.env.HANA_SCHEMA ?? "OSD_VS_HANA"});
  await client.connect();
  const tally = new Map();
  try {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // every BY DATABASE body in the file, the same shape the coverage tool reads
      const re = /METHOD\s+[\w~]+\s+BY\s+DATABASE\s+(?:PROCEDURE|FUNCTION)\b[\s\S]*?\.\s*([\s\S]*?)ENDMETHOD\s*\./gi;
      let n = 0;
      for (const m of source.matchAll(re)) {
        const verdict = await compareOnHana(client, m[1], {name: `OSD_VS_HANA_${n++}`});
        const kind = verdict.skipped !== undefined ? "skipped" : verdict.kind;
        tally.set(kind, (tally.get(kind) ?? 0) + 1);
        if (verdict.agree === false) {
          console.log(`\n${basename(file)} #${n}  ${verdict.kind}`);
          console.log(`  ${JSON.stringify(verdict).slice(0, 400)}`);
        }
      }
    }
  } finally {
    await client.disconnect?.();
  }
  console.log("\nHANA against HANA, one engine, translation the only variable:");
  for (const [kind, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${kind}`);
  }
  console.log("\n`scaffolding` is neither agreement nor a divergence: it is a body");
  console.log("HANA would not accept as we wrapped it, and it is ours to fix before");
  console.log("that body says anything about the lowering.");
}

if (basename(process.argv[1] ?? "") === "sqlscript-vs-hana.mjs") {
  await main(process.argv.slice(2).filter((a) => !a.startsWith("--")));
}
