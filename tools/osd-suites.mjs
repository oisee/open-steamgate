// Run the integration suites listed in test/suites.json.
//
// The list lives in a file with one entry per line rather than on one line of
// package.json, because two people adding a suite conflicted on that line
// twice in one hour and will again -- there are more suites coming.
//
// It is a script rather than an inline `node -e` for a reason worth stating:
// the exit code has to be the runner's. A one-liner that spawns mocha and
// forgets to pass its status back reports success for a failing suite, which
// is the false green this project keeps paying for.
import {spawnSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";

/** A suite on disk that the list does not name.
 *
 *  **A hand-kept list of suites is the same instrument as a hand-kept list of
 *  tasks**: it is read like a measurement and ages like an opinion, and this
 *  tree already grew a checker for the other one (`osd-queue-check.mjs`) for
 *  exactly that reason. Measured 2026-09-20: ten files under `test/` with
 *  `describe(` blocks in them were in no list and had run in nobody's suite
 *  for as long as anybody could tell. All ten passed when finally run, so
 *  nothing was hiding in them -- which is the point. A green `npm run
 *  integration` was a true answer to a narrower question than the one it was
 *  read as, and the drift was silent in the direction that reads as progress.
 *
 *  What counts as a suite is `describe(` at the start of a line. Deliberately
 *  crude: `test/setup.mjs`, `test/start.mjs`, `test/run.mjs` and `test/seed.mjs`
 *  are harness modules with no `describe` in them and drop out on their own,
 *  so the rule needs no list of exceptions to keep true -- and a list of
 *  exceptions is the thing that drifts. */
export const hasSuites = (text) => /^describe\(/m.test(text);

export function suitesOnDisk(dir, read = (p) => readFileSync(p, "utf8"), list = readdirSync) {
  return list(dir)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => `${dir}/${f}`)
    .filter((p) => hasSuites(read(p)));
}

/** Both directions, because a checker that complains in one is half a
 *  checker: a suite nobody runs, and a name in the list that is no longer a
 *  file. The second would fail the run on its own when mocha cannot find it;
 *  it is named here so the reason arrives before the stack trace does. */
export function listDrift(onDisk, listed) {
  const named = new Set(listed.map((f) => f.replace(/^\.\//, "")));
  return {
    unlisted: onDisk.filter((p) => named.has(p) === false),
    absent: [...named].filter((p) => onDisk.includes(p) === false && existsSync(p) === false),
  };
}

// **What a run could not look at is a third value, and it is not a pass.**
//
// Several suites are guarded on inputs that are not in this repository and
// never will be -- `.local/corpus` holds real customer projects,
// `.local/corpus-sap` SAP-delivered samples, `.local/lars` the library
// clones. Where they are absent those cases skip, and mocha reports them as
// "pending", which scrolls past and says neither which nor why.
//
// So a run says what it could not see, before and after. "1020 passing" on a
// workstation and "1020 passing" on a runner are then different claims that
// each say which they are, instead of one number standing in for two
// systems. The rule this stands on is the tree's own: a green that cannot go
// red measures nothing, and a green that never looked is the same thing
// wearing a better coat.
export const OPTIONAL = [
  [".local/corpus", "real SEGW/UI5 projects: the oracle for every byte-for-byte claim"],
  [".local/corpus-sap", "SAP-delivered sample projects: the oracle for the mapped kinds"],
  [".local/lars", "the library clones (open-abap-core, abapGit, open-abap-odata)"],
];

export function reportSkips(optional = OPTIONAL, say = console.log) {
  const absent = optional.filter(([path]) => existsSync(path) === false);
  if (absent.length === 0) {
    say("osd-suites: every optional input is present -- this run is the wide one\n");
    return absent;
  }
  say("osd-suites: NOT looked at, so whatever this run says it says about less:");
  for (const [path, why] of absent) {
    say(`  ${path.padEnd(20)} ${why}`);
  }
  say("");
  return absent;
}

const invoked = process.argv[1] !== undefined && process.argv[1].endsWith("osd-suites.mjs");
if (invoked === false) {
  // imported for its reporter; the runner below is the command's job
} else {
const listed = JSON.parse(readFileSync(fileURLToPath(new URL("../test/suites.json", import.meta.url)), "utf8"));
const files = listed.files ?? [];
if (files.length === 0) {
  console.error("test/suites.json lists no suites -- that is not a pass, it is an empty run");
  process.exit(2);
}

// Asked before the run, not after: a list that does not cover the tree makes
// every number below it narrower than it reads, and finding that out at the
// end is finding it out after somebody has already believed the number.
// the same way the list itself is resolved: both sides of a comparison must
// be found by the same rule, or the checker answers about two trees
const TESTS = fileURLToPath(new URL("../test", import.meta.url));
const drift = listDrift(suitesOnDisk(TESTS).map((p) => `test/${p.slice(TESTS.length + 1)}`), files);
if (drift.unlisted.length > 0 || drift.absent.length > 0) {
  for (const p of drift.unlisted) console.error(`osd-suites: ${p} has suites in it and test/suites.json does not name it`);
  for (const p of drift.absent) console.error(`osd-suites: test/suites.json names ${p}, which is not there`);
  console.error("Add it, or delete it. A list of suites nobody checks is a list that quietly shrinks the run.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const report = argv.includes("--report-skips");
const extra = argv.filter((a) => a !== "--report-skips");
const absent = report ? reportSkips() : [];

const result = spawnSync("npx", ["mocha", ...files, ...extra], {stdio: "inherit"});

// again at the end, because the thing that decides what a number means must
// not be the thing that scrolled off the top
if (report && absent.length > 0) {
  console.log(`\nosd-suites: the above ran WITHOUT ${absent.map(([p]) => p).join(", ")}.`);
  console.log("            A pass here is narrower than a pass on a tree that has them.");
}
process.exit(result.status === null ? 1 : result.status);
}
