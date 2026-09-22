// How much of the corpus the front end that exists can actually read.
//
// Until the parser existed this could only be estimated: docs/sqlscript-corpus.md
// counted **constructs** and inferred a curve. This counts **bodies that go
// through whole**, which is the only number that predicts how much of the
// corpus runs -- a body needs all of its constructs at once, so a construct
// at 80% frequency buys nothing on its own.
//
// And it answers the question the frequency table could not: which construct
// to write next. Not the commonest one, but the one that is **the only thing
// missing** in the most bodies -- the cheapest unlock at this moment, which
// changes after every construct added.
//
//   node tools/sqlscript/coverage.mjs [.local/a4h-export] [--ddic <folder>]...
import {readFileSync, readdirSync, mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {basename, join} from "node:path";
import {lex, LexError} from "./lexer.mjs";
import {parse, ParseError} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";
import {toIr} from "./to-ir.mjs";
import {lower} from "../sqlscript-lower.mjs";
import * as extractor from "../amdp-extract.mjs";
import {FolderDdic, RELEASED_DDIC, existingFolders} from "./folder-ddic.mjs";
import {parseTableFunction} from "./table-function-ddls.mjs";

const TEACHING = /^(SABAPDEMOS|SABAP_DEMOS_|SABP_COMPILER|SABP_UNIT_DOUBLE_|SDDIC_ADT_TEST|SACMTST|S_ESH_TST_AUTOMATION|BW4_PREVIEW_TEST)/;

/** the bodies of a class, each with the signature its method declares --
 *  because fifteen of the refusals were the signature and not the body --
 *  and each with the language it is written in, because not all of them are
 *  SQLScript and a denominator that does not say so is a lie by omission. */
export function bodiesOf(source, filename) {
  try {
    const {extract} = extractor;
    const cls = extract(source, filename);
    const methods = cls?.methods ?? [];
    if (methods.length > 0) {
      return methods.map((m) => ({body: m.body, signature: m, language: (m.language || "SQLSCRIPT").toUpperCase()}));
    }
  } catch {
    // a class the extractor cannot read still has bodies worth counting
  }
  const out = [];
  const re = /METHOD\s+[\w~]+\s+BY\s+DATABASE\s+(?:PROCEDURE|FUNCTION|GRAPH\s+WORKSPACE)\b([\s\S]*?)\.\s*([\s\S]*?)ENDMETHOD\s*\./gi;
  for (const m of source.matchAll(re)) {
    out.push({body: m[2], signature: undefined, language: (/LANGUAGE\s+(\w+)/i.exec(m[1])?.[1] ?? "SQLSCRIPT").toUpperCase()});
  }
  return out;
}

export function classesIn(zip, dir) {
  mkdirSync(dir, {recursive: true});
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".clas.abap")) found.push(join(d, e.name));
    }
  };
  walk(dir);
  return found;
}

/** what stopped this body, in a form that can be counted */
export function reasonOf(error, tokens) {
  if (error instanceof LexError) return `lex: ${error.message.replace(/: line.*/, "")}`;
  if (!(error instanceof ParseError)) return `internal: ${error.message.slice(0, 40)}`;
  // the token it stopped at is the useful thing: it names the construct the
  // grammar does not have yet
  const at = tokens.find((t) => t.line === error.line && t.col === error.col);
  const word = String(at?.value ?? "end of body").toUpperCase();
  return `parse: at ${word}`;
}

