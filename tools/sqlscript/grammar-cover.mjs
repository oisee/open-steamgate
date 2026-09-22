// Every construct the grammar can parse, against the ones the binder names.
//
//   node tools/sqlscript/grammar-cover.mjs
//
// **The gap this closes is a silent substitution, not a crash.** `to-ir.mjs`
// ends its expression dispatch with a fallback: a node the switch does not
// know, carrying exactly one non-word child, is unwrapped -- the node
// disappears and its child is bound in its place. For a wrapper (`Factor`
// around a `Value`) that is correct and necessary. For a construct that
// MEANS something it is a substitution, and it is silent.
//
// Measured on 2026-09-20, which is why this exists: `FROM my_func(:p)`
// parsed into a `TableFunctionCall`, a name the binder mentioned nowhere,
// and lowered to `FROM "MY_FUNC"` -- the call turned into a read of a table
// and its argument gone. No refusal, no warning, and an answer that would
// have been plausible against a table of that name. Found by reading the two
// name sets against each other; running it then confirmed it in one line.
//
// So the rule: **every grammar class must be a name the binder mentions.**
// Bound, refused by name, or listed below with a reason. A construct nobody
// has decided about is the one that gets unwrapped.
//
// Exit 0 covered, 1 a gap, 2 could not read either side.
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import * as grammar from "./expressions/index.mjs";
import {TokenKind} from "./lexer.mjs";

const BINDER = fileURLToPath(new URL("./to-ir.mjs", import.meta.url));

/** Classes the binder never needs to name, each with the reason.
 *
 *  Not "the ones it does not name" -- that is the list this tool builds. This
 *  is the ones where not naming them is **right**, and the difference is a
 *  sentence somebody had to write. Same shape as `.leak-allow.json`: an
 *  exception costs a reason, so an exception can be told from a way of making
 *  the check pass. */
export const NOT_NAMED = {
  Body: "the root the parser is started on: `toIr` walks its children and never dispatches on it",
  Declare: "reaches the statement switch's default, which refuses it with its own name at run time -- pinned by test/sqlscript-cover.mjs, which runs a DECLARE and reads what comes back",
  UnnestCall: "owned by the procedural compiler as an assignment RHS; it is converted to a typed relation before the relational binder is called",
  ProcedureCall: "owned by the procedural compiler as a statement; it becomes a bounded call-procedure node before the relational binder is called",
  If: "the same, and listed for the same reason: refused by the default rather than by a literal in the source, so the claim is pinned by a run. A reason nobody re-checks stops being true quietly",
  ColumnDef: "only ever a child of Declare, which is refused before anything looks inside it",
  AbapType: "only ever a child of ColumnDef, same reason",
};

/** every node name that reaches the tree: the grammar's classes */
export function grammarNames(mod = grammar) {
  return new Set(Object.entries(mod)
    .filter(([, v]) => typeof v === "function" && /^[A-Z]/.test(v.name ?? ""))
    .map(([k]) => k));
}

/** every node name the binder dispatches on
 *
 *  Read out of the source rather than by instrumenting a run: a run only
 *  covers the constructs its input happens to contain, which is the reason a
 *  corpus of seven bodies once stood in for a language. */
export function binderNames(source = readFileSync(BINDER, "utf8")) {
  const out = new Set();
  for (const re of [
    /case "([A-Za-z]+)":/g,
    /\bkids?\([^,]+,\s*"([A-Za-z]+)"/g,
    /\.node\s*===\s*"([A-Za-z]+)"/g,
    /"([A-Za-z]+)"\s*===\s*[A-Za-z.]+\.node/g,
  ]) {
    for (const m of source.matchAll(re)) out.add(m[1]);
  }
  return out;
}

export function cover(names = grammarNames(), named = binderNames(), allowed = NOT_NAMED) {
  const lexer = new Set(Object.keys(TokenKind));
  return {
    // parsed and never decided about: the fallback will unwrap it
    undecided: [...names].filter((n) => named.has(n) === false && allowed[n] === undefined).sort(),
    // a dispatch on a name nothing can produce: a dead branch, or a typo in
    // one. Complaining in one direction only is half a checker.
    unreachable: [...named].filter((n) => names.has(n) === false && lexer.has(n) === false
      && /^[A-Z]/.test(n)).sort(),
    // an allowance for a class the grammar no longer has
    stale: Object.keys(allowed).filter((n) => names.has(n) === false).sort(),
  };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = grammarNames();
  const named = binderNames();
  if (names.size === 0 || named.size === 0) {
    console.error("grammar-cover: read nothing from one side - that is not 'covered', it is 'nothing was looked at'");
    process.exit(2);
  }
  const {undecided, unreachable, stale} = cover(names, named);
  console.error(`grammar-cover: ${names.size} grammar classes, ${named.size} names the binder dispatches on, ` +
    `${Object.keys(NOT_NAMED).length} allowed unnamed`);
  for (const n of undecided) {
    console.log(`${n}: parsed, and the binder never names it - it will be unwrapped, not refused`);
  }
  for (const n of unreachable) console.log(`${n}: the binder dispatches on it and no grammar class produces it`);
  for (const n of stale) console.log(`${n}: allowed as unnamed, and the grammar has no such class any more`);
  if (undecided.length + unreachable.length + stale.length > 0) {
    console.error("\nDecide it: bind it, refuse it by name, or add it to NOT_NAMED with the reason.");
    process.exit(1);
  }
}
