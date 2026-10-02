import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {applyKernelWarnings, kernelWarnings, summarize} from "../tools/osd-unit-ci.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "tools/testdata-kernel-compat");
// The policy concerns activation compatibility of all input sources. The
// Unit method stays portable: executing integer bit operands is independently
// limited by Go lowering and the ordinary JS runtime, before this check.
// Red proof: removing !byteType(type) warns at fixture lines 30, 31, 32
// and 37 (valid x operations); the near-miss assertion fails.
const expected = [17, 18, 19, 20, 22, 23, 24, 26, 28, 29];
describe("folder unit kernel compatibility", function () {
  this.timeout(240000);
  it("finds each rejected form by AST and type, excluding byte operations and reads", () => {
    const warnings = kernelWarnings(fixture);
    assert.deepEqual(warnings.map((w) => w.line), expected);
    assert.deepEqual(warnings.slice(0, 4).map((w) => w.form),
      ["BIT-AND on i", "BIT-OR on int8", "BIT-XOR on i", "BIT-NOT on int8"]);
    for (const w of warnings) {
      assert.deepEqual(Object.keys(w), ["file", "line", "kind", "form", "message"]);
      assert.equal(w.kind, "kernel-reject");
      assert.equal(w.file, "zcl_kernel_compat.clas.abap");
    }
  });
  it("checks both operand sides, nested expressions, non-byte types and included sources", () => {
    mkdirSync(join(root, ".local"), {recursive: true});
    const temp = mkdtempSync(join(root, ".local/kernel-types-"));
    try {
      writeFileSync(join(temp, "zcl_types.clas.abap"),
        "CLASS zcl_types DEFINITION PUBLIC. ENDCLASS. CLASS zcl_types IMPLEMENTATION. ENDCLASS.\n");
      writeFileSync(join(temp, "zcl_types.clas.locals_imp.abap"), `CLASS lcl_types DEFINITION.
PUBLIC SECTION. DATA attr TYPE xstring. METHODS check. ENDCLASS.
CLASS lcl_types IMPLEMENTATION. METHOD check.
DATA x TYPE x. DATA xs TYPE xstring. DATA n TYPE i.
DATA p TYPE p. DATA c TYPE c. DATA s TYPE string.
x = x BIT-AND n.
x = p BIT-OR x.
x = x BIT-XOR c.
x = BIT-NOT s.
x = ( n + 1 ) BIT-AND x.
x = xs BIT-XOR xs.
x = BIT-NOT n BIT-AND x.
DATA ref TYPE REF TO lcl_types.
ref->attr+0(1) = '01'.
ENDMETHOD. ENDCLASS.
`);
      const warnings = kernelWarnings(temp);
      assert.deepEqual(warnings.map((w) => w.line), [6, 7, 8, 9, 10, 12, 12, 14]);
      assert.match(warnings[1].form, /^BIT-OR on p/);
      assert.match(warnings[2].form, /^BIT-XOR on c/);
      assert.equal(warnings[3].form, "BIT-NOT on string");
    } finally { rmSync(temp, {recursive: true, force: true}); }
  });
  it("strict mode attributes even a methodless class and preserves unrelated failures", () => {
    const warnings = kernelWarnings(fixture);
    const result = summarize(applyKernelWarnings({rows: [{class: "OTHER", status: "FAILURE", method: "CHECK"}]}, warnings, true));
    assert.equal(result.code, 2);
    assert.equal(result.result.rows[0].status, "FAILURE");
    assert.equal(result.result.rows[1].class, "ZCL_KERNEL_COMPAT");
    assert.equal(result.result.rows[1].status, "ERROR");
  });
  it("reports warnings with no Unit owner, preserving exit 3 unless strict", () => {
    const temp = mkdtempSync(join(root, ".local/kernel-no-owner-"));
    try {
      writeFileSync(join(temp, "zcl_kernel_compat.clas.abap"), readFileSync(join(fixture, "zcl_kernel_compat.clas.abap")));
      for (const runner of ["osgo", "osgjs"]) for (const strict of [false, true]) {
        const run = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, temp, "--json", ...(strict ? ["--kernel-strict"] : [])],
          {cwd: root, encoding: "utf8", timeout: 10000});
        assert.equal(run.status, strict ? 2 : 3, run.stdout + run.stderr);
        const result = JSON.parse(run.stdout);
        assert.deepEqual(result.warnings.map((w) => w.line), expected);
        assert.equal(result.totals.tests, 0);
        assert.deepEqual(result.rows.map((r) => r.status), strict ? ["ERROR"] : []);
      }
    } finally { rmSync(temp, {recursive: true, force: true}); }
  });
  for (const runner of ["osgo", "osgjs"]) for (const strict of [false, true]) {
    it(`${runner}: warnings ${strict ? "become ERROR rows with exit 2" : "preserve execution and exit 0"}`, () => {
      const run = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, fixture, "--json", ...(strict ? ["--kernel-strict"] : [])],
        {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6});
      assert.equal(run.error, undefined);
      assert.equal(run.status, strict ? 2 : 0, run.stdout + run.stderr);
      const result = JSON.parse(run.stdout);
      assert.deepEqual(result.warnings.map((w) => w.line), expected);
      assert.ok(result.rows.length > 0);
      for (const row of result.rows) {
        assert.equal(row.class, "ZCL_KERNEL_COMPAT");
        assert.equal(row.status, strict ? "ERROR" : "SUCCESS");
        assert.deepEqual(row.alerts.filter((a) => a.includes("OSG is more permissive")), result.warnings.map((w) => w.message));
      }
      for (const w of result.warnings) assert.equal(run.stderr.split("\n").filter((l) => l === w.message).length, 1);
      assert.equal(result.totals.tests, 1);
    });
  }
});
