#!/usr/bin/env node
// Titles are read from first-parent GitHub PR merge commits, in merge order.
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const git = (cwd, ...args) => execFileSync("git", args, {cwd, encoding: "utf8"}).trim();

export function mergedPullRequests(log, titleFor = () => undefined) {
  const seen = new Set();
  const rows = [];
  for (const message of log.split("\0")) {
    const lines = message.trim().split(/\r?\n/);
    const match = /^Merge pull request #(\d+)\b/.exec(lines[0]);
    if (!match || seen.has(match[1])) continue;
    const title = lines.slice(1).map((line) => line.trim()).find(Boolean) ?? titleFor(match[1]);
    if (!title) throw new Error(`merge commit for PR #${match[1]} has no title`);
    seen.add(match[1]);
    rows.push(`- ${title} (#${match[1]})`);
  }
  return rows;
}

export function generateNotes({cwd = process.cwd(), tag, from, to}) {
  if (tag) {
    if (!/^vscode-v\d+\.\d+\.\d+$/.test(tag)) throw new Error("invalid vscode-v tag");
    to = `refs/tags/${tag}`;
    git(cwd, "rev-parse", "--verify", `${to}^{commit}`);
    // The nearest older release reachable from this tag. A first release
    // covers the full first-parent history.
    try {
      from = git(cwd, "describe", "--first-parent", "--tags", "--match", "vscode-v*", "--abbrev=0", `${to}^`);
    } catch {
      from = undefined;
    }
  } else if (!to) {
    throw new Error("pass a release tag or --from <ref> --to <ref>");
  }
  if (from) git(cwd, "merge-base", "--is-ancestor", from, to);
  const range = from ? `${from}..${to}` : to;
  const log = git(cwd, "log", "--first-parent", "--merges", "--format=%B%x00", range);
  const rows = mergedPullRequests(log, (number) => {
    // Some historical merge commits have only the standard merge subject.
    // Ask GitHub for the PR title rather than treating the branch name as one.
    return execFileSync("gh", ["api", `repos/{owner}/{repo}/pulls/${number}`, "--jq", ".title"], {
      cwd, encoding: "utf8",
    }).trim();
  });
  return `# ${tag ?? to}\n\nMerged pull requests${from ? ` since ${from}` : ""}:\n\n${rows.length ? `${rows.join("\n")}\n` : "No pull request merge commits in this range.\n"}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = args[0] === "--from"
      ? {from: args[1], to: args[2] === "--to" ? args[3] : undefined}
      : {tag: args[0]};
    process.stdout.write(generateNotes(options));
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    process.exitCode = 1;
  }
}
