import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {applyKernelWarnings, kernelWarnings, summarize} from "../tools/osd-unit-ci.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = join(root, "tools/testdata-kernel-compat");
const validFixture = join(root, "tools/testdata-kernel-valid");
const bitsFixture = join(root, "tools/testdata-kernel-bits");
// Red proof: removing !byteType(type) must make the near-miss assertion fail.
const expected = [16, 17, 18, 20, 22, 23];
const expectedBits = [9, 10, 11, 12];
describe("folder unit kernel compatibility", function () {
  this.timeout(240000);
  it("finds each rejected form by AST and type, excluding byte operations and reads", () => {
    const warnings = kernelWarnings(fixture);
    assert.deepEqual(kernelWarnings(validFixture), []);
    assert.deepEqual(warnings.map((w) => w.line), expected);
    assert.deepEqual(kernelWarnings(bitsFixture).map((w) => w.form),
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
DATA external TYPE missing_ddic_type.
x = external BIT-AND external.
external+0(1) = '01'.
ENDMETHOD. ENDCLASS.
`);
      const warnings = kernelWarnings(temp);
      assert.deepEqual(warnings.map((w) => w.line), [6, 7, 8, 9, 10, 12, 12, 14]);
      assert.match(warnings[1].form, /^BIT-OR on p/);
      assert.match(warnings[2].form, /^BIT-XOR on c/);
      assert.equal(warnings[3].form, "BIT-NOT on string");
    } finally { rmSync(temp, {recursive: true, force: true}); }
  });
  it("default warnings preserve successful rows and exit codes", () => {
    const warnings = kernelWarnings(fixture);
    const result = summarize(applyKernelWarnings({rows: [
      {class: "ZCL_KERNEL_COMPAT", status: "SUCCESS", method: "CHECK"},
    ]}, warnings));
    assert.equal(result.code, 0);
    assert.equal(result.result.rows[0].status, "SUCCESS");
    assert.deepEqual(result.result.rows[0].alerts, warnings.map((w) => w.message));
  });
  it("strict mode attributes even a methodless class and preserves unrelated failures", () => {
    const warnings = kernelWarnings(fixture);
    const result = summarize(applyKernelWarnings({rows: [{class: "OTHER", status: "FAILURE", method: "CHECK"}]}, warnings, true));
    assert.equal(result.code, 2);
    assert.equal(result.result.rows[0].status, "FAILURE");
    assert.equal(result.result.rows[1].class, "ZCL_KERNEL_COMPAT");
    assert.equal(result.result.rows[1].status, "ERROR");
  });
  for (const runner of ["osgo", "osgjs"]) {
    it(`${runner}: scanner failures preserve rows and exit codes, including strict mode`, () => {
      const baseline = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, validFixture, "--json"],
        {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6});
      assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
      const expectedResult = JSON.parse(baseline.stdout);
      for (const strict of [false, true]) {
        const run = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, validFixture,
          "--json", ...(strict ? ["--kernel-strict"] : [])],
        {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6,
          env: {...process.env, OSD_KERNEL_SCANNER_FAIL: "1"}});
        assert.equal(run.error, undefined);
        assert.equal(run.status, baseline.status, run.stdout + run.stderr);
        const result = JSON.parse(run.stdout);
        assert.deepEqual(result.rows, expectedResult.rows);
        assert.deepEqual(result.totals, expectedResult.totals);
        assert.deepEqual(result.warnings, [{kind: "scanner-error", message: "Kernel compatibility scanner failed: forced scanner failure"}]);
        assert.equal(run.stderr.split("\n").filter((line) => line === result.warnings[0].message).length, 1);
      }
    });
    it(`${runner}: strict class selection keeps unselected warnings without ERROR rows`, () => {
      const temp = mkdtempSync(join(root, ".local/kernel-selected-"));
      try {
        cpSync(validFixture, temp, {recursive: true});
        cpSync(fixture, temp, {recursive: true});
        // JS builds all input classes, so the unselected owner's invalid
        // slice may still produce compiler diagnostics for the selected owner.
        // Strict mode must preserve those outcomes and add no unselected row.
        const options = {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6};
        const args = [`tools/${runner}-unit.mjs`, temp, "--json", "--class", "ZCL_KERNEL_VALID"];
        const baseline = spawnSync(process.execPath, args, options);
        assert.equal(baseline.error, undefined);
        const before = JSON.parse(baseline.stdout);
        const run = spawnSync(process.execPath, [...args, "--kernel-strict"], options);
        assert.equal(run.error, undefined);
        assert.equal(run.status, baseline.status, run.stdout + run.stderr);
        const result = JSON.parse(run.stdout);
        assert.deepEqual(result.warnings.map((w) => w.line), expected);
        assert.deepEqual(result.rows.map((r) => [r.class, r.status]), before.rows.map((r) => [r.class, r.status]));
        assert.ok(result.rows.length > 0);
        assert.ok(result.rows.every((r) => r.class === "ZCL_KERNEL_VALID" && r.status !== "ERROR"));
        assert.deepEqual(result.totals, before.totals);
        for (const warning of result.warnings)
          assert.equal(run.stderr.split("\n").filter((line) => line === warning.message).length, 1);
      } finally { rmSync(temp, {recursive: true, force: true}); }
    });
  }
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
    it(`${runner}: integer bits keep syntax diagnostics${strict ? " and become ERROR" : " and NOT_COMPILED"}`, () => {
      const run = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, bitsFixture, "--json", ...(strict ? ["--kernel-strict"] : [])],
        {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6});
      assert.equal(run.error, undefined);
      assert.equal(run.status, 2, run.stdout + run.stderr);
      const result = JSON.parse(run.stdout);
      assert.deepEqual(result.warnings.map((w) => w.line), expectedBits);
      assert.ok(result.rows.length > 0);
      for (const row of result.rows) {
        assert.equal(row.class, "ZCL_KERNEL_BITS");
        assert.equal(row.status, strict ? "ERROR" : "NOT_COMPILED");
        assert.deepEqual(row.alerts, result.warnings.map((w) => w.message));
        assert.match(row.message, /Operator only valid for XSTRING or HEX/);
      }
      assert.equal(result.compiled, 0);
      for (const w of result.warnings) assert.equal(run.stderr.split("\n").filter((l) => l === w.message).length, 1);
    });
  }
  for (const runner of ["osgo", "osgjs"]) for (const strict of [false, true]) {
    it(`${runner}: xstring warnings ${strict ? "become ERROR rows" : "preserve NOT_COMPILED diagnostics"}`, () => {
      const run = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, fixture, "--json", ...(strict ? ["--kernel-strict"] : [])],
        {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6});
      assert.equal(run.error, undefined);
      assert.equal(run.status, 2, run.stdout + run.stderr);
      const result = JSON.parse(run.stdout);
      assert.deepEqual(result.warnings.map((w) => w.line), expected);
      assert.ok(result.rows.length > 0);
      for (const row of result.rows) {
        assert.equal(row.class, "ZCL_KERNEL_COMPAT");
        assert.equal(row.status, strict ? "ERROR" : "NOT_COMPILED");
        assert.match(row.message, /xstring\/string offset\/length in writer position not possible/);
        assert.deepEqual(row.alerts.filter((a) => a.includes("this form is rejected")), result.warnings.map((w) => w.message));
      }
      for (const w of result.warnings) assert.equal(run.stderr.split("\n").filter((l) => l === w.message).length, 1);
      assert.equal(result.compiled, 0);
    });
  }
  for (const runner of ["osgo", "osgjs"]) {
    it(`${runner}: executes valid byte forms and xstring reads without warnings`, () => {
      const run = spawnSync(process.execPath, [`tools/${runner}-unit.mjs`, validFixture, "--json", "--kernel-strict"],
        {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 8e6});
      assert.equal(run.error, undefined);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      const result = JSON.parse(run.stdout);
      assert.deepEqual(result.warnings, []);
      assert.equal(result.compiled, 1);
      assert.equal(result.totals.tests, 1);
      assert.deepEqual(result.rows.map((r) => r.status), ["SUCCESS"]);
    });
  }

});
