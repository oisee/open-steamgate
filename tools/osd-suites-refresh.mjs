// Refresh from successful main-push CI runs only; one sample per shard per run.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {assignShards, loadSuites} from './osd-suites.mjs';
import {mergeTimings} from './osd-suites-timings.mjs';

const valid = (n) => Number.isFinite(n) && n > 0;

export function timingDrift(files, previous, measured, count = 6, threshold = 120) {
  const missing = files.filter((file) => !valid(previous[file]) || !valid(measured[file]));
  const fresh = mergeTimings(previous, [measured]);
  const balanced = assignShards(files, fresh, count).map((shard) => shard.seconds);
  // Missing measurements use the runner's median fallback for prediction.
  const fallback = assignShards(['missing'], fresh, 1)[0].seconds;
  const current = assignShards(files, previous, count).map((shard) =>
    shard.files.reduce((sum, file) => sum + (valid(fresh[file]) ? fresh[file] : fallback), 0));
  const ideal = balanced.reduce((sum, seconds) => sum + seconds, 0) / count;
  const drift = Math.max(...current) - ideal;
  return {refresh: missing.length > 0 || drift > threshold, missing, drift, current, balanced};
}

export function latestShardArtifacts(names) {
  const shards = new Map();
  for (const name of names) {
    const match = /^suite-results-(\d+)-attempt-(\d+)$/.exec(name);
    if (!match) continue;
    const [, shard, attempt] = match;
    if (!shards.has(shard) || +attempt > shards.get(shard).attempt) shards.set(shard, {name, attempt: +attempt});
  }
  if (!shards.size) throw new Error('No shard timing artifacts downloaded');
  return [...shards.values()].map(({name}) => name).sort();
}

export function downloadTrustedTimings(gh, repository, scratch) {
  const {workflow_runs: runs} = JSON.parse(gh(['api',
    `repos/${repository}/actions/workflows/tests.yml/runs?event=push&branch=main&status=success&per_page=5`]));
  if (!runs.length) throw new Error('No successful main-push tests.yml runs found');
  const artifacts = [];
  for (const {id} of runs) {
    const run = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${id}`]));
    if (run.event !== 'push' || run.head_branch !== 'main' ||
        run.repository?.full_name !== repository || run.conclusion !== 'success') {
      throw new Error(`Untrusted timing run ${id}: expected successful push on ${repository} main`);
    }
    const dir = join(scratch, String(id));
    gh(['run', 'download', String(id), '--repo', repository, '--pattern', 'suite-results-*', '--dir', dir]);
    for (const name of latestShardArtifacts(readdirSync(dir))) {
      artifacts.push(JSON.parse(readFileSync(join(dir, name, 'timings.json'), 'utf8')));
    }
  }
  return artifacts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scratch = mkdtempSync(join(tmpdir(), 'osd-timings-'));
  try {
    const gh = (args) => execFileSync('gh', args, {encoding: 'utf8'});
    const repository = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
    const artifacts = downloadTrustedTimings(gh, repository, scratch);
    const output = 'test/suites-timings.json';
    const previous = JSON.parse(readFileSync(output, 'utf8'));
    const measured = mergeTimings({}, artifacts);
    const result = timingDrift(loadSuites().files, previous, measured);
    const summary = `Timing refresh: ${result.refresh}; missing timings: ${result.missing.length}; ` +
      `drift from ideal: ${(result.drift / 60).toFixed(2)} min; ` +
      `current shard minutes: ${result.current.map((s) => (s / 60).toFixed(2)).join(', ')}; ` +
      `balanced shard minutes: ${result.balanced.map((s) => (s / 60).toFixed(2)).join(', ')}.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `refresh=${result.refresh}\n`);
    if (result.refresh) writeFileSync(output, JSON.stringify(mergeTimings(previous, artifacts), null, 2) + '\n');
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}
