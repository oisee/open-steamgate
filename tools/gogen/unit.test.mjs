import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {reconcile} from "./unit-results.mjs";
import {compileProgram, columnRegistry} from "./frontend.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const staticsArgs = [join(here, "unit.mjs"), "--fixture", "test/fixtures/unit-statics", "--class", "ZCL_OSD_STATICS_TEST", "--jobs", "2"];
const unitRun = (argv, env = {}) => new Promise((resolveRun) => {
  const child = spawn("node", argv, {cwd: root, env: {...process.env, ...env}});
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (status) => resolveRun({status, stdout, stderr, result: stdout ? JSON.parse(stdout) : null}));
});
test("a reused frontend registry keeps CDS to SQL view names", () => {
  const args = {folders: [join(here, "testdata")], objects: []};
  const first = compileProgram(args);
  const reused = compileProgram({...args, registry: first.reg});
  const expected = {ZGOGEN_T_DBWC: "ZGOGEN_T_DBWV"};
  assert.deepEqual(first.cdsViews, expected);
  assert.deepEqual(reused.cdsViews, expected);
  assert.deepEqual(columnRegistry(reused).cdsViews, expected);
  assert.equal(reused.tables.find((table) => table.name === "ZGOGEN_T_DBWC")?.sqlView, "ZGOGEN_T_DBWV");
});

test("a missing method fails the run", () => {
  const expected = [{class: "OWNER", testclass: "LOCAL", method: "ONE", status: "READY", message: ""},
    {class: "OWNER", testclass: "LOCAL", method: "TWO", status: "READY", message: ""}];
  const rows = reconcile(expected, [{...expected[0], status: "SUCCESS"}]);
  assert.deepEqual(rows.map((r) => r.status), ["SUCCESS", "FAILED"]);
  assert.match(rows[1].message, /dropped this method/);
});

