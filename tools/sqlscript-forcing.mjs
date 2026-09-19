// The numerator: how many lowered bodies the divergence instrument forces
// completely.
//
//   node tools/sqlscript-forcing.mjs .local/a4h-export
//
// The denominator is `tools/sqlscript/coverage.mjs` (bodies that lower). This
// is the other half of the same sentence, and without it "no divergences
// found" has nothing under it: a body whose steps could not be forced is a
// body the comparison never actually compared.
//
// It walks the corpus itself rather than asking the coverage tool for its
// plans - the coverage tool returns counts, and a tool that depends on
// another tool's internals to exist is a tool that prints "nothing could be
// counted" on the one machine where it matters. The first version of this
// file did exactly that.
//
// No database is touched. Whether a step can be forced is a question about
// the step and about one client capability, so the count is exact and covers
// every lowered body, not only the handful whose tables happen to exist.
//
// Named without the word "coverage": coverage.mjs decides whether it is the
// program being run with `process.argv[1]?.endsWith("coverage.mjs")`, and a
// file called sqlscript-force-coverage.mjs satisfies that too - importing it
// ran the other tool's command line. A suffix test is wider than the name it
// means.
import {readFileSync, readdirSync} from "node:fs";
import {join} from "node:path";
import {classesIn, bodiesOf} from "./sqlscript/coverage.mjs";
import {lex} from "./sqlscript/lexer.mjs";
import {parse} from "./sqlscript/combi.mjs";
import {Body} from "./sqlscript/expressions/index.mjs";
import {toIr} from "./sqlscript/to-ir.mjs";
import {lower} from "./sqlscript-lower.mjs";
import {forceability} from "./sqlscript-eager.mjs";

const TEACHING = /^(SABAPDEMOS|SABAP_DEMOS_|SABP_COMPILER|SABP_UNIT_DOUBLE_|SDDIC_ADT_TEST|SACMTST|S_ESH_TST_AUTOMATION|BW4_PREVIEW_TEST)/;

export function count(root, {dialect = "hana", paramsOnMaterialise = true, scratch = "/tmp/sqlscript-forcing"} = {}) {
  const corpora = {teaching: [], working: []};
  for (const zip of readdirSync(root).filter((f) => f.endsWith(".zip"))) {
    const pkg = zip.replace(/\.zip$/, "");
    const which = TEACHING.test(pkg) ? "teaching" : "working";
    for (const file of classesIn(join(root, zip), join(scratch, pkg))) {
      for (const one of bodiesOf(readFileSync(file, "utf8"), file.split("/").pop())) corpora[which].push(one);
    }
  }

  const report = {};
  for (const [which, all] of Object.entries(corpora)) {
    const bodies = all.filter((one) => one.language === "SQLSCRIPT");
    let lowered = 0;
    let full = 0;
    let steps = 0;
    const blockedBy = new Map();
    for (const {body, signature} of bodies) {
      let rel;
      try {
        rel = toIr(parse(new Body(), lex(body)), {catalogue: {}, signature}).rel;
        lower(rel, dialect);
        lowered += 1;
      } catch {
        continue; // counted by the denominator tool, not by this one
      }
      const verdict = forceability(rel, dialect, {paramsOnMaterialise});
      steps += verdict.steps;
      if (verdict.full) full += 1;
      for (const one of verdict.blocked) blockedBy.set(one.rel, (blockedBy.get(one.rel) ?? 0) + 1);
    }
    report[which] = {bodies: bodies.length, lowered, full, steps, blockedBy: [...blockedBy].sort((a, b) => b[1] - a[1])};
  }
  return report;
}

if (process.argv[1]?.endsWith("sqlscript-forcing.mjs")) {
  const root = process.argv[2] ?? ".local/a4h-export";
  // the capability is asked for explicitly, because the answer changed once
  // already: a client that refuses values on a materialised relation forces
  // far less, and the number means something different
  const paramsOnMaterialise = !process.argv.includes("--no-params-on-materialise");
  let report;
  try {
    report = count(root, {paramsOnMaterialise});
  } catch (error) {
    console.error(`sqlscript-forcing: cannot read the corpus at ${root}: ${error.message}`);
    console.error("It lives on the machine with the A4H export. Run it there.");
    process.exit(2);
  }
  console.log(`forcing with params on a materialised relation: ${paramsOnMaterialise ? "yes" : "no"}`);
  for (const [which, r] of Object.entries(report)) {
    if (r.lowered === 0) {
      console.log(`\n${which}: nothing lowered, so there is nothing to force - not a result, an empty input`);
      continue;
    }
    console.log(`\n${which}: **${r.full} of ${r.lowered} lowered bodies force completely** (${r.steps} steps in all)`);
    if (r.blockedBy.length > 0) {
      console.log("  what stays fused, by node:");
      for (const [rel, n] of r.blockedBy) console.log(`    ${String(rel).padEnd(12)} ${n}`);
    }
  }
}
