// What the notes say about an upstream item, against what the tracker says.
//
// Both sessions found the queue stale twice in one day: items listed as open
// whose pull request had been merged hours earlier, and a "what is next"
// block naming three things that were all done. Nobody noticed, because a
// document is the one instrument in this tree with no test of its own -- a
// list of tasks is read like a measurement and ages like an opinion.
//
// So this asks the tracker. It does **not** try to understand the prose: it
// looks for a word of openness in the same line as a reference, and refuses
// when the reference is closed or merged. That is narrow on purpose --
// wording near a number is checkable, and "is this paragraph still true" is
// not.
//
// Bare `#1841` cannot name a repository, so the repository is taken from the
// line, and failing that from the section the line is in -- these notes name
// a repository once and then write bare numbers under it. How it was
// resolved travels with the reference, so a wrong attribution is visible.
// A reference nobody can resolve is reported as unresolved rather than
// guessed at: a state fetched for the wrong issue is worse than none.
//
//   node tools/osd-queue-check.mjs [docs/upstream.md docs/backlog.md …]
//
// Exit 0 nothing contradicted, 1 contradictions, 2 could not ask.
import {readFileSync, existsSync} from "node:fs";
import {execFileSync} from "node:child_process";

const DEFAULT_FILES = ["docs/upstream.md", "docs/backlog.md"];

// The word that names a repository, **most specific first**, because these
// names contain one another: every `abaplint/transpiler` also contains
// `abaplint`, and `open-abap-core` contains nothing but is contained by
// nothing either. Picking by position instead of by specificity resolved
// `abaplint #3486` to the transpiler and reported an open issue as merged --
// a wrong state, which is worse than none, and exactly what the note at the
// top of this file warns about. Measured against the tracker before it was
// believed (2026-09-19).
const REPOS = [
  ["open-abap-deprecated", "open-abap/open-abap-deprecated"],
  ["open-abap-odata", "open-abap/open-abap-odata"],
  ["open-abap-core", "open-abap/open-abap-core"],
  ["transpiler", "abaplint/transpiler"],
  ["abaplint", "abaplint/abaplint"],
];

// A line says the item is still out there. Deliberately a small list: every
// word here has to be one that would be **wrong** beside a merged PR.
const OPEN_WORDS = /\b(open|waiting|unanswered|pending|not (yet )?(sent|answered|merged)|awaiting)\b|открыт|ждfт|ждёт|не отвечен/i;

/** every `#nnnn` on a line, with the repository named nearest before it */
function nearest(before) {
  for (const [word, full] of REPOS) {
    if (before.includes(word)) return full;
  }
  return undefined;
}

export function referencesIn(text) {
  const out = [];
  // These notes name the repository once and then write bare numbers under
  // it, so a reference with no word of its own belongs to the section it is
  // in. That is carried, and **said**: `by: "section"` in the result, so a
  // wrong attribution is visible rather than silently authoritative.
  let section;
  text.split("\n").forEach((line, i) => {
    const named = nearest(line.toLowerCase());
    if (named !== undefined) section = named;
    for (const m of line.matchAll(/(^|[^A-Za-z0-9/#])#(\d{3,5})\b/g)) {
      const own = nearest(line.slice(0, m.index).toLowerCase());
      out.push({
        line: i + 1,
        number: Number(m[2]),
        repo: own ?? section,
        by: own === undefined ? "section" : "line",
        text: line.trim(),
      });
    }
  });
  return out;
}

/** the tracker's own word for it, or undefined when it cannot be asked */
function stateOf(repo, number) {
  try {
    const raw = execFileSync("gh", [
      "api", `repos/${repo}/issues/${number}`,
      "--jq", '[.state, (.pull_request.merged_at // "")] | @tsv',
    ], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
    const [state, merged] = raw.split("\t");
    // `merged` is truthy only when there is a date. It was compared against
    // the empty string, and `.trim()` above had already eaten the trailing
    // tab, so the field was **undefined** rather than empty -- and undefined
    // is not "", so every unmerged item came back "merged". An open issue
    // was reported as merged and the notes were told they were stale about
    // something that is still waiting. The absent value took the place of
    // one of the two real ones, which is the failure this repository has
    // been naming all day; it took ten minutes to write it again.
    return merged ? "merged" : state;
  } catch {
    return undefined;
  }
}

export function contradictions(refs, ask = stateOf) {
  const seen = new Map();
  const out = [];
  for (const r of refs) {
    if (r.repo === undefined) {
      out.push({...r, kind: "unresolved"});
      continue;
    }
    const key = `${r.repo}#${r.number}`;
    if (seen.has(key) === false) seen.set(key, ask(r.repo, r.number));
    const state = seen.get(key);
    if (state === undefined) {
      out.push({...r, kind: "unreachable"});
    } else if ((state === "closed" || state === "merged") && OPEN_WORDS.test(r.text)) {
      out.push({...r, kind: state, state});
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_FILES;
  const refs = [];
  for (const f of files) {
    if (existsSync(f) === false) continue;
    for (const r of referencesIn(readFileSync(f, "utf8"))) refs.push({...r, file: f});
  }
  if (refs.length === 0) {
    // the same rule the leak scan had to learn: reading nothing is not a pass
    console.error("osd-queue-check: no references found - that is not 'clean', it is 'nothing was read'");
    process.exit(2);
  }
  const bad = contradictions(refs);
  const said = bad.filter((b) => b.kind === "closed" || b.kind === "merged");
  const mute = bad.filter((b) => b.kind !== "closed" && b.kind !== "merged");
  console.error(`osd-queue-check: ${refs.length} references in ${files.length} file(s)`);
  for (const b of said) {
    console.log(`${b.file}:${b.line}  #${b.number} is ${b.state} upstream, the line calls it open`);
    console.log(`   ${b.text.slice(0, 110)}`);
  }
  for (const b of mute) console.error(`  ${b.file}:${b.line}  #${b.number} ${b.kind}`);
  if (said.length > 0) {
    console.error(`\n${said.length} line(s) say open about something that is not.`);
    process.exit(1);
  }
  if (mute.length === refs.length) {
    console.error("nothing could be asked - reporting that rather than passing");
    process.exit(2);
  }
}
