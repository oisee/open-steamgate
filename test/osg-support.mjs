import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {KERNEL_FORMS, kernelWarnings} from "../tools/osd-kernel-compat.mjs";
import {generate, inventory, evidence} from "../tools/osg-support.mjs";

const root = resolve(import.meta.dirname, "..");
describe("generated corpus support evidence", function () {
  this.timeout(15000);
  let temp;
  before(() => { mkdirSync(join(root, ".local"), {recursive: true}); temp = mkdtempSync(join(root, ".local/support-test-")); });
  after(() => rmSync(temp, {recursive: true, force: true}));
  it("imports the standalone scanner for an unsaved buffer with stable locations and anchors", () => {
    const file = "zcl_kernel_bits.clas.abap";
    const source = readFileSync(join(root, "tools/testdata-kernel-bits", file), "utf8");
    const warnings = kernelWarnings([{file, source}]);
    assert.deepEqual(warnings.map((w) => [w.file, w.line, w.form, w.supportAnchor]), [
      [file, 9, "BIT-AND on i", "docs/osg-support.md#kernel-bit-and-operand-not-x"],
      [file, 10, "BIT-OR on int8", "docs/osg-support.md#kernel-bit-or-operand-not-x"],
      [file, 11, "BIT-XOR on i", "docs/osg-support.md#kernel-bit-xor-operand-not-x"],
      [file, 12, "BIT-NOT on int8", "docs/osg-support.md#kernel-bit-not-operand-not-x"],
    ]);
    assert.deepEqual(kernelWarnings({file, source}), warnings);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      'import {kernelWarnings} from "./tools/osd-kernel-compat.mjs"; kernelWarnings([]);'],
    {cwd: root, encoding: "utf8", env: {...process.env, OSD_KERNEL_SCANNER_FAIL: "1"}});
    assert.notEqual(child.status, 0); assert.match(child.stderr, /forced scanner failure/);
  });
  it("commits a unique explicit anchor for every known kernel form", () => {
    const page = readFileSync(join(root, "docs/osg-support.md"), "utf8");
    const anchors = [...page.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]);
    assert.equal(new Set(anchors).size, anchors.length);
    assert.equal(new Set(KERNEL_FORMS.map((f) => f.anchor)).size, KERNEL_FORMS.length);
    for (const {anchor} of KERNEL_FORMS) assert.equal(anchors.filter((a) => a === anchor).length, 1, anchor);
  });
  it("credits helpers only from declared successful full-folder runs and preserves partial results", () => {
    const dir = join(temp, "helpers"); mkdirSync(dir);
    for (const cls of ["pass", "fail", "helper"])
      writeFileSync(join(dir, `zcl_${cls}.clas.abap`), `CLASS zcl_${cls} DEFINITION PUBLIC. ENDCLASS.
CLASS zcl_${cls} IMPLEMENTATION. ENDCLASS.
`);
    const file = join(temp, "helpers.json"), manifest = join(temp, "runs.json");
    const rows = [{class: "ZCL_PASS", status: "SUCCESS", method: "CHECK"},
      {class: "ZCL_FAIL", status: "SUCCESS", method: "CHECK"}];
    writeFileSync(file, JSON.stringify({rows}));
    writeFileSync(manifest, JSON.stringify([{folder: "helpers", runtime: "osgo", file: "helpers.json"},
      {folder: "helpers", runtime: "osgjs", reason: "runner crashed: heap exhausted"}]));
    const paths = {osgo: [], osgjs: [], runs: [manifest]};
    const all = generate([dir], paths);
    assert.ok(all.report.constructs.every((c) => c.osgo.status === "runs"));
    assert.match(all.markdown, /ZCL_HELPER: exercised by 2 tests in the same run/);
    assert.match(all.markdown, /helpers \/ osgjs: no evidence: runner crashed: heap exhausted/);
    assert.equal(all.report.runtime.osgo.classes, 3);
    rows[1] = {...rows[1], status: "FAILURE", message: "expected 2, got 1\nstack trace"};
    writeFileSync(file, JSON.stringify({rows}));
    const partial = generate([dir], paths);
    const result = partial.report.constructs[0].osgo;
    assert.equal(result.status, "fails");
    assert.equal(result.missing.length, 0);
    assert.ok(result.failures.some((f) => f.class === "ZCL_HELPER" && f.status === "unknown"));
    assert.ok(result.failures.some((f) => f.class === "ZCL_FAIL" && f.message === "expected 2, got 1"));
    assert.equal(evidence(["ZCL_PASS"], {rows: new Map([["ZCL_PASS", [rows[0]]]])}).status, "runs");
    // A selected class result alone cannot confer full-folder credit.
    assert.ok(generate([dir], {osgo: [file], osgjs: []}).report.constructs.every((c) => c.osgo.missing.includes("ZCL_HELPER")));
    writeFileSync(file, JSON.stringify({rows: []}));
    assert.ok(generate([dir], paths).report.constructs.every((c) => c.osgo.status === "no evidence"));
  });
  it("resolves statement, builtin, elementary declaration and assignment types without guessing", () => {
    const dir = join(temp, "types"); mkdirSync(dir);
    writeFileSync(join(dir, "zcl_types.clas.abap"), `CLASS zcl_types DEFINITION PUBLIC.
PUBLIC SECTION. CLASS-METHODS check. ENDCLASS.
CLASS zcl_types IMPLEMENTATION. METHOD check.
DATA n TYPE i. DATA big TYPE int8. DATA dec TYPE p LENGTH 8 DECIMALS 2.
DATA x TYPE x. DATA xs TYPE xstring. DATA c TYPE c LENGTH 2. DATA s TYPE string.
DATA: BEGIN OF struct, field TYPE n LENGTH 3, END OF struct.
DATA f TYPE f. DATA df TYPE decfloat34. DATA missing TYPE missing_type.
n = strlen( s ). MOVE n TO big. big = n. n = missing.
ENDMETHOD. ENDCLASS.
`);
    const inv = inventory(dir);
    const names = [...inv.constructs.keys()];
    for (const name of ["statement: Move", "function: strlen", "type: i", "type: int8",
      "type: p LENGTH 8 DECIMALS 2", "type: x LENGTH 1", "type: xstring", "type: c LENGTH 2",
      "type: string", "type: n LENGTH 3", "type: f", "type: decfloat34", "type: unknown", "conversion: unknown → i"])
      assert.ok(names.includes(name), name + " absent: " + names.join(", "));
    const conversion = inv.constructs.get("conversion: i → int8");
    assert.equal(conversion.count, 2);
    assert.equal(conversion.lines.size, 1);
    assert.equal(conversion.classes.size, 1);
  });
  it("joins every row, retains failures/refusals, and requires evidence for every using class", () => {
    const rows = new Map([["A", [{status: "SUCCESS"}, {status: "FAILURE"}]],
      ["B", [{status: "NOT_COMPILED", message: "unsupported form\nprivate detail"}]],
      ["C", [{status: "SUCCESS"}]], ["D", [{status: "ERROR"}]]]);
    assert.equal(evidence(["A", "C"], {rows}).status, "fails");
    assert.equal(evidence(["D"], {rows}).status, "fails");
    assert.deepEqual(evidence(["B"], {rows}).refusals, [{class: "B", message: "unsupported form"}]);
    assert.equal(evidence(["C", "MISSING"], {rows}).status, "no evidence");
    assert.equal(evidence(["C"], {rows}).status, "runs");
  });
  it("generates every section from kernel fixtures and checks equal and changed pages via CLI", () => {
    const dirs = ["compat", "valid", "bits"].map((name) => join(root, "tools/testdata-kernel-" + name));
    const extra = join(temp, "extra"); mkdirSync(extra);
    writeFileSync(join(extra, "zcl_extra.clas.abap"), `CLASS zcl_extra DEFINITION PUBLIC.
PUBLIC SECTION. CLASS-METHODS check. ENDCLASS.
CLASS zcl_extra IMPLEMENTATION. METHOD check.
DO 1 TIMES. CONTINUE. ENDDO. RETURN. ENDMETHOD. ENDCLASS.
`);
    dirs.push(extra);
    const go = join(temp, "go.json"), js = join(temp, "js.json");
    writeFileSync(go, JSON.stringify({rows: [
      {class: "ZCL_KERNEL_VALID", status: "SUCCESS", method: "CHECK"},
      {class: "ZCL_KERNEL_COMPAT", status: "NOT_COMPILED", message: "unsupported write\nsecond line"},
      {class: "ZCL_KERNEL_BITS", status: "FAILURE", method: "CHECK"},
    ]}));
    writeFileSync(js, JSON.stringify({rows: [{class: "ZCL_KERNEL_VALID", status: "SUCCESS", method: "CHECK"}]}));
    const {markdown, report} = generate(dirs, {osgo: [go], osgjs: [js]});
    for (const title of ["Runs on both", "Runs on one only", "Fails", "Refused", "Warned", "Seen but no evidence"])
      assert.ok(markdown.includes("## " + title));
    for (const title of ["Runs on both", "Fails", "Refused", "Seen but no evidence"])
      assert.match(markdown, new RegExp("## " + title + " \\([1-9]"));
    assert.match(markdown, /ZCL_KERNEL_BITS: FAILURE/);
    assert.match(markdown, /ZCL_KERNEL_COMPAT: unsupported write/);
    assert.ok(!markdown.includes("second line"));
    assert.equal(report.runtime.osgo.tests, 2);
    assert.equal(report.runtime.osgjs.classes, 1);
    assert.equal(report.warnings.reduce((n, w) => n + w.count, 0), 10);
    assert.equal(report.knownWarnings.length, 5);
    // A separate successful Go class creates the one-runtime section.
    const one = join(temp, "one.json");
    writeFileSync(one, JSON.stringify({rows: [{class: "ZCL_EXTRA", status: "SUCCESS", method: "CHECK"}]}));
    const paths = {osgo: [go, one], osgjs: [js]};
    const page = generate(dirs, paths).markdown;
    assert.match(page, /## Runs on one only \([1-9]/);
    assert.equal(generate([...dirs].reverse(), paths).markdown, page);
    const file = join(temp, "page.md"), json = join(temp, "page.json");
    const args = ["tools/osg-support.mjs", ...dirs, "--osgo", go, "--osgo", one, "--osgjs", js];
    const cli = (more) => spawnSync(process.execPath, [...args, ...more], {cwd: root, encoding: "utf8"});
    assert.equal(cli(["--out", file, "--json", json]).status, 0);
    assert.equal(readFileSync(file, "utf8"), page);
    assert.deepEqual(JSON.parse(readFileSync(json)), generate(dirs, paths).report);
    assert.equal(cli(["--check", file]).status, 0);
    assert.equal(cli(["--check", join(temp, "absent.md")]).status, 1);
    writeFileSync(file, page.replace("ZCL_KERNEL_BITS: FAILURE", "ZCL_KERNEL_BITS: SUCCESS"));
    const changed = cli(["--check", file]);
    assert.equal(changed.status, 1); assert.match(changed.stderr, /first changed line/);
    const none = generate(dirs, {osgo: [], osgjs: []});
    assert.ok(none.report.constructs.every((r) => r.osgo.status === "no evidence" && r.osgjs.status === "no evidence"));
  });
  it("rejects malformed evidence and duplicate owners", () => {
    const bad = join(temp, "bad.json"); writeFileSync(bad, '{"rows":[{"status":"SUCCESS"}]}');
    const valid = join(root, "tools/testdata-kernel-valid");
    assert.throws(() => generate([valid], {osgo: [bad], osgjs: []}), /invalid run row/);
    const duplicate = join(temp, "duplicate"); cpSync(valid, duplicate, {recursive: true});
    assert.throws(() => generate([valid, duplicate], {osgo: [], osgjs: []}), /duplicate class/);
  });
});
