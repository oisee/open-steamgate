import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
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
  assert.match(rows[1].message, /KERNEL_CX_ASSERT/);
  assert.match(rows[2].message, /CX_SY_ZERODIVIDE/);
  assert.match(rows[5].message, /KERNEL_CX_ASSERT/);
  assert.match(rows[6].message, /stopped after teardown failure/);
  assert.match(rows[8].message, /stopped after teardown failure/);
  assert.match(rows[9].message, /KERNEL_CX_ASSERT/);
});
