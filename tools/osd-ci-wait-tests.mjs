#!/usr/bin/env node
// Gate publication on the complete tests.yml push run for this exact tag commit.
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const timeoutMs = 60 * 60 * 1000;
const intervalMs = 20 * 1000;

export function selectRun(runs, tag, sha) {
  return runs.filter(run => run.event === "push" && run.head_branch === tag &&
    run.head_sha === sha).sort((a, b) => b.id - a.id)[0];
}

export function verdict(run) {
  if (!run || run.status !== "completed") return "waiting";
  return run.conclusion === "success" ? "success" : `failed (${run.conclusion || "no conclusion"})`;
}

function api(path, token) {
  return JSON.parse(execFileSync("gh", ["api", "-X", "GET", path], {
    encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
    env: {...process.env, GH_TOKEN: token},
  }));
}

async function main() {
  const [tag, sha] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!/^vscode-(?:stable-)?v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag || "") ||
      !/^[0-9a-f]{40}$/.test(sha || "") ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || "") || !token) {
    throw new Error("Expected release tag, 40-character commit SHA, GITHUB_REPOSITORY and GITHUB_TOKEN");
  }
  const deadline = Date.now() + timeoutMs;
  let runId;
  while (Date.now() < deadline) {
    if (!runId) {
      const response = api(`repos/${repo}/actions/workflows/tests.yml/runs?event=push&head_sha=${sha}&per_page=100`, token);
      const run = selectRun(response.workflow_runs || [], tag, sha);
      if (run) {
        runId = run.id;
        console.log(`Following tagged tests.yml run ${runId} for ${tag} at ${sha}`);
      }
    }
    if (runId) {
      const run = api(`repos/${repo}/actions/runs/${runId}`, token);
      if (run.id !== runId || run.head_sha !== sha || run.head_branch !== tag || run.event !== "push") {
        throw new Error(`Tagged tests run ${runId} no longer matches ${tag} at ${sha}`);
      }
      const result = verdict(run);
      if (result === "success") {
        console.log(`Tagged tests.yml run ${runId} passed`);
        return;
      }
      if (result !== "waiting") throw new Error(`Tagged tests.yml run ${runId} ${result}`);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, deadline - Date.now())));
  }
  throw new Error(`Timed out waiting for tagged tests.yml run for ${tag} at ${sha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
}
