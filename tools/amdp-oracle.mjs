// Ask two systems to run the same AMDP and diff what they answer.
//
//   node tools/amdp-oracle.mjs record <cases.json> --target hxe  --out a.ndjson
//   node tools/amdp-oracle.mjs record <cases.json> --target a4h  --out b.ndjson
//   node tools/amdp-oracle.mjs compare a.ndjson b.ndjson [--rule <name>]... [--rules]
//
// Why this exists (Alice, 2026-09-19). About our AMDP path we can currently
// say "it works". That is not a claim a maintainer can check. With an oracle
// we can say "it agrees with a real system on this set, and here is where it
// does not" -- and the second claim is checkable **without raising a HANA**,
// because it is a table of divergences rather than a suite to run. That is
// the point for upstream: the evidence stops requiring the hardware.
//
// The shape is the demo oracle of docs/frame-comparison.md and the first
// sieve of tools/osd-compare.mjs, and it inherits their two rules:
//
//   1. **Calibration before belief.** One target recorded twice must compare
//      empty. If it does not, the normalisation is wrong and no other number
//      here means anything. `--calibrate` is that run, and the test for it is
//      the important one in test/amdp-oracle.mjs.
//
//   2. **No rule is predicted.** The default rule set is EMPTY on purpose.
//      Every normaliser here was put here by a calibration run that failed,
//      carries the reason it was needed, and says so when it fires. The
//      difference between "identical" and "identical after we masked four
//      fields" is a difference a reader is entitled to.
//
// Three targets, and the third one is mostly absent by design:
//
//   hxe   our path: cut the body out, deploy the procedure, call it
//   a4h   the oracle: the method compiled as the AMDP it is, on a system
//   abap  the ABAP twin, where a method has one -- there is no SQLScript to
//         Open SQL translator and there will not be one (Alice ruled it out
//         as too large), so this target is honestly EMPTY for most methods.
//         A case with no twin records `not attempted`, which is a third
//         value and not a zero: it is the difference between "we ran it and
//         got nothing" and "we never asked".
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {basename} from "node:path";
import {extract, parameterType} from "./amdp-extract.mjs";
import {connection, deploy, call} from "./amdp-run.mjs";

export const TARGETS = ["hxe", "a4h", "abap"];

/** A masking rule. `why` is not a comment -- it is the justification that has
 *  to survive somebody reading the report and asking why two different things
 *  were called the same. `on` is false unless a calibration run demanded it. */
export const RULES = [
  // Deliberately empty. See the header: rules arrive from calibration runs,
  // one at a time, each with the run that produced it named in `why`.
];

export function ruleByName(name) {
  return RULES.find((r) => r.name === name);
}

/** Apply the chosen rules to one recorded result, collecting what fired.
 *  A rule that changes nothing is not reported: "fired" means it masked a
 *  difference that was there, otherwise the report fills with noise and the
 *  one line that mattered is lost in it. */
export function normalise(value, rules, fired) {
  let out = value;
  for (const rule of rules) {
    const after = rule.apply(out);
    if (JSON.stringify(after) !== JSON.stringify(out)) fired.add(rule.name);
    out = after;
  }
  return out;
}

/** Read a case file and resolve the class it names, so a bad path or a
 *  missing method is an error at load rather than half way through a run. */
export function loadCases(file) {
  const spec = JSON.parse(readFileSync(file, "utf8"));
  const source = readFileSync(spec.class, "utf8");
  const extras = (spec.types ?? []).map((f) => readFileSync(f, "utf8"));
  const parsed = extract(source, spec.class.split("/").pop(), extras);
  for (const c of spec.cases) {
    const method = parsed.methods.find((m) => m.name.toUpperCase() === c.method.toUpperCase());
    if (method === undefined) {
      throw new Error(`${spec.class} has no AMDP method ${c.method}; it has: ` +
        (parsed.methods.map((m) => m.name).join(", ") || "none"));
    }
    c.resolved = method;
  }
  return {spec, parsed};
}

