// Measure the complete Unit build with one generated binary. Invoke under
// flock /tmp/osd-heavy.lock. Source edits are restored even on failure.
import {spawnSync} from "../osd-child-process.mjs";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {home} from "./home.mjs";

const root = mkdtempSync(join(tmpdir(), "gogen-unit-layer-bench-"));
const cache = join(root, "warm-cache");
const app = join(home, "src/demo/zcl_zstg_demo_dpc_ext.clas.abap");
const unit = join(home, "test/unit/zcl_osd_form_test.clas.testclasses.abap");
const original = new Map([[app, readFileSync(app, "utf8")], [unit, readFileSync(unit, "utf8")]]);
const median = (xs) => [...xs].sort((a, b) => a - b)[1];
const results = {};

function run(label, index, source) {
  if (source) writeFileSync(source, `${"* gogen build benchmark\n".repeat(index + 11)}${original.get(source)}`);
  const out = join(root, `${label}-${index}`);
  mkdirSync(out, {recursive: true});
  const timeFile = join(out, "time.txt");
  const goCache = label === "cold" ? join(out, "cache") : cache;
  mkdirSync(goCache, {recursive: true});
  const command = spawnSync("/usr/bin/time", ["-f", "%e %M", "-o", timeFile,
    "node", join(home, "tools/gogen/unit.mjs"), "--out", out], {
    cwd: home, encoding: "utf8", timeout: 900000, maxBuffer: 20e6,
    env: {...process.env, GOCACHE: goCache, ...(label === "app" ? {GOGEN_GO_BUILD_X: "1"} : {})},
  });
  if (!command.stdout) throw new Error(`${label} ${index}: ${command.stderr || command.error?.message}`);
  const summary = JSON.parse(command.stdout);
  if (command.status !== 1 || !summary.rows?.length) throw new Error(`${label} ${index}: exit ${command.status}: ${command.stderr || command.stdout.slice(0, 1000)}`);
  const [wallSeconds, peakRssKiB] = readFileSync(timeFile, "utf8").trim().split("\n").at(-1).split(/\s+/).map(Number);
  const t = summary.timingMs;
  return {wallSeconds, peakRssKiB, frontendMs: t.frontendClosureRounds.reduce((a, b) => a + b, 0),
    rounds: t.frontendClosureRounds.length, emitMs: t.emit, goBuildMs: t.goBuild, runMs: t.run,
    coreRebuilt: label === "app" ? /compile .*generated\/core/.test(readFileSync(join(out, "go-build-x.log"), "utf8")) : undefined,
    appRebuilt: label === "app" ? /compile .*generated\/app/.test(readFileSync(join(out, "go-build-x.log"), "utf8")) : undefined};
}

try {
  run("warm-prep", 0, null);
  for (const [label, source] of [["cold", null], ["warm", null], ["app", app], ["unit", unit]]) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push(run(label, i, source));
      if (source) writeFileSync(source, original.get(source));
    }
    results[label] = {runs, median: Object.fromEntries(["wallSeconds", "peakRssKiB", "frontendMs", "rounds", "emitMs", "goBuildMs", "runMs"]
      .map((field) => [field, median(runs.map((r) => r[field]))]))};
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  for (const [file, content] of original) writeFileSync(file, content);
  rmSync(root, {recursive: true, force: true});
}
