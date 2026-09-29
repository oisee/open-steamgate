// Time an exact, green class intersection. Invoke under
// `flock /tmp/osd-heavy.lock` and with no other heavy workload.
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {home} from "./home.mjs";

const args = process.argv.slice(2);
const classes = args.flatMap((x, i) => x === "--class" ? [args[i + 1].toUpperCase()] : []);
if (!classes.length) throw new Error("pass the same green classes with --class, repeated");
const gogen = join(home, "tools", "gogen");
const go = join(gogen, "go");
const dir = mkdtempSync(join(tmpdir(), "gogen-unit-bench-"));
const samples = 3;
function run(cmd, argv, options = {}) {
  const r = spawnSync(cmd, argv, {cwd: home, encoding: "utf8", maxBuffer: 20e6, timeout: 300000, ...options});
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout || r.error?.message).slice(0, 1000)}`);
  return r;
}
function timed(label, cmd, argv, options = {}) {
  const rows = [];
  for (let i = 0; i < samples; i++) {
    const file = join(dir, `${label}-${i}.time`);
    run("/usr/bin/time", ["-f", "%e %M", "-o", file, cmd, ...argv], options);
    const [wall, rss] = readFileSync(file, "utf8").trim().split(/\s+/).map(Number);
    rows.push({wallSeconds: wall, peakRssKiB: rss});
  }
  const median = (field) => rows.map((r) => r[field]).sort((a, b) => a - b)[1];
  return {runs: rows, median: {wallSeconds: median("wallSeconds"), peakRssKiB: median("peakRssKiB")}};
}
try {
  // The runner writes the class closure into cmd/unit. Its own build and run
  // are a correctness gate before timing; those seconds are not samples.
  const gate = spawnSync("node", [join(gogen, "unit.mjs"), ...classes.flatMap((x) => ["--class", x])],
    {cwd: home, encoding: "utf8", maxBuffer: 20e6, timeout: 300000});
  const plan = JSON.parse(gate.stdout);
  if (plan.rows.some((r) => r.status !== "SUCCESS")) throw new Error("the selected Go methods are not all green");
  run("node", [join(gogen, "node-unit-select.mjs"), ...classes.flatMap((x) => ["--class", x])]);
  const nodeScript = join(home, "output", "_unit_selected.mjs");
  const bin = join(dir, "unit");
  const result = {classes, methods: plan.rows.length, instrument: "/usr/bin/time -f '%e %M' (seconds, KiB)", samples};
  result.node = timed("node", "node", ["--expose-gc", "--import", "./tools/osd-unit-bootstrap.mjs", nodeScript]);
  // A new cache per cold sample includes Go's standard-library compilation.
  result.goColdBuild = {runs: []};
  for (let i = 0; i < samples; i++) {
    const cache = mkdtempSync(join(tmpdir(), "gogen-unit-cold-"));
    const file = join(dir, `cold-${i}.time`);
    run("/usr/bin/time", ["-f", "%e %M", "-o", file, "go", "build", "-trimpath", "-o", bin, "./cmd/unit"],
      {cwd: go, env: {...process.env, GOCACHE: cache}});
    const [wallSeconds, peakRssKiB] = readFileSync(file, "utf8").trim().split(/\s+/).map(Number);
    result.goColdBuild.runs.push({wallSeconds, peakRssKiB});
    rmSync(cache, {recursive: true, force: true});
  }
  result.goWarmBuild = timed("warm", "go", ["build", "-trimpath", "-o", bin, "./cmd/unit"],
    {cwd: go, env: {...process.env, GOCACHE: process.env.GOCACHE ?? "/tmp/gogen-unit-gocache"}});
  result.goRun = timed("go", bin, []);
  const median = (rows, field) => rows.map((r) => r[field]).sort((a, b) => a - b)[1];
  result.goColdBuild.median = {wallSeconds: median(result.goColdBuild.runs, "wallSeconds"), peakRssKiB: median(result.goColdBuild.runs, "peakRssKiB")};
  console.log(JSON.stringify(result, null, 2));
} finally { rmSync(dir, {recursive: true, force: true}); }
