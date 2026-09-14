// The queue of fixes waiting to become pull requests.
//
// Not a list somebody maintains. A list somebody maintains is how we got a
// tool that printed the transpiler and stayed silent about the runtime, and
// an anomaly that said "the change is yours" pointing at the wrong session.
// This reads the branches out of the transpiler clone and the entries out of
// ANORMALIES.md and reports where the two disagree, in both directions:
//
//   a branch with no anomaly entry     -> work nobody wrote down
//   an entry naming a branch that is gone -> a record that has gone stale
//
// Usage:
//   node tools/osd-parked.mjs            the queue
//   node tools/osd-parked.mjs --remote   also ask GitHub whether a PR exists
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

const clone = resolve(process.env.TRANSPILER ?? "../transpiler");
const askRemote = process.argv.includes("--remote");

if (existsSync(clone) === false) {
  console.error(`no ${clone}: set TRANSPILER to the transpiler clone`);
  process.exit(2);
}

const git = (...args) => {
  try {
    return execFileSync("git", args, {cwd: clone, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
};

// Branches that are candidates to become a PR: anything but main and the
// integration branch, which exists precisely so that it never becomes one
const EXCLUDE = /^(main|master|local\/)/;
const branches = git("for-each-ref", "--format=%(refname:short)", "refs/heads/")
  .split("\n").filter(b => b !== "" && EXCLUDE.test(b) === false);

const anomalies = readAnomalies();

const rows = [];
for (const branch of branches) {
  const commits = git("log", "--oneline", "--format=%h %s", `main..${branch}`).split("\n").filter(l => l !== "");
  if (commits.length === 0) {
    continue; // merged, or nothing on it
  }
  const pushed = git("rev-parse", "--verify", `origin/${branch}`) !== "";
  const behind = git("rev-list", "--count", `${branch}..main`);
  rows.push({
    branch,
    commits,
    pushed,
    behind: Number(behind || 0),
    entries: anomalies.filter(a => a.text.includes(branch)),
    pr: askRemote ? pullRequestFor(branch) : undefined,
    // a branch can also explain itself: git branch --edit-description keeps
    // the note on the branch, where it cannot drift away from it
    description: git("config", `branch.${branch}.description`),
  });
}

console.log(`Parked for ${clone}\n`);
for (const row of rows.sort((a, b) => a.branch.localeCompare(b.branch))) {
  const marks = [];
  if (row.pushed === false) {
    marks.push("not pushed");
  }
  if (row.behind > 0) {
    marks.push(`${row.behind} behind main`);
  }
  if (row.pr) {
    marks.push(row.pr);
  }
  console.log(`${row.branch}${marks.length > 0 ? "  (" + marks.join(", ") + ")" : ""}`);
  for (const commit of row.commits) {
    console.log(`    ${commit}`);
  }
  if (row.entries.length === 0) {
    if (row.description === "") {
      console.log(`    !! nothing explains this branch: no ANORMALIES entry, no branch description`);
    } else {
      console.log(`    ${row.description}`);
    }
  } else {
    for (const entry of row.entries) {
      console.log(`    ${entry.id}  [${entry.status}]`);
    }
  }
  console.log("");
}

// the other direction: an entry that claims a branch which is not there
const named = new Set(rows.map(r => r.branch));
const stale = anomalies.filter(a => {
  const found = [...a.text.matchAll(/(?:^|[\s`(])((?:fix|feat|chore)\/[A-Za-z0-9._\-/]+)/g)].map(m => m[1]);
  return found.length > 0 && found.some(b => named.has(b) === false);
});
for (const entry of stale) {
  const found = [...entry.text.matchAll(/(?:^|[\s`(])((?:fix|feat|chore)\/[A-Za-z0-9._\-/]+)/g)]
    .map(m => m[1]).filter(b => named.has(b) === false);
  console.log(`!! ${entry.id} names ${[...new Set(found)].join(", ")}, which is not a branch with commits of its own`);
}

// Fixes are only half of what we owe upstream. An anomaly we decided not to
// fix here still owes abaplint an issue, and an issue nobody files is an
// anomaly we will rediscover.
// One phrase rather than a heuristic: an entry owes an issue when it says so.
// A guess at which entries mean "upstream" was the first version of this and
// it silently missed one, which is the failure mode we are trying to leave.
const owed = anomalies.filter(a => /needs an issue/i.test(a.text));
if (owed.length > 0) {
  console.log("Owed to abaplint/abaplint as issues rather than PRs:");
  for (const entry of owed) {
    console.log(`    ${entry.id}  [${entry.status}]`);
  }
  console.log("");
}

const waiting = rows.filter(r => r.pushed === false).length;
console.log(`${rows.length} branch${rows.length === 1 ? "" : "es"} parked, ${waiting} never pushed.`);
console.log("A PR goes out from a branch INSIDE abaplint/transpiler, or Regression never runs.");



function readAnomalies() {
  const text = readFileSync("ANORMALIES.md", "utf8");
  const out = [];
  // an entry runs from its ### heading to the next one
  const parts = text.split(/^### /m).slice(1);
  for (const part of parts) {
    const id = part.split(/[\s—]/)[0];
    const status = /^- Status: (.*)$/m.exec(part)?.[1].replace(/`/g, "").trim() ?? "?";
    out.push({id, status, text: part});
  }
  return out;
}

function pullRequestFor(branch) {
  try {
    const json = execFileSync("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "number,state"],
      {cwd: clone, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000});
    const list = JSON.parse(json);
    return list.length === 0 ? "no PR" : list.map(p => `#${p.number} ${p.state}`).join(", ");
  } catch {
    return "PR state unknown";
  }
}