export function measure(root = ".local/a4h-export", scratch = "/tmp/sqlscript-coverage", options = {}) {
  const zips = readdirSync(root).filter((f) => f.endsWith(".zip"));
  const corpora = {teaching: [], working: []};
  // The dictionary the scalar typer resolves data elements against: the
  // packages' own DTEL/DOMA (an export carries them beside the classes),
  // then whatever `--ddic` names, then the released dump if it is cloned.
  // A parameter typed by an element none of them holds is a **named**
  // refusal below, not "unknown scalar" -- and not STRING.
  // Later folder wins, as in `abap_transpile.json`: the released dump is
  // the oldest and most general, `--ddic` more specific, and a package's own
  // export -- taken off the system that runs it -- the most specific of all.
  const ddic = new FolderDdic(existingFolders([RELEASED_DDIC, ...(options.ddic ?? [])]));
  for (const zip of zips) {
    const pkg = zip.replace(/\.zip$/, "");
    const which = TEACHING.test(pkg) ? "teaching" : "working";
    for (const file of classesIn(join(root, zip), join(scratch, pkg))) {
      for (const one of bodiesOf(readFileSync(file, "utf8"), file.split("/").pop())) corpora[which].push(one);
    }
    ddic.add(join(scratch, pkg));
  }
  const resolveType = ddic.resolver();
  // A method declared FOR TABLE FUNCTION has its parameters in the DDLS.
  // Read them once every package is indexed: the DDLS is usually in the
  // same package as its class, but nothing says it must be.
  let tableFunctionsRead = 0;
  const tableFunctionsMissing = new Map();
  for (const one of [...corpora.teaching, ...corpora.working]) {
    const name = one.signature?.tableFunction;
    if (name === undefined) continue;
    const ddls = ddic.read("DDLS", name);
    if (ddls === undefined) {
      tableFunctionsMissing.set(name, (tableFunctionsMissing.get(name) ?? 0) + 1);
      continue;
    }
    const tf = parseTableFunction(ddls.source);
    one.signature = {...one.signature, parameters: tf.parameters, returns: tf.returns};
    tableFunctionsRead += 1;
  }

  const report = {};
  for (const [which, all] of Object.entries(corpora)) {
    // **What the denominator was counted with** (fable-osd asked for this line
    // and the corpus then showed why it is not a formality). `BY DATABASE
    // PROCEDURE` does not mean SQLScript: the same syntax carries LANGUAGE
    // GRAPH, LANGUAGE SQL and LANGUAGE LLANG, and the GRAPH bodies are a
    // different language outright -- C-style `{ }` blocks, `==`, `N''`
    // literals. They were sitting in the denominator and, worse, at the TOP
    // of the blocker histogram, where "at =" read as though SQLScript
    // equality were unimplemented. It is not; those bodies are not SQLScript.
    // A front end for SQLScript is measured against the SQLScript bodies, and
    // the rest are named rather than silently dropped.
    const byLanguage = new Map();
    for (const one of all) byLanguage.set(one.language, (byLanguage.get(one.language) ?? 0) + 1);
    const bodies = all.filter((one) => one.language === "SQLSCRIPT");
    // Three numbers, not one (fable-osd). "Parses" is not "runs": stage 3
    // refuses Declare, Return and Block by name, so a body can go through
    // the grammar whole and still never reach an engine. One number called
    // "coverage" would be quoted a week later as "8% of the corpus works",
    // and we would be the ones quoting it -- the name of a metric being
    // wider than what it measures is the defect this project keeps paying
    // for. Only the third number is showable.
    const reasons = new Map();
    const afterParse = new Map();
    let parsed = 0;
    let loweredCount = 0;
    for (const {body, signature} of bodies) {
      let tokens = [];
      let tree;
      try {
        tokens = lex(body);
        tree = parse(new Body(), tokens);
        parsed += 1;
      } catch (error) {
        const reason = reasonOf(error, tokens);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        continue;
      }
      try {
        const ir = toIr(tree, {catalogue: {}, signature, resolveType});
        lower(ir.rel, "hana");
        loweredCount += 1;
      } catch (error) {
        const why = String(error.message ?? error).replace(/: line.*/, "").slice(0, 60);
        afterParse.set(why, (afterParse.get(why) ?? 0) + 1);
      }
    }
    report[which] = {
      counted: all.length,
      byLanguage: [...byLanguage.entries()].sort((a, b) => b[1] - a[1]),
      bodies: bodies.length,
      parsed,
      lowered: loweredCount,
      share: bodies.length === 0 ? 0 : Math.round((loweredCount / bodies.length) * 100),
      stoppedBy: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      parsedButNotLowered: [...afterParse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }
  report.dictionary = ddic;
  report.tableFunctions = {read: tableFunctionsRead, missing: [...tableFunctionsMissing.keys()]};
  return report;
}

// The check is the **file name**, not a suffix of it. A suffix matched more
// than it meant: fable-osd's `sqlscript-force-coverage.mjs` imported this
// module and this line ran her command line as ours, because her name also
// ends in "coverage.mjs". Same family as everything else caught today -- a
// test that is wider than the thing it has in mind.
if (basename(process.argv[1] ?? "") === "coverage.mjs") {
  // coverage.mjs [root] [--ddic <folder>]...   the folders hold *.dtel.xml / *.doma.xml
  const args = process.argv.slice(2);
  const ddic = [];
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--ddic") ddic.push(args[++i]);
    else rest.push(args[i]);
  }
  const {dictionary, tableFunctions, ...corporaReport} = measure(rest[0], undefined, {ddic});
  // the numbers below depend on which dictionaries this machine holds, so
  // the header says which, and how much each one answered
  console.log("dictionaries given to the scalar typer (later wins a shared name):");
  const exports = dictionary.folders.filter((f) => f.startsWith("/tmp/sqlscript-coverage"));
  for (const line of dictionary.describe()) {
    if (!exports.includes(line.split("  (")[0])) console.log(`  ${line}`);
  }
  console.log(`  ${exports.length} package exports  (${exports.reduce((n, f) => n + (dictionary.hits.get(f) ?? 0), 0)} resolved)`);
  console.log(`table-function signatures read off their DDLS: ${tableFunctions.read}` +
    (tableFunctions.missing.length === 0 ? "" : `; DDLS not in the export: ${tableFunctions.missing.join(", ")}`));
  for (const [which, r] of Object.entries(corporaReport)) {
    console.log(`\n${which}: ${r.bodies} SQLScript bodies` +
      ` (of ${r.counted} BY DATABASE bodies: ${r.byLanguage.map(([l, n]) => `${l} ${n}`).join(", ")})`);
    console.log(`  parsed   ${r.parsed}`);
    console.log(`  lowered  ${r.lowered}  (${r.share}% -- the only one worth quoting)`);
    console.log("  stopped in the grammar:");
    for (const [reason, count] of r.stoppedBy) {
      console.log(`  ${String(count).padStart(5)}  ${reason}`);
    }
    if (r.parsedButNotLowered.length > 0) {
      console.log("  parsed and then refused by the lowering:");
      for (const [reason, count] of r.parsedButNotLowered) {
        console.log(`  ${String(count).padStart(5)}  ${reason}`);
      }
    }
  }
  console.log("\nA body needs all of its constructs at once, so the next construct to write");
  console.log("is the one at the top of the working list -- not the commonest one.");
  process.exit(0);
}