/** One recorded line. `outcome` has three values and they are not ranked:
 *  `ok` ran and answered, `error` ran and refused, `skipped` was never asked
 *  of this target. A comparison treats the third as "not comparable" rather
 *  than as a difference, and says how many there were. */
function line(target, c, outcome, extra) {
  return {case: c.name, method: c.method, target, outcome, ...extra};
}

export async function recordHxe(spec, parsed, cases) {
  const hdb = (await import("hdb")).default;
  const client = hdb.createClient(connection());
  await new Promise((resolve, reject) => client.connect((err) => (err ? reject(err) : resolve())));
  const out = [];
  try {
    for (const c of cases) {
      const unmapped = c.resolved.parameters.filter((p) => parameterType(p.abapType, parsed.types) === undefined);
      if (unmapped.length > 0) {
        out.push(line("hxe", c, "skipped",
          {reason: `no HANA type for ${unmapped.map((p) => p.name).join(", ")}`}));
        continue;
      }
      try {
        const name = await deploy(client, parsed.className, c.resolved, parsed.types);
        out.push(line("hxe", c, "ok", {result: await call(client, name, c.resolved, c.in ?? {}, parsed.types)}));
      } catch (e) {
        // A refusal is a recorded outcome, not a crash of the run: a system
        // that says no where another says yes is exactly the divergence this
        // instrument is for, and a throw here would hide it behind a stack.
        out.push(line("hxe", c, "error", {error: String(e?.message ?? e)}));
      }
    }
  } finally {
    client.end();
  }
  return out;
}

/** The oracle column. Not wired: running this needs the A4H sandbox, which
 *  CLAUDE.md says is asked for each time and was last granted for one PR.
 *  It records `skipped` with that reason rather than pretending, so a report
 *  built today says "not attempted" in the column instead of leaving a gap a
 *  reader will fill with a guess. */
export async function recordA4h(spec, parsed, cases) {
  return cases.map((c) => line("a4h", c, "skipped", {reason: "A4H not connected in this run"}));
}

/** The ABAP twin, by naming convention: `<method>_abap` in the same class,
 *  implemented in ABAP rather than BY DATABASE PROCEDURE. Absent for almost
 *  everything, and that is the honest state rather than a gap to fill. */
export async function recordAbap(spec, parsed, cases) {
  return cases.map((c) => line("abap", c, "skipped",
    {reason: c.twin === undefined ? "no ABAP twin for this method" : "twin runner not built"}));
}

export async function record(target, file) {
  const {spec, parsed} = loadCases(file);
  if (target === "hxe") return recordHxe(spec, parsed, spec.cases);
  if (target === "a4h") return recordA4h(spec, parsed, spec.cases);
  if (target === "abap") return recordAbap(spec, parsed, spec.cases);
  throw new Error(`unknown target ${target}; known: ${TARGETS.join(", ")}`);
}

export const toNdjson = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
export const fromNdjson = (text) =>
  text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

/** Diff two recordings case by case.
 *
 *  The return has four counts and they answer different questions:
 *  `same` agreed, `different` disagreed, `notComparable` could not be asked
 *  of one side, `missing` is in one file and not the other -- which is a
 *  defect in how the two runs were made and not a property of the systems,
 *  so it is counted apart from the rest. */
export function compare(a, b, rules = []) {
  const byCase = (lines) => new Map(lines.map((l) => [l.case, l]));
  const left = byCase(a);
  const right = byCase(b);
  const fired = new Set();
  const divergences = [];
  const notComparable = [];
  const missing = [];
  let same = 0;

  for (const [name, l] of left) {
    const r = right.get(name);
    if (r === undefined) { missing.push({case: name, only: l.target}); continue; }
    if (l.outcome === "skipped" || r.outcome === "skipped") {
      notComparable.push({case: name,
        [l.target]: l.outcome === "skipped" ? l.reason : "ran",
        [r.target]: r.outcome === "skipped" ? r.reason : "ran"});
      continue;
    }
    const ln = normalise(l.outcome === "ok" ? l.result : {error: l.error}, rules, fired);
    const rn = normalise(r.outcome === "ok" ? r.result : {error: r.error}, rules, fired);
    if (l.outcome === r.outcome && JSON.stringify(ln) === JSON.stringify(rn)) { same += 1; continue; }
    divergences.push({case: name, method: l.method,
      [l.target]: l.outcome === "ok" ? ln : {refused: l.error},
      [r.target]: r.outcome === "ok" ? rn : {refused: r.error}});
  }
  for (const [name, r] of right) if (!left.has(name)) missing.push({case: name, only: r.target});

  return {same, divergences, notComparable, missing, fired: [...fired]};
}

