import {strict as assert} from "node:assert";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {selectRun, verdict} from "../tools/osd-ci-wait-tests.mjs";

describe("tagged CI publication gate", () => {
  const sha = "a".repeat(40);
  const tag = "vscode-v1.2.3";

  it("selects only a push of the exact tag and SHA, using the newest matching run", () => {
    const runs = [
      {id: 9, event: "push", head_branch: tag, head_sha: "b".repeat(40)},
      {id: 8, event: "workflow_dispatch", head_branch: tag, head_sha: sha},
      {id: 7, event: "push", head_branch: "main", head_sha: sha},
      {id: 5, event: "push", head_branch: tag, head_sha: sha},
      {id: 6, event: "push", head_branch: tag, head_sha: sha},
    ];
    assert.equal(selectRun(runs, tag, sha)?.id, 6);
    assert.equal(selectRun(runs, tag, "c".repeat(40)), undefined);
  });

  it("accepts only whole-run success and rejects every completed non-success", () => {
    assert.equal(verdict({status: "in_progress"}), "waiting");
    assert.equal(verdict({status: "completed", conclusion: "success"}), "success");
    for (const conclusion of ["failure", "cancelled", "timed_out", "skipped", null]) {
      assert.match(verdict({status: "completed", conclusion}), /^failed /);
    }
  });

  it("follows the resolved run ID and rejects its failed conclusion", () => {
    const dir = mkdtempSync(join(tmpdir(), "osd-ci-wait-"));
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/usr/bin/env node
const fs = require("node:fs");
const path = process.argv.at(-1);
fs.appendFileSync(process.env.FAKE_LOG, path + "\\n");
const base = {id: 42, event: "push", head_branch: "vscode-v1.2.3", head_sha: "${sha}"};
console.log(JSON.stringify(path.includes("/workflows/")
  ? {workflow_runs: [base]}
  : {...base, status: "completed", conclusion: process.env.FAKE_CONCLUSION}));
`);
    chmodSync(gh, 0o755);
    const log = join(dir, "calls");
    const env = {...process.env, PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "example/repo", GITHUB_TOKEN: "test-token", FAKE_LOG: log};
    try {
      const script = resolve("tools/osd-ci-wait-tests.mjs");
      const pass = execFileSync(process.execPath, [script, tag, sha],
        {env: {...env, FAKE_CONCLUSION: "success"}, encoding: "utf8"});
      assert.match(pass, /run 42 passed/);
      assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map(path =>
        path.includes("/workflows/") ? "resolve" : "follow"), ["resolve", "follow"]);
      const failed = spawnSync(process.execPath, [script, tag, sha],
        {env: {...env, FAKE_CONCLUSION: "cancelled"}, encoding: "utf8"});
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /run 42 failed \(cancelled\)/);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
