import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {reconcile} from "./unit-results.mjs";

const here = dirname(fileURLToPath(import.meta.url));
test("a missing method fails the run", () => {
  const expected = [{class: "OWNER", testclass: "LOCAL", method: "ONE", status: "READY", message: ""},
    {class: "OWNER", testclass: "LOCAL", method: "TWO", status: "READY", message: ""}];
  const rows = reconcile(expected, [{...expected[0], status: "SUCCESS"}]);
  assert.deepEqual(rows.map((r) => r.status), ["SUCCESS", "FAILED"]);
  assert.match(rows[1].message, /dropped this method/);
});

test("ABAP fixture runs pass, fail, exception, and teardown after failures", {timeout: 120000}, () => {
  const run = spawnSync("node", [join(here, "unit.mjs"), "--fixture", join(here, "testdata-unit")], {
    cwd: join(here, "..", ".."), encoding: "utf8", timeout: 110000, maxBuffer: 5e6,
  });
  assert.equal(run.status, 1, run.stderr || run.error?.message);
  const rows = JSON.parse(run.stdout).rows;
  assert.deepEqual(rows.map((r) => r.method), ["PASS", "FAIL", "EXCEPTION", "AFTER_FAILURE"]);
  assert.deepEqual(rows.map((r) => r.status), ["SUCCESS", "FAILED", "FAILED", "SUCCESS"]);
  assert.match(rows[1].message, /KERNEL_CX_ASSERT/);
  assert.match(rows[2].message, /CX_SY_ZERODIVIDE/);
});