test("comparison fails for each selected owner without a runnable method and for zero SAME rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-compare-"));
  const row = (owner, status, message = "") => ({class: owner, testclass: "LTCL_TEST", method: "TEST", status, message});
  const compare = (nodeRows, goRows, owners) => {
    writeFileSync(join(dir, "node.json"), JSON.stringify(nodeRows));
    writeFileSync(join(dir, "go.json"), JSON.stringify({rows: goRows}));
    const run = spawnSync("node", [join(here, "unit-compare.mjs"), "--node-json", join(dir, "node.json"),
      "--go-json", join(dir, "go.json"), ...owners.flatMap((owner) => ["--class", owner])],
    {encoding: "utf8", timeout: 10000});
    assert.equal(run.error, undefined, run.stderr);
    return {status: run.status, summary: JSON.parse(run.stdout)};
  };
  try {
    for (const [label, goRows] of [
      ["all skipped", [row("OWNER", "SKIPPED")]],
      ["absent rows", []],
      ["not compiled", [row("OWNER", "NOT_COMPILED", "compile error")]],
      ["reached tolerant stub", [row("OWNER", "FAILED", "NOT_COMPILED in OWNER=>TEST: unsupported")]],
      ["needs db", [row("OWNER", "NEEDS_DB", "database unavailable")]],
    ]) {
      const result = compare([row("OWNER", "SUCCESS")], goRows, ["OWNER"]);
      assert.equal(result.status, 1, label);
      assert.deepEqual(result.summary.classes.compiled, [], label);
      assert.equal(result.summary.classes.notCompiled.length, 1, label);
    }
    const noSame = compare([row("OWNER", "SUCCESS")], [row("OWNER", "FAILED")], ["OWNER"]);
    assert.equal(noSame.status, 1);
    assert.equal(noSame.summary.methods.same.length, 0);
    const stub = row("OWNER", "FAILED", "NOT_COMPILED in OWNER=>TEST: unsupported");
    const matchingStub = compare([stub], [stub], ["OWNER"]);
    assert.equal(matchingStub.status, 1);
    assert.equal(matchingStub.summary.methods.same.length, 0);
    assert.equal(matchingStub.summary.methods.nodeOnly.length, 1);
    const mixed = compare([row("GOOD", "SUCCESS"), row("EMPTY", "SUCCESS")], [row("GOOD", "SUCCESS")], ["GOOD", "EMPTY"]);
    assert.equal(mixed.status, 1);
    assert.deepEqual(mixed.summary.methods.same, ["GOOD/LTCL_TEST/TEST"]);
    assert.deepEqual(mixed.summary.classes.notCompiled.map((r) => r.class), ["EMPTY"]);
    assert.equal(compare([row("OWNER", "SUCCESS")], [row("OWNER", "SUCCESS")], ["OWNER"]).status, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("a different assertion in a known anomaly method remains DIFFERENT", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-anomaly-compare-"));
  const key = {class: "ZCL_STG_GATEWAY_TEST", testclass: "LTCL_DISPATCH", method: "ENTITY_SET"};
  const node = {...key, status: "SUCCESS", message: ""};
  const reviewed = {...key, status: "FAILED", message: "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:383"};
  const unrelated = {...reviewed, message: "Expected abap_true at zcl_stg_gateway_test.clas.testclasses.abap:380"};
  try {
    writeFileSync(join(dir, "node.json"), JSON.stringify([node]));
    for (const [go, expected] of [[reviewed, "nodeAnomaly"], [unrelated, "different"]]) {
      writeFileSync(join(dir, "go.json"), JSON.stringify({rows: [go]}));
      const run = spawnSync("node", [join(here, "unit-compare.mjs"), "--node-json", join(dir, "node.json"),
        "--go-json", join(dir, "go.json")], {encoding: "utf8", timeout: 10000});
      assert.equal(run.error, undefined, run.stderr);
      const methods = JSON.parse(run.stdout).methods;
      assert.deepEqual(methods.nodeAnomaly.map((row) => row.key), expected === "nodeAnomaly" ? ["ZCL_STG_GATEWAY_TEST/LTCL_DISPATCH/ENTITY_SET"] : []);
      assert.deepEqual(methods.different.map((row) => row.key), expected === "different" ? ["ZCL_STG_GATEWAY_TEST/LTCL_DISPATCH/ENTITY_SET"] : []);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("ABAP Unit class statics and constructor restart for each Go test class", {timeout: 120000}, () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-shards-"));
  const argv = [join(here, "unit.mjs"), "--fixture", "test/fixtures/unit-statics", "--class", "ZCL_OSD_STATICS_TEST", "--out", dir];
  const run = spawnSync("node", [...argv, "--jobs", "1"], {
    cwd: join(here, "..", ".."), encoding: "utf8", timeout: 110000, maxBuffer: 5e6,
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message || run.stdout);
  const rows = JSON.parse(run.stdout).rows;
  assert.deepEqual(rows.map(({testclass, method, status}) => [testclass, method, status]), [
    ["LTC_A", "M1_FIRST", "SUCCESS"], ["LTC_A", "M2_SECOND", "SUCCESS"],
    ["LTC_B", "M1_FIRST", "SUCCESS"], ["LTC_B", "M2_SECOND", "SUCCESS"],
  ]);
  const sharded = spawnSync("node", [...argv, "--jobs", "2"], {
    cwd: join(here, "..", ".."), encoding: "utf8", timeout: 110000, maxBuffer: 5e6,
  });
  assert.equal(sharded.status, 0, sharded.stderr || sharded.error?.message || sharded.stdout);
  assert.deepEqual(JSON.parse(sharded.stdout).rows, rows);
  const buildDir = JSON.parse(sharded.stdout).buildDir;
  assert.ok(existsSync(join(buildDir, "cmd", "unit", "zz_generated.go")));
  assert.equal(existsSync(join(dirname(buildDir), "shards")), false);
  rmSync(dir, {recursive: true, force: true});
});

test("overlapping unit runs isolate generated Go and shard files, even with one output directory", {timeout: 120000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-overlap-"));
  try {
    for (const shared of [false, true]) {
      const outA = join(dir, shared ? "shared" : "a");
      const outB = join(dir, shared ? "shared" : "b");
      const [a, b] = await Promise.all([unitRun([...staticsArgs, "--out", outA]), unitRun([...staticsArgs, "--out", outB])]);
      for (const run of [a, b]) {
        assert.equal(run.status, 0, run.stderr || run.stdout);
        assert.deepEqual(run.result.rows.map((row) => row.status), ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
        assert.equal(existsSync(join(dirname(run.result.buildDir), "shards")), false);
      }
      assert.notEqual(a.result.buildDir, b.result.buildDir);
      assert.ok(existsSync(join(a.result.buildDir, "cmd", "unit", "zz_generated.go")));
      assert.ok(existsSync(join(b.result.buildDir, "cmd", "unit", "zz_generated.go")));
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("overlapping runs merge distinct class timings in one output directory", {timeout: 120000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-timings-"));
  try {
    const [a, b] = await Promise.all([
      unitRun([...staticsArgs, "--out", dir]),
      unitRun([join(here, "unit.mjs"), "--fixture", join(here, "testdata-unit"), "--jobs", "2", "--out", dir]),
    ]);
    assert.equal(a.status, 0, a.stderr || a.stdout);
    assert.equal(b.status, 1, b.stderr || b.stdout);
    const timings = JSON.parse(readFileSync(join(dir, "class-timings.json"), "utf8"));
    assert.ok(Object.keys(timings).some((key) => key.includes("ZCL_OSD_STATICS_TEST")), JSON.stringify(timings));
    assert.ok(Object.keys(timings).some((key) => key.includes("ZCL_GOGEN_UNIT_FIXTURE")), JSON.stringify(timings));
    assert.equal(existsSync(join(dir, "class-timings.json.lock")), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("a stale timing lock with a dead owner is recovered", {timeout: 120000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-stale-lock-"));
  const lock = join(dir, "class-timings.json.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), "999999999\n");
  try {
    const run = await unitRun([...staticsArgs, "--out", dir]);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.deepEqual(run.result.rows.map((row) => row.status), ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
    assert.ok(Object.keys(JSON.parse(readFileSync(join(dir, "class-timings.json"), "utf8"))).length > 0);
    assert.equal(existsSync(lock), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("a live timing lock times out without hiding the JSON report", {timeout: 120000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-live-lock-"));
  const lock = join(dir, "class-timings.json.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), `${process.pid}\n`);
  try {
    const run = await unitRun([...staticsArgs, "--out", dir], {GOGEN_UNIT_TIMING_LOCK_TIMEOUT_MS: "50"});
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.deepEqual(run.result.rows.map((row) => row.status), ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
    assert.match(run.stderr, /warning: class timings were not saved: timing lock timed out/);
    assert.equal(existsSync(join(dir, "class-timings.json")), false);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("a missing or corrupt seed image and a killed shard fail every assigned method", {timeout: 120000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-faults-"));
  const wrapper = join(dir, "runner.mjs");
  writeFileSync(wrapper, `#!/usr/bin/env node
import {spawn, spawnSync} from "node:child_process";
import {rmSync, writeFileSync} from "node:fs";
const args = process.argv.slice(2);
const image = args[args.indexOf("--seed-image") + 1];
if (args.includes("--classes-file")) {
  if (process.env.GOGEN_UNIT_TEST_FAULT === "limit") {
    process.stderr.write("earlier stderr\\n");
    spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(21e6)); setTimeout(() => require('node:fs').writeFileSync(process.env.GOGEN_UNIT_TEST_MARKER, 'survived'), 500)"],
      {stdio: ["ignore", "inherit", "inherit"], env: process.env});
    process.exit(0);
  }
}
if (process.env.GOGEN_UNIT_TEST_FAULT === "signal" && args.includes("--seed-image-out")) {
  process.stderr.write("earlier stderr\\n");
  process.kill(process.pid, "SIGTERM");
}
const run = spawnSync(process.env.GOGEN_UNIT_BINARY, args, {stdio: "inherit"});
if (args.includes("--seed-image-out") && run.status === 0) {
  const target = args[args.indexOf("--seed-image-out") + 1];
  if (process.env.GOGEN_UNIT_TEST_FAULT === "missing") rmSync(target);
  if (process.env.GOGEN_UNIT_TEST_FAULT === "corrupt") writeFileSync(target, "not a SQLite database");
}
process.exit(run.status ?? 1);
`);
  chmodSync(wrapper, 0o755);
  try {
    for (const fault of ["missing", "corrupt", "limit", "signal"]) {
      const marker = join(dir, "survived");
      const run = await unitRun([...staticsArgs, "--out", join(dir, fault)],
        {GOGEN_UNIT_RUNNER: wrapper, GOGEN_UNIT_TEST_FAULT: fault, GOGEN_UNIT_TEST_MARKER: marker});
      assert.equal(run.status, 1, run.stderr || run.stdout);
      assert.deepEqual(run.result.rows.map((row) => row.status), ["FAILED", "FAILED", "FAILED", "FAILED"]);
      const messages = run.result.rows.map((row) => row.message);
      if (fault === "limit") {
        assert.ok(messages.every((msg) => /stdout limit exceeded/.test(msg)), messages.join("\n"));
        assert.ok(messages.every((msg) => !/earlier stderr/.test(msg)));
        await new Promise((resolveWait) => setTimeout(resolveWait, 700));
        assert.equal(existsSync(marker), false, "the runner's descendant survived the output limit");
      } else if (fault === "signal") {
        assert.ok(messages.every((msg) => /seed image: terminated by SIGTERM/.test(msg)), messages.join("\n"));
        assert.ok(messages.every((msg) => !/earlier stderr/.test(msg)));
      } else assert.ok(messages.every((msg) => /seed image:/.test(msg)));
      assert.equal(existsSync(join(dirname(run.result.buildDir), "shards")), false);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("runner errors and signals take precedence over earlier stderr", {timeout: 120000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-unit-run-errors-"));
  const wrapper = join(dir, "runner.mjs");
  writeFileSync(wrapper, `#!/usr/bin/env node
process.stderr.write("earlier stderr\\n");
process.kill(process.pid, "SIGTERM");
`);
  chmodSync(wrapper, 0o755);
  try {
    for (const [label, jobs, runner, expected] of [
      ["single-signal", "1", wrapper, "runner: terminated by SIGTERM"],
      ["seed-error", "2", join(dir, "absent"), "seed image: spawnSync"],
      ["single-error", "1", join(dir, "absent"), "runner: spawnSync"],
    ]) {
      const run = await unitRun([...staticsArgs.slice(0, -2), "--jobs", jobs, "--out", join(dir, label)], {GOGEN_UNIT_RUNNER: runner});
      assert.equal(run.status, 1, run.stderr || run.stdout);
      assert.ok(run.result.rows.every((row) => row.message.includes(expected)), JSON.stringify(run.result.rows));
      assert.ok(run.result.rows.every((row) => !row.message.includes("earlier stderr")));
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("unit statics parity labels only reviewed Node assertions as nodeAnomaly", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-statics-compare-"));
  const base = {class: "ZCL_OSD_STATICS_TEST", testclass: "LTC_B", method: "M1_FIRST"};
  const go = {...base, status: "SUCCESS", message: ""};
  try {
    writeFileSync(join(dir, "go.json"), JSON.stringify({rows: [go]}));
    for (const [message, category] of [["Expected '1', got '3'", "nodeAnomaly"], ["Expected '1', got '5'", "different"]]) {
      writeFileSync(join(dir, "node.json"), JSON.stringify([{...base, status: "FAILED", message}]));
      const run = spawnSync("node", [join(here, "unit-compare.mjs"), "--node-json", join(dir, "node.json"), "--go-json", join(dir, "go.json")], {encoding: "utf8", timeout: 10000});
      assert.equal(run.error, undefined, run.stderr);
      assert.deepEqual(JSON.parse(run.stdout).methods[category].map((row) => row.key), ["ZCL_OSD_STATICS_TEST/LTC_B/M1_FIRST"]);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("ABAP fixture runs pass, fail, exception, and teardown after failures", {timeout: 120000}, () => {
  const run = spawnSync("node", [join(here, "unit.mjs"), "--fixture", join(here, "testdata-unit"), "--no-cache"], {
    cwd: join(here, "..", ".."), encoding: "utf8", timeout: 110000, maxBuffer: 5e6,
  });
  assert.equal(run.status, 1, run.stderr || run.error?.message);
  const summary = JSON.parse(run.stdout);
  const rows = summary.rows;
  assert.ok(summary.timingMs.frontendClosureRounds.length > 0);
  for (const phase of ["emit", "goBuild", "run"]) assert.ok(summary.timingMs[phase] >= 0, phase);
  assert.deepEqual(rows.map((r) => r.method), ["PASS", "FAIL", "EXCEPTION", "AFTER_FAILURE", "DECIMAL_OUTSIDE", "FIRST", "SECOND", "THIRD", "FIRST", "SECOND", "FIRST", "SECOND"]);
  assert.deepEqual(rows.map((r) => r.status), ["SUCCESS", "FAILED", "FAILED", "SUCCESS", "SUCCESS", "FAILED", "FAILED", "SKIPPED", "FAILED", "SKIPPED", "FAILED", "SUCCESS"]);
  assert.equal(rows[1].message, "intentional failure");
  assert.match(rows[2].message, /CX_SY_ZERODIVIDE/);
  assert.equal(rows[6].message, "teardown: stop second");
  assert.match(rows[7].message, /stopped after teardown failure/);
  assert.match(rows[9].message, /stopped after teardown failure/);
  assert.equal(rows[10].message, "teardown: teardown continue");
});

test("byte section replacement, bounded FIND and memory spans run through ABAP Unit", async () => {
  const run = await unitRun([join(here, "unit.mjs"), "--fixture", "tools/gogen/testdata",
    "--class", "ZCL_GOGEN_T_BYTESECTION", "--class", "ZCL_GOGEN_T_BYTEMEM", "--jobs", "2"]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.result.classes, 2);
  assert.equal(run.result.compiled, 2);
  assert.equal(run.result.rows.length, 18);
  assert.ok(run.result.rows.every((row) => row.status === "SUCCESS"), run.stdout);
});
