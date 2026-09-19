// The numerator: how many lowered bodies the divergence instrument forces
// completely.
//
//   node tools/sqlscript-forcing.mjs .local/a4h-export
//
// Named without the word "coverage" on purpose: coverage.mjs decides whether
// it is the program being run with `process.argv[1]?.endsWith("coverage.mjs")`,
// and a file called sqlscript-force-coverage.mjs ends with that too - so
// importing it ran the other tool's command line instead of exporting to
// this one. A suffix test is wider than the name it means.
//
// The denominator is `tools/sqlscript/coverage.mjs` (bodies that lower). This
// is the other half of the same sentence, and without it "no divergences
// found" has nothing under it: a body whose steps cannot be forced is a body
// the comparison never actually compared.
//
// No database is touched. Whether a step can be forced is decided by its
// lowering - a step carrying bound values cannot become a definition - so the
// count is exact and covers every lowered body, not only the handful whose
// tables happen to exist on this machine.
import {readdirSync} from "node:fs";
import {measure} from "./sqlscript/coverage.mjs";
import {forceability} from "./sqlscript-eager.mjs";

const root = process.argv[2] ?? ".local/a4h-export";
let corpora;
try {
  corpora = measure(root);
} catch (error) {
  console.error(`sqlscript-forcing: cannot read the corpus at ${root}: ${error.message}`);
  console.error("It lives on the machine with the A4H export. Run it there.");
  process.exit(2);
}

for (const [which, report] of Object.entries(corpora)) {
  const lowered = (report.plans ?? []).filter((one) => one.rel !== undefined);
  if (lowered.length === 0) {
    // said out loud rather than printed as a zero: a report that measured
    // nothing must not look like a report that found nothing
    console.log(`\n${which}: the corpus run did not hand back plans, so nothing could be counted here.`);
    console.log("  coverage.mjs must expose the lowered plans for this to say anything.");
    continue;
  }
  let full = 0;
  const reasons = new Map();
  for (const one of lowered) {
    const verdict = forceability(one.rel, "duckdb");
    if (verdict.full) {
      full++;
      continue;
    }
    for (const blocked of verdict.blocked) {
      reasons.set(blocked.rel, (reasons.get(blocked.rel) ?? 0) + 1);
    }
  }
  console.log(`\n${which}: ${full} of ${lowered.length} lowered bodies force completely`);
  console.log("  the rest carry a bound value somewhere, so those steps stay fused:");
  for (const [rel, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(rel).padEnd(12)} ${count}`);
  }
}