/** The report, written so the three numbers cannot be collapsed into one.
 *  Only `divergences.length === 0` **with** `same > 0` signs "no divergence
 *  found": a run where nothing was comparable agrees about nothing, and the
 *  line has to say so rather than print a clean tick. */
export function report(result) {
  const out = [];
  out.push(`${result.same} agreed · ${result.divergences.length} diverged · ` +
    `${result.notComparable.length} not comparable · ${result.missing.length} in one file only`);
  if (result.fired.length > 0) out.push(`masked by rule: ${result.fired.join(", ")}`);
  for (const d of result.divergences) {
    out.push(`\n  ${d.case} (${d.method})`);
    for (const [k, v] of Object.entries(d)) {
      if (k === "case" || k === "method") continue;
      out.push(`    ${k}: ${JSON.stringify(v)}`);
    }
  }
  for (const n of result.notComparable) {
    const why = Object.entries(n).filter(([k]) => k !== "case").map(([k, v]) => `${k}=${v}`).join(" ");
    out.push(`  not comparable: ${n.case} — ${why}`);
  }
  for (const m of result.missing) out.push(`  in ${m.only} only: ${m.case}`);
  if (result.divergences.length === 0) {
    out.push(result.same === 0
      ? "\nNothing was comparable, so nothing agreed. This is not a pass."
      : `\nNo divergence found across ${result.same} comparable cases.`);
  }
  return out.join("\n");
}

if (basename(process.argv[1] ?? "") === "amdp-oracle.mjs") {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
  const command = argv[0];

  if (command === "record") {
    const target = flag("target", "hxe");
    const lines = await record(target, argv[1]);
    const out = flag("out");
    if (out === undefined) process.stdout.write(toNdjson(lines));
    else { writeFileSync(out, toNdjson(lines)); console.log(`${lines.length} cases → ${out}`); }
  } else if (command === "compare") {
    const names = argv.filter((a, i) => argv[i - 1] === "--rule");
    const rules = names.map((n) => {
      const r = ruleByName(n);
      if (r === undefined) throw new Error(`no rule named ${n}; known: ${RULES.map((x) => x.name).join(", ") || "none"}`);
      return r;
    });
    const on = [...RULES.filter((r) => r.on), ...rules];
    const result = compare(fromNdjson(readFileSync(argv[1], "utf8")),
      fromNdjson(readFileSync(argv[2], "utf8")), on);
    console.log(report(result));
    process.exit(result.divergences.length === 0 ? 0 : 1);
  } else if (command === "calibrate") {
    // One target, recorded twice, in two connections. It must be empty.
    const target = flag("target", "hxe");
    const a = await record(target, argv[1]);
    const b = await record(target, argv[1]);
    const result = compare(a, b, RULES.filter((r) => r.on));
    console.log(`calibration, ${target} against itself:`);
    console.log(report(result));
    process.exit(result.divergences.length === 0 && result.same > 0 ? 0 : 1);
  } else if (command === "rules") {
    if (RULES.length === 0) console.log("no masking rules — calibration has not demanded any");
    for (const r of RULES) console.log(`${r.on ? "on " : "off"} ${r.name}\n    ${r.why}`);
  } else {
    console.error("usage: amdp-oracle.mjs record|compare|calibrate|rules …");
    process.exit(2);
  }
}
