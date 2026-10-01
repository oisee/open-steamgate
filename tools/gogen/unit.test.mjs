import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {reconcile} from "./unit-results.mjs";
import {compileProgram, columnRegistry} from "./frontend.mjs";

const here = dirname(fileURLToPath(import.meta.url));
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
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "shard-0", "classes.json"), "utf8")).length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "shard-1", "classes.json"), "utf8")).length, 1);
  rmSync(dir, {recursive: true, force: true});
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
  const run = spawnSync("node", [join(here, "unit.mjs"), "--fixture", join(here, "testdata-unit")], {
    cwd: join(here, "..", ".."), encoding: "utf8", timeout: 110000, maxBuffer: 5e6,
  });
  assert.equal(run.status, 1, run.stderr || run.error?.message);
  const summary = JSON.parse(run.stdout);
  const rows = summary.rows;
  assert.ok(summary.timingMs.frontendClosureRounds.length > 0);
  for (const phase of ["emit", "goBuild", "run"]) assert.ok(summary.timingMs[phase] >= 0, phase);
  assert.deepEqual(rows.map((r) => r.method), ["PASS", "FAIL", "EXCEPTION", "AFTER_FAILURE", "FIRST", "SECOND", "THIRD", "FIRST", "SECOND", "FIRST", "SECOND"]);
  assert.deepEqual(rows.map((r) => r.status), ["SUCCESS", "FAILED", "FAILED", "SUCCESS", "FAILED", "FAILED", "SKIPPED", "FAILED", "SKIPPED", "FAILED", "SUCCESS"]);
  assert.equal(rows[1].message, "intentional failure");
  assert.match(rows[2].message, /CX_SY_ZERODIVIDE/);
  assert.equal(rows[5].message, "teardown: stop second");
  assert.match(rows[6].message, /stopped after teardown failure/);
  assert.match(rows[8].message, /stopped after teardown failure/);
  assert.equal(rows[9].message, "teardown: teardown continue");
});
