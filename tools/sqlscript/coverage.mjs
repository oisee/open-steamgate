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
//   node tools/sqlscript/coverage.mjs [.local/a4h-export]
import {readFileSync, readdirSync, mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join} from "node:path";
import {lex, LexError} from "./lexer.mjs";
import {parse, ParseError} from "./combi.mjs";
import {Body} from "./expressions/index.mjs";

const TEACHING = /^(SABAPDEMOS|SABAP_DEMOS_|SABP_COMPILER|SABP_UNIT_DOUBLE_|SDDIC_ADT_TEST|SACMTST|S_ESH_TST_AUTOMATION|BW4_PREVIEW_TEST)/;

function bodiesOf(source) {
  const out = [];
  const re = /METHOD\s+[\w~]+\s+BY\s+DATABASE\s+(PROCEDURE|FUNCTION)\b[\s\S]*?\.\s*([\s\S]*?)ENDMETHOD\s*\./gi;
  for (const m of source.matchAll(re)) out.push(m[2]);
  return out;
}

function classesIn(zip, dir) {
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
function reasonOf(error, tokens) {
  if (error instanceof LexError) return `lex: ${error.message.replace(/: line.*/, "")}`;
  if (!(error instanceof ParseError)) return `internal: ${error.message.slice(0, 40)}`;
  // the token it stopped at is the useful thing: it names the construct the
  // grammar does not have yet
  const at = tokens.find((t) => t.line === error.line && t.col === error.col);
  const word = String(at?.value ?? "end of body").toUpperCase();
  return `parse: at ${word}`;
}

export function measure(root = ".local/a4h-export", scratch = "/tmp/sqlscript-coverage") {
  const zips = readdirSync(root).filter((f) => f.endsWith(".zip"));
  const corpora = {teaching: [], working: []};
  for (const zip of zips) {
    const pkg = zip.replace(/\.zip$/, "");
    const which = TEACHING.test(pkg) ? "teaching" : "working";
    for (const file of classesIn(join(root, zip), join(scratch, pkg))) {
      for (const body of bodiesOf(readFileSync(file, "utf8"))) corpora[which].push(body);
    }
  }

  const report = {};
  for (const [which, bodies] of Object.entries(corpora)) {
    const reasons = new Map();
    let whole = 0;
    for (const body of bodies) {
      let tokens = [];
      try {
        tokens = lex(body);
        parse(new Body(), tokens);
        whole += 1;
      } catch (error) {
        const reason = reasonOf(error, tokens);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }
    report[which] = {
      bodies: bodies.length,
      whole,
      share: bodies.length === 0 ? 0 : Math.round((whole / bodies.length) * 100),
      stoppedBy: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    };
  }
  return report;
}

if (process.argv[1]?.endsWith("coverage.mjs")) {
  const report = measure(process.argv[2]);
  for (const [which, r] of Object.entries(report)) {
    console.log(`\n${which}: ${r.whole} of ${r.bodies} bodies parse whole (${r.share}%)`);
    for (const [reason, count] of r.stoppedBy) {
      console.log(`  ${String(count).padStart(5)}  ${reason}`);
    }
  }
  console.log("\nA body needs all of its constructs at once, so the next construct to write");
  console.log("is the one at the top of the working list -- not the commonest one.");
  process.exit(0);
}
