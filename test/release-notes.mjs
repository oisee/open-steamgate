import {strict as assert} from "node:assert";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {generateNotes, mergedPullRequests} from "../scripts/release-notes.mjs";
import {expectedVersion} from "../scripts/release-version.mjs";

test("reads PR titles from merge bodies, once per PR", () => {
  const log = [
    "Merge pull request #9 from example/branch\n\nFix a thing",
    "Merge remote branch 'main'\n\nNo PR",
    "Merge pull request #9 from example/branch\n\nFix a thing",
    "Merge pull request #8 from example/other\n\nAdd another thing",
  ].join("\0");
  assert.deepEqual(mergedPullRequests(log), ["- Fix a thing (#9)", "- Add another thing (#8)"]);
  assert.deepEqual(mergedPullRequests("Merge pull request #5 from example/branch", () => "Title from API"), ["- Title from API (#5)"]);
  assert.equal(expectedVersion("0.1.6", "1095"), "0.1.1095");
});

test("selects the previous release tag and first-parent PR merges", () => {
  const cwd = mkdtempSync(join(process.cwd(), ".release-notes-test-"));
  const git = (...args) => execFileSync("git", args, {cwd, encoding: "utf8"}).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Release Test");
    git("config", "user.email", "release-test@example.invalid");
    git("commit", "-q", "--allow-empty", "-m", "Initial");
    git("tag", "vscode-v0.1.1");
    for (const [branch, number, title, tag] of [
      ["first", 1, "First improvement", "vscode-v0.1.2"],
      ["second", 2, "Second improvement", "vscode-v0.1.3"],
    ]) {
      git("switch", "-q", "-c", branch);
      git("commit", "-q", "--allow-empty", "-m", title);
      git("switch", "-q", "main");
      git("merge", "-q", "--no-ff", branch, "-m", `Merge pull request #${number} from example/${branch}\n\n${title}`);
      git("tag", tag);
    }
    const notes = generateNotes({cwd, tag: "vscode-v0.1.3"});
    assert.match(notes, /Second improvement \(#2\)/);
    assert.doesNotMatch(notes, /First improvement/);
    assert.match(notes, /since vscode-v0\.1\.2/);
    const cli = execFileSync(process.execPath, ["scripts/release-notes.mjs", "--from", "vscode-v0.1.2", "--to", "vscode-v0.1.3"], {
      cwd: process.cwd(), encoding: "utf8",
      env: {...process.env, GIT_DIR: join(cwd, ".git"), GIT_WORK_TREE: cwd},
    });
    assert.match(cli, /Second improvement \(#2\)/);
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});
