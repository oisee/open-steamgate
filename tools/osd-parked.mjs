// The queue of fixes waiting to become pull requests.
//
// Not a list somebody maintains. A list somebody maintains is how we got a
// tool that printed the transpiler and stayed silent about the runtime, and
// an anomaly that said "the change is yours" pointing at the wrong session.
// This reads the branches out of the upstream clones and the entries out of
// ANORMALIES.md and reports where the two disagree, in both directions:
//
//   a branch with nothing explaining it       -> work nobody wrote down
//   an entry naming a branch that is not there -> a record that has gone stale
//
// Usage:
//   node tools/osd-parked.mjs            the queue
//   node tools/osd-parked.mjs --remote   also ask GitHub whether a PR exists
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

// Two upstream repositories, and the difference between them changes the
// procedure rather than only the address: we can push a branch to
// abaplint/transpiler and cannot to abaplint/abaplint, so the second can only
// be PR'd from a fork — and its regression workflow skips forks by its own
// condition, `github.repository == 'abaplint/abaplint'`.
const CLONES = [
  {
    name: "abaplint/transpiler",
    path: resolve(process.env.TRANSPILER ?? "../transpiler"),
    note: "branch here and PR from here: Regression runs on the push",
  },
  {
    name: "abaplint/abaplint",
    path: resolve(process.env.ABAPLINT ?? "../abaplint"),
    note: "no push rights: a PR can only come from a fork, and Regression skips forks. Run it locally and put the result in the PR body",
  },
];

const askRemote = process.argv.includes("--remote");

// anything but main and the integration branch, which exists precisely so
// that it never becomes a pull request
const EXCLUDE = /^(main|master|local\/)/;
const BRANCH_IN_TEXT = /(?:^|[\s`(])((?:fix|feat|chore)\/[A-Za-z0-9._\-/]+)/g;

const anomalies = readAnomalies();
const seen = new Set();

for (const repo of CLONES) {
  if (existsSync(repo.path) === false) {
    console.log(`${repo.name}: no clone at ${repo.path}\n`);
    continue;
  }
  report(repo);
}
staleReferences();
owedIssues();

function report(repo) {
  const git = gitIn(repo.path);
  const branches = git("for-each-ref", "--format=%(refname:short)", "refs/heads/")
    .split("\n").filter(b => b !== "" && EXCLUDE.test(b) === false);

  const rows = [];
  for (const branch of branches) {
    const commits = git("log", "--format=%h %s", `main..${branch}`).split("\n").filter(l => l !== "");
    if (commits.length === 0) {
      continue; // merged, or nothing on it
    }
    seen.add(branch);
    rows.push({
      branch,
      commits,
      // any remote, not only origin: a repository we cannot push to is
      // contributed to from a fork, and saying "not pushed" about a branch
      // that is already a pull request is the kind of lie this tool exists
      // to catch elsewhere
      pushed: pushedTo(git, branch),
      behind: Number(git("rev-list", "--count", `${branch}..main`) || 0),
      // exact branch names, not substrings: "fix/conv-builtin-type" is a
      // prefix of "fix/conv-builtin-type-name", and a prefix match had each
      // of them claiming the other's entries
      entries: anomalies.filter(a => a.branches.has(branch)),
      // a branch can also explain itself: git branch --edit-description keeps
      // the note on the branch, where it cannot drift away from it
      description: git("config", `branch.${branch}.description`),
      pr: askRemote ? pullRequestFor(repo.path, branch) : undefined,
    });
  }

  console.log(`${repo.name}  ${repo.path}`);
  console.log(`  ${repo.note}\n`);
  for (const row of rows.sort((a, b) => a.branch.localeCompare(b.branch))) {
    const marks = [];
    if (row.pushed === undefined) {
      marks.push("not pushed");
    } else if (row.pushed !== "origin") {
      marks.push(`pushed to ${row.pushed}`);
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
    // the description is printed whether or not there are entries: a branch
    // that has been superseded still carries the entries it was named in, and
    // hiding its note behind them is how it stays in the queue forever
    if (row.description !== "") {
      console.log(`    ${row.description}`);
    }
    for (const entry of row.entries) {
      console.log(`    ${entry.id}  [${entry.status}]`);
    }
    if (row.entries.length === 0 && row.description === "") {
      console.log("    !! nothing explains this branch: no ANORMALIES entry, no branch description");
    }
    console.log("");
  }
  const waiting = rows.filter(r => r.pushed === undefined).length;
  console.log(`  ${rows.length} branch${rows.length === 1 ? "" : "es"} parked here, ${waiting} never pushed.\n`);
}

// an entry naming a branch that no clone has, which is how a record rots
function staleReferences() {
  for (const entry of anomalies) {
    const named = [...entry.branches].filter(b => seen.has(b) === false);
    if (named.length > 0) {
      console.log(`!! ${entry.id} names ${named.join(", ")}, which is not a branch with commits of its own`);
    }
  }
}

// Fixes are only half of what we owe upstream. An anomaly we decided not to
// fix ourselves still owes an issue, and an issue nobody files is a defect we
// rediscover. One phrase rather than a heuristic: an entry owes an issue when
// it says so. The first version of this guessed, and silently missed one.
function owedIssues() {
  const owed = anomalies.filter(a => /needs an issue/i.test(a.text));
  if (owed.length === 0) {
    return;
  }
  console.log("\nOwed as issues rather than pull requests:");
  for (const entry of owed) {
    console.log(`    ${entry.id}  [${entry.status}]`);
  }
}

function pushedTo(git, branch) {
  for (const remote of git("remote").split("\n").filter(r => r !== "")) {
    if (git("rev-parse", "--verify", `${remote}/${branch}`) !== "") {
      return remote;
    }
  }
  return undefined;
}

function gitIn(cwd) {
  return (...args) => {
    try {
      return execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    } catch {
      return "";
    }
  };
}

function readAnomalies() {
  const text = readFileSync("ANORMALIES.md", "utf8");
  // an entry runs from its ### heading to the next one
  return text.split(/^### /m).slice(1).map(part => ({
    id: part.split(/[\s—]/)[0],
    status: /^- Status: (.*)$/m.exec(part)?.[1].replace(/`/g, "").trim() ?? "?",
    text: part,
    branches: new Set([...part.matchAll(BRANCH_IN_TEXT)].map(m => m[1])),
  }));
}

function pullRequestFor(cwd, branch) {
  try {
    const json = execFileSync("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "number,state"],
      {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000});
    const list = JSON.parse(json);
    return list.length === 0 ? "no PR" : list.map(p => `#${p.number} ${p.state}`).join(", ");
  } catch {
    return "PR state unknown";
  }
}
