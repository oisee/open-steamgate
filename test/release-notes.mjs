import {strict as assert} from "node:assert";
import {execFileSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {breakingConsumerSection, generateNotes, mergedPullRequests} from "../scripts/release-notes.mjs";
import {expectedVersion, parseReleaseArgs, validateReleaseTarget} from "../scripts/release-version.mjs";

describe("release notes and version checks", () => {
  const bodies = {
    1: "## Summary\nBreaking: internal refactor, no consumer impact section.\n",
    2: "## Consumer impact\n\n<!-- One line; prefix Breaking: when consumers must act. -->\nBreaking: regenerate osg-demo's book for the new output format.\n\n## Validation\nTests pass.\n",
    3: "## Consumer impact\n\nnone\n\n## Details\nBreaking: this is outside consumer impact.\n",
    4: "## Consumer impact\r\n\r\nBreaking: replace the removed CLI flag.\r\n",
  };

  it("collects breaking consumer-impact lines and omits an empty section", () => {
    const prs = Object.entries(bodies).map(([number, body]) => ({number, body}));
    assert.equal(breakingConsumerSection(prs), "\n## Breaking for consumers\n\n- Breaking: regenerate osg-demo's book for the new output format. (#2)\n- Breaking: replace the removed CLI flag. (#4)\n");
    assert.equal(breakingConsumerSection([prs[0], prs[2], {number: 5, body: null}]), "");
    assert.equal(breakingConsumerSection([{number: 6, body: "## Consumer impact\n\n## Other\nBreaking: unrelated."}]), "");
  });

  it("reads PR titles from merge bodies, once per PR", () => {
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

  it("reads squash merges by the (#N) at the end of the subject", () => {
    const log = [
      "Allocate JOBCOUNT suffixes as base-36 max plus one (#441)\n\n* first commit\n* second",
      "Merge pull request #185 from example/branch\n\nAn older merge commit",
      "Fix a typo in the README",
      "Mention #12 in passing but not as a PR",
      "Allocate JOBCOUNT suffixes as base-36 max plus one (#441)",
    ].join("\0");
    assert.deepEqual(mergedPullRequests(log), [
      "- Allocate JOBCOUNT suffixes as base-36 max plus one (#441)",
      "- An older merge commit (#185)",
    ]);
  });

  it("takes a (#N) subject only when it is that PR's own merge commit", () => {
    const log = [
      "aaa\x01Direct maintenance (#12)",
      "bbb\x01Real fix (#12)\n\n* body",
      "ccc\x01Revert X (#13)",
      "ddd\x01Merge pull request #14 from example/b",
      "eee\x01Squashed later (#15)",
      "fff\x01Merge pull request #15 from example/c\n\nMerged earlier",
    ].join("\0");
    const merges = {12: "bbb", 15: "eee"};
    const isSquashOf = (number, sha) => merges[number] === sha;
    assert.deepEqual(mergedPullRequests(log, (n) => `Title of ${n}`, isSquashOf), [
      "- Real fix (#12)",
      "- Title of 14 (#14)",
      "- Squashed later (#15)",
    ]);
    // the other order: a merge commit first, then a squash claiming the same PR
    const swapped = ["fff\x01Merge pull request #15 from example/c\n\nMerged earlier", "eee\x01Squashed later (#15)"].join("\0");
    assert.deepEqual(mergedPullRequests(swapped, () => undefined, isSquashOf), ["- Merged earlier (#15)"]);
  });

  it("parses --allow-untagged separately from an optional VSIX in both orders", () => {
    const tag = "vscode-v0.1.42";
    const vsix = "build/vsix/open-steamgate-0.1.42.vsix";
    const expected = {tag, vsix, requireTag: false};
    assert.deepEqual(parseReleaseArgs([tag, "--allow-untagged", vsix]), expected);
    assert.deepEqual(parseReleaseArgs([tag, vsix, "--allow-untagged"]), expected);
    assert.deepEqual(parseReleaseArgs([tag, "--allow-untagged"]), {tag, vsix: undefined, requireTag: false});
    assert.deepEqual(parseReleaseArgs([tag, vsix]), {tag, vsix, requireTag: true});
  });

  it("checks a release against the tag commit, or an untagged draft's recorded SHA", () => {
    const tag = "vscode-v0.1.42";
    const head = "a".repeat(40);
    const other = "b".repeat(40);
    assert.doesNotThrow(() => validateReleaseTarget({tag, head, tagCommit: head, release: {isDraft: false, targetCommitish: "main"}}));
    assert.throws(() => validateReleaseTarget({tag, head, tagCommit: other, release: {isDraft: true, targetCommitish: head}}), /tag resolves to/);
    assert.doesNotThrow(() => validateReleaseTarget({tag, head, release: {isDraft: true, targetCommitish: head}}));
    assert.throws(() => validateReleaseTarget({tag, head, release: {isDraft: true, targetCommitish: other}}), /must be a draft targeting/);
    assert.throws(() => validateReleaseTarget({tag, head, release: {isDraft: false, targetCommitish: head}}), /must be a draft targeting/);
  });

  it("selects the previous release tag and first-parent PR merges", () => {
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
      const reads = [];
      const prFor = (number) => {
        reads.push(number);
        return {body: bodies[number]};
      };
      const notes = generateNotes({cwd, tag: "vscode-v0.1.3", prFor});
      assert.match(notes, /Second improvement \(#2\)/);
      assert.doesNotMatch(notes, /First improvement/);
      assert.match(notes, /since vscode-v0\.1\.2/);
      assert.match(notes, /## Breaking for consumers\n\n- Breaking: regenerate osg-demo's book for the new output format\. \(#2\)/);
      assert.deepEqual(reads, ["2"]);
      git("commit", "-q", "--allow-empty", "-m", "Unreleased change");
      git("commit", "-q", "--allow-empty", "-m", "Squashed improvement (#3)\n\n* one\n* two");
      const squashSha = git("rev-parse", "HEAD");
      git("commit", "-q", "--allow-empty", "-m", "Direct maintenance (#4)");
      const mergeShaFor = (number) => (number === "3" ? `2026-10-02T00:00:00Z ${squashSha}` : "null deadbeef");
      const draftNotes = generateNotes({cwd, tag: "vscode-v0.1.4", to: "HEAD", mergeShaFor, prFor});
      assert.doesNotMatch(draftNotes, /Direct maintenance/);
      assert.match(draftNotes, /since vscode-v0\.1\.3/);
      assert.doesNotMatch(draftNotes, /Second improvement/);
      assert.doesNotMatch(draftNotes, /Unreleased change/);
      assert.match(draftNotes, /^- Squashed improvement \(#3\)$/m);
      assert.doesNotMatch(draftNotes, /Breaking for consumers/);
      reads.length = 0;
      const apiNotes = generateNotes({cwd, tag: "vscode-v0.1.4", to: "HEAD", prFor: (number) => {
        reads.push(number);
        return {body: bodies[number], merged_at: number === "3" ? "2026-10-02T00:00:00Z" : null, merge_commit_sha: squashSha};
      }});
      assert.equal(apiNotes, draftNotes);
      assert.deepEqual(reads, ["4", "3"]); // one read for the squash SHA and body
      // Exercise the real gh/API path with a local fixture, without network access.
      writeFileSync(join(cwd, "gh"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({body: bodies[2]}))});\n`, {mode: 0o755});
      const cli = execFileSync(process.execPath, ["scripts/release-notes.mjs", "--from", "vscode-v0.1.2", "--to", "vscode-v0.1.3"], {
        cwd: process.cwd(), encoding: "utf8",
        env: {...process.env, PATH: `${cwd}:${process.env.PATH}`, GIT_DIR: join(cwd, ".git"), GIT_WORK_TREE: cwd},
      });
      assert.match(cli, /Second improvement \(#2\)/);
      assert.match(cli, /## Breaking for consumers/);
    } finally {
      rmSync(cwd, {recursive: true, force: true});
    }
  });
});
