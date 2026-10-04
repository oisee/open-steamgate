import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {execFileSync, spawnSync} from "node:child_process";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {KERNEL_FORMS, kernelWarnings} from "../tools/osd-kernel-compat.mjs";
import {generate, inventory, evidence} from "../tools/osg-support.mjs";

import {run as buildCommand} from "../tools/osd-build-command.mjs";
import {alertOf} from "../tools/osd-unit.mjs";
import {summarize} from "../tools/osd-unit-ci.mjs";
import {reconcile, killedGoTool, markBuildFailure} from "../tools/gogen/unit-results.mjs";

import {unitProvenance} from "../tools/osd-unit-provenance.mjs";

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
    for (const {anchor, rejectedExample, acceptedExample} of KERNEL_FORMS) {
      assert.equal(anchors.filter((a) => a === anchor).length, 1, anchor);
      const entry = page.split(`<a id="${anchor}"></a>`)[1].split(/<a id=|## Provenance/)[0];
      assert.ok(entry.includes("Rejected by SAP:"), anchor);
      assert.ok(entry.includes("Correct rewrite:"), anchor);
      assert.ok(entry.includes("```abap\n" + rejectedExample + "\n```"), anchor);
      assert.ok(entry.includes("```abap\n" + acceptedExample + "\n```"), anchor);
    }
    const firstSection = page.indexOf("\n## ");
    for (const guide of ["Runs means", "The osgo column", "The VS Code column"]) assert.ok(page.indexOf(guide) < firstSection);
    assert.equal([...page.matchAll(/^## (.+)$/gm)].at(-1)[1], "Provenance");
    for (const detail of ["ABAPiti commit:", "git blob", "Heap setting", "Installed versions"]) {
      assert.ok(page.indexOf(detail) > page.indexOf("## Provenance"), detail);
    }
  });
  it("keeps kernel examples ASCII, diagnoses rejected forms and accepts rewrites as ABAP 7.02", () => {
    const require = createRequire(import.meta.url);
    const core = require("@abaplint/core");
    for (const form of KERNEL_FORMS) for (const kind of ["rejectedExample", "acceptedExample"]) {
      const example = form[kind];
      assert.match(example, /^[\x00-\x7f]+$/);
      const file = "zcl_example.clas.abap";
      const source = `CLASS zcl_example DEFINITION PUBLIC.
PUBLIC SECTION. CLASS-METHODS example. ENDCLASS.
CLASS zcl_example IMPLEMENTATION. METHOD example.
${example}
ENDMETHOD. ENDCLASS.`;
      const warnings = kernelWarnings({file, source});
      assert.equal(warnings.length, kind === "rejectedExample" ? 1 : 0, form.anchor);
      if (warnings.length) assert.ok(warnings[0].supportAnchor.endsWith(form.anchor));
      else {
        const reg = new core.Registry(new core.Config(JSON.stringify({syntax: {version: core.Version.v702}, rules: {}})));
        reg.addFile(new core.MemoryFile(file, source)); reg.parse();
        const issues = Array.from(reg.getObjects()).flatMap((obj) => new core.SyntaxLogic(reg, obj).run().issues);
        assert.deepEqual(issues.map((issue) => issue.getMessage()), [], form.anchor);
      }
    }
  });
  it("counts distinct failing classes per runtime, sorts shares and separates majority passes", () => {
    const dir = join(temp, "shares"); mkdirSync(dir);
    // RETURN: 1/1 fails; DO and CONTINUE: 1/2; ASSERT and CLEAR: 1/3; MOVE: 4/4.
    const bodies = ["RETURN. DO 1 TIMES. CONTINUE. ENDDO. ASSERT 1 = 1. CLEAR value. value = 1.",
      "DO 1 TIMES. CONTINUE. ENDDO. ASSERT 1 = 1. CLEAR value.",
      "ASSERT 1 = 1. CLEAR value.", "value = 1.", "value = 1.", "value = 1."];
    const classes = bodies.map((body, i) => {
      const cls = `ZCL_SHARE${i}`;
      writeFileSync(join(dir, cls.toLowerCase() + ".clas.abap"), `CLASS ${cls} DEFINITION PUBLIC.
PUBLIC SECTION. CLASS-METHODS example. ENDCLASS.
CLASS ${cls} IMPLEMENTATION. METHOD example. DATA value TYPE i.
${body}
ENDMETHOD. ENDCLASS.`);
      return cls;
    });
    const js = join(temp, "shares-js.json"), go = join(temp, "shares-go.json");
    const rows = classes.map((cls, i) => ({class: cls, method: "CHECK", status: [0, 3, 4, 5].includes(i) ? "FAILURE" : "SUCCESS"}));
    rows.push({...rows[0], method: "OTHER", status: "ERROR"});
    writeFileSync(js, JSON.stringify({rows}));
    writeFileSync(go, JSON.stringify({rows: classes.map((cls, i) => ({class: cls, method: "CHECK", status: i === 1 ? "FAILURE" : "SUCCESS"}))}));
    const {markdown, report} = generate([dir], {osgjs: [js], osgo: [go]});
    const fail = markdown.split("## Fails on JS")[1].split("## Fails in some classes")[0];
    const some = markdown.split("## Fails in some classes on JS")[1].split("## Not measured")[0];
    assert.ok(fail.indexOf("statement: Return") < fail.indexOf("statement: Continue"));
    assert.ok(fail.indexOf("statement: Continue") < fail.indexOf("statement: Do"));
    assert.ok(some.includes("statement: Assert") && some.includes("statement: Clear"));
    assert.ok(some.indexOf("statement: Assert") < some.indexOf("statement: Clear"));
    const assertion = markdown.split("\n").find((line) => line.startsWith("| statement: Assert |"));
    assert.match(assertion, /fails in 1 of 3 classes \(ZCL_SHARE0\); passes in 2/);
    assert.match(assertion, /fails in 1 of 3 classes \(ZCL_SHARE1\); passes in 2/);
    const move = markdown.split("\n").find((line) => line.startsWith("| statement: Move |"));
    assert.match(move, /fails in 4 of 4 classes \(ZCL_SHARE0, ZCL_SHARE3, ZCL_SHARE4, …\); passes in 0/);
    assert.ok(!move.includes("ZCL_SHARE5"));
    assert.equal(report.constructs.find((c) => c.name === "Assert").osgjs.failures.length, 2);
    const mixed = evidence(classes, {rows: new Map([[classes[0], [rows[0]]], [classes[1], [rows[1]]],
      [classes[2], [{status: "NOT_COMPILED"}]]])});
    assert.deepEqual(mixed.passingClasses, [classes[1]]);
    assert.equal(mixed.missing.length, 3);
  });
  it("credits helpers only from declared successful full-folder runs and preserves partial results", () => {
    const dir = join(temp, "helpers"); mkdirSync(dir);
    for (const cls of ["pass", "fail", "helper"])
      writeFileSync(join(dir, `zcl_${cls}.clas.abap`), `CLASS zcl_${cls} DEFINITION PUBLIC. ENDCLASS.
CLASS zcl_${cls} IMPLEMENTATION. ENDCLASS.
`);
    for (const cls of ["pass", "fail"]) writeFileSync(join(dir, `zcl_${cls}.clas.testclasses.abap`), "");
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
    assert.match(all.markdown, /## Not measured on JS \([1-9]/);
    assert.match(all.markdown, /## osgo only \(0\)/);
    assert.match(all.markdown, /helpers \/ VS Code \(OSG-JS\): not measured: runner crashed: heap exhausted/);
    assert.equal(all.report.runtime.osgo.classes, 3);
    rows[1] = {...rows[1], status: "FAILURE", message: "expected 2, got 1\nstack trace"};
    writeFileSync(file, JSON.stringify({rows}));
    const partial = generate([dir], paths);
    const result = partial.report.constructs[0].osgo;
    assert.equal(result.status, "fails");
    assert.equal(result.missing.length, 1);
    assert.ok(result.missing.includes("ZCL_HELPER"));
    assert.ok(!result.failures.some((f) => f.class === "ZCL_HELPER"));
    assert.ok(result.failures.some((f) => f.class === "ZCL_FAIL" && f.message === "expected 2, got 1"));
    assert.equal(evidence(["ZCL_PASS"], {rows: new Map([["ZCL_PASS", [rows[0]]]])}).status, "runs");
    // A selected class result alone cannot confer full-folder credit.
    assert.ok(generate([dir], {osgo: [file], osgjs: []}).report.constructs.every((c) => c.osgo.missing.includes("ZCL_HELPER")));
    writeFileSync(file, JSON.stringify({rows: []}));
    assert.ok(generate([dir], paths).report.constructs.every((c) => c.osgo.status === "not measured"));
  });
  it("marks a killed Go toolchain subprocess as unmeasured with captured build stderr", () => {
    const stderr = readFileSync(join(root, "test/fixtures/go-build-killed/stderr.txt"), "utf8");
    const row = {class: "OWNER", status: "READY"};
    markBuildFailure([row], {status: 1, stderr});
    assert.equal(row.source, "harness");
    assert.equal(row.status, "NOT_COMPILED");
    assert.equal(evidence([row.class], {rows: new Map([[row.class, [row]]])}).status, "not measured");
    assert.equal(killedGoTool(stderr.replaceAll("signal: killed", "signal: terminated")), true);
    for (const diagnostic of [
      "owner.clas.abap:42: compile: signal: killed",
      "generated.go:42: compile: signal: killed",
      "owner.clas.abap: /opt/go/pkg/tool/linux_amd64/compile: signal: killed",
      "generated.go: /opt/go/pkg/tool/linux_amd64/compile: signal: killed",
      "example.invalid/pkg: undefined: signal: killed",
      'example.invalid/pkg: /opt/go/pkg/tool/linux_amd64/compile: undefined: "signal: killed"',
    ]) {
      const refused = {class: "OWNER", status: "READY"};
      markBuildFailure([refused], {status: 1, stderr: diagnostic});
      assert.equal(refused.source, undefined, diagnostic);
      assert.equal(evidence([refused.class], {rows: new Map([[refused.class, [refused]]])}).status, "refused");
    }
  });
  it("records the last Node heap override with command-line precedence over NODE_OPTIONS", () => {
    const options = process.env.NODE_OPTIONS, argv = process.execArgv;
    try {
      process.env.NODE_OPTIONS = "--max-old-space-size=1024 --max_old_space_size=2048";
      process.execArgv = [];
      assert.equal(unitProvenance("osgjs").heap, "--max-old-space-size=2048 MiB");
      process.execArgv = ["--max-old-space-size=3072", "--max_old_space_size", "4096"];
      assert.equal(unitProvenance("osgjs").heap, "--max-old-space-size=4096 MiB");
    } finally {
      process.execArgv = argv;
      if (options === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = options;
    }
  });
  it("retains subprocess signal provenance separately from compiler diagnostics", () => {
    assert.throws(() => buildCommand(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], root),
      (error) => error.signal === "SIGTERM" && error.code === "FAILED");
    assert.throws(() => buildCommand(process.execPath, ["-e", "console.error('syntax error'); process.exit(1)"], root),
      (error) => !error.signal && !error.spawnError && error.output.includes("syntax error"));
  });
  it("keeps assertion text beginning runner: as a failure through alertOf and both CI paths", () => {
    class kernel_cx_assert {}
    const error = Object.assign(new kernel_cx_assert(), {
      msg: {get: () => "runner: returned incorrect value"},
      expected: {get: () => "2"}, actual: {get: () => "1"},
    });
    const alert = alertOf(error, "CHECK");
    assert.equal(alert.kind, "failedAssertion");
    const row = {class: "ZCL_ASSERT", testclass: "LTCL_TEST", method: "CHECK", status: "FAILURE",
      message: [alert.title, ...alert.details].join("; ")};
    for (const candidate of [row, {...row, status: "FAILED"}]) {
      const normalized = summarize({rows: [candidate]});
      assert.equal(normalized.code, 1);
      assert.equal(normalized.result.rows[0].status, "FAILURE");
      const result = evidence([row.class], {rows: new Map([[row.class, normalized.result.rows]])});
      assert.equal(result.status, "fails");
      assert.match(result.failures[0].message, /Expected \[2\]; Actual \[1\]/);
    }
    // A process failure retains its identity and is still unmeasured after reconciliation.
    const harness = reconcile([row], [{...row, source: "harness", status: "FAILED", message: "startup crashed"}]);
    const normalized = summarize({rows: harness});
    assert.equal(normalized.code, 2);
    assert.equal(evidence([row.class], {rows: new Map([[row.class, normalized.result.rows]])}).status, "not measured");
    // Compiler refusal text and real test errors cannot manufacture harness provenance.
    for (const message of ["runner died: SIGABRT", "seed image: refused", "FATAL ERROR: heap exhaustion"]) {
      assert.equal(evidence([row.class], {rows: new Map([[row.class, [{...row, message, status: "ERROR"}]]])}).status, "fails");
      assert.equal(evidence([row.class], {rows: new Map([[row.class, [{class: row.class, message, status: "NOT_COMPILED"}]]])}).status, "refused");
    }
  });
  it("marks crashes and setup ERROR JSON as not measured, retaining real test failures", () => {
    const dir = join(root, "tools/testdata-kernel-valid");
    const file = join(temp, "setup.json"), manifest = join(temp, "setup-runs.json");
    const paths = {osgo: [], osgjs: [], runs: [manifest]};
    writeFileSync(manifest, JSON.stringify([{folder: "testdata-kernel-valid", runtime: "osgjs", file: "setup.json",
      wallSeconds: 12.5, peakRssKiB: 1024}]));
    for (const row of [{status: "ERROR", message: "memory access out of bounds"},
      {class: "ZCL_KERNEL_VALID", status: "ERROR", message: "setup failed"},
      {source: "harness", class: "ZCL_KERNEL_VALID", method: "CHECK", status: "ERROR", message: "runner died: SIGABRT"},
      {source: "harness", class: "ZCL_KERNEL_VALID", status: "NOT_COMPILED", message: "node tools/osd-transpile.mjs exited SIGABRT"},
      {source: "harness", class: "ZCL_KERNEL_VALID", status: "NOT_COMPILED", message: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"}]) {
      writeFileSync(file, JSON.stringify({compiled: 0, rows: [row]}));
      const {report, markdown} = generate([dir], paths);
      assert.ok(report.constructs.every((c) => c.osgjs.status === "not measured"));
      assert.ok(report.constructs.every((c) => c.osgjs.failures.length === 0));
      assert.match(markdown, /The JS column is incomplete; remeasurement in progress\./);
      assert.ok(markdown.includes(row.message));
      assert.match(markdown, /12.5 s; peak RSS 1024 KiB/);
      assert.equal(report.runtime.osgjs.tests, 0);
    }
    writeFileSync(file, JSON.stringify({compiled: 1, rows: [{class: "ZCL_KERNEL_VALID", testclass: "LTCL_TEST",
      method: "CHECK", status: "ERROR", message: "ASSERT failed"}]}));
    const failed = generate([dir], paths);
    assert.ok(failed.report.constructs.every((c) => c.osgjs.status === "fails"));
    assert.ok(!failed.markdown.includes("The JS column is incomplete"));
    writeFileSync(file, JSON.stringify({compiled: 1, rows: [{class: "ZCL_KERNEL_VALID", method: "CHECK", status: "SUCCESS"}]}));
    const successful = generate([dir], paths);
    assert.ok(!successful.markdown.includes("The JS column is incomplete"));
    assert.match(successful.markdown, /## JS only \([1-9]/);
    writeFileSync(manifest, JSON.stringify([{folder: "testdata-kernel-valid", runtime: "osgjs",
      reason: "SIGABRT: heap exhaustion; no JSON", wallSeconds: 30, peakRssKiB: 2048}]));
    const crash = generate([dir], paths);
    assert.ok(crash.report.constructs.every((c) => c.osgjs.status === "not measured"));
    assert.match(crash.markdown, /SIGABRT: heap exhaustion; no JSON/);
    assert.match(crash.markdown, /30 s; peak RSS 2048 KiB/);
  });
  it("renders stored backend and tool versions per folder without consulting the rendering environment", () => {
    const dir = join(root, "tools/testdata-kernel-valid");
    const file = join(temp, "provenance.json"), manifest = join(temp, "provenance-runs.json");
    const provenance = {database: "--db file (node:sqlite)", heap: "--max-old-space-size=12288 MiB",
      versions: {"@abaplint/runtime": "2.13.93", "@abaplint/transpiler": "2.13.93", Node: "v26.9.0", "node:sqlite (SQLite)": "3.53.4"}};
    writeFileSync(file, JSON.stringify({provenance, rows: [{class: "ZCL_KERNEL_VALID", method: "CHECK", status: "SUCCESS"}]}));
    writeFileSync(manifest, JSON.stringify([{folder: "testdata-kernel-valid", runtime: "osgjs", file: "provenance.json"},
      {folder: "testdata-kernel-valid", runtime: "osgo", reason: "no JSON", provenance: {...provenance, database: "modernc.org/sqlite", versions: {...provenance.versions, Go: "go1.26.0"}}}]));
    const paths = {osgo: [], osgjs: [], runs: [manifest]};
    const page = generate([dir], paths);
    assert.deepEqual(page.report.folders[0].provenance.osgjs, provenance);
    for (const text of ["--db file (node:sqlite)", "--max-old-space-size=12288 MiB", "@abaplint/runtime 2.13.93", "@abaplint/transpiler 2.13.93", "Node v26.9.0", "node:sqlite (SQLite) 3.53.4", "Go go1.26.0"])
      assert.ok(page.markdown.includes(text), text);
    const previous = process.env.NODE_OPTIONS;
    try {
      process.env.NODE_OPTIONS = "--max-old-space-size=512";
      assert.equal(generate([dir], paths).markdown, page.markdown);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });
  it("does not credit omitted test owners or helpers from real --class output declared full-folder", () => {
    const dir = join(root, "test/fixtures/osg-support-selected");
    const file = join(dir, "osgo-int8x.json"), selected = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(selected.classes, 1);
    assert.equal(selected.rows.length, 6);
    assert.ok(selected.rows.every((r) => r.class === "ZCL_ABAPITI_INT8X" && r.status === "SUCCESS"));
    const input = join(temp, "selected"); cpSync(dir, input, {recursive: true});
    writeFileSync(join(input, "zcl_helper.clas.abap"), `CLASS zcl_helper DEFINITION PUBLIC.
PUBLIC SECTION. CLASS-METHODS check. ENDCLASS.
CLASS zcl_helper IMPLEMENTATION. METHOD check. RETURN. ENDMETHOD. ENDCLASS.
`);
    const manifest = join(temp, "selected-runs.json");
    writeFileSync(manifest, JSON.stringify([{folder: "selected", runtime: "osgo", file}]));
    const {report, markdown} = generate([input], {osgo: [], osgjs: [], runs: [manifest]});
    const omitted = report.constructs.find((c) => c.kind === "type" && c.name === "x LENGTH 2");
    assert.deepEqual(omitted.classes, ["ZCL_ABAPITI_INT8Y"]);
    assert.equal(omitted.osgo.status, "not measured");
    assert.deepEqual(omitted.osgo.missing, ["ZCL_ABAPITI_INT8Y"]);
    const helper = report.constructs.find((c) => c.name === "Return");
    assert.equal(helper.osgo.status, "not measured");
    assert.deepEqual(helper.osgo.missing, ["ZCL_HELPER"]);
    assert.equal(report.runtime.osgo.classes, 1);
    assert.equal(report.runtime.osgo.tests, 6);
    assert.match(markdown, /missing test owners: ZCL_ABAPITI_INT8Y/);
    assert.ok(!markdown.includes("exercised by 6 tests"));
    assert.equal(evidence(["ZCL_ABAPITI_INT8X"], {rows: new Map([["ZCL_ABAPITI_INT8X", selected.rows]])}).status, "runs");
  });
  it("uses generator blob hashes and the external corpus date, with explicit overrides", () => {
    const dir = join(root, "tools/testdata-kernel-valid"), paths = {osgo: [], osgjs: []};
    const defaults = generate([dir], paths).report;
    assert.match(defaults.openSteamgate, /^[a-f0-9]{12}$/);
    assert.deepEqual(defaults.generatorFiles.map(({file}) => file),
      ["tools/osg-support.mjs", "tools/osd-kernel-compat.mjs"]);
    for (const {file, blob} of defaults.generatorFiles)
      assert.equal(blob, execFileSync("git", ["hash-object", "--no-filters", file], {cwd: root, encoding: "utf8"}).trim());
    assert.equal(defaults.date, existsSync(join(root, ".local/abapiti-src"))
      ? execFileSync("git", ["log", "-1", "--format=%cs"], {cwd: join(root, ".local/abapiti-src"), encoding: "utf8"}).trim() : "unavailable");
    const file = join(temp, "explicit.md");
    const args = ["tools/osg-support.mjs", dir, "--osg-rev", "1234567", "--date", "2026-09-30"];
    const cli = (more) => spawnSync(process.execPath, [...args, ...more], {cwd: root, encoding: "utf8"});
    assert.equal(cli(["--out", file]).status, 0);
    assert.equal(readFileSync(file, "utf8"), generate([dir], paths, {"osg-rev": "1234567", date: "2026-09-30"}).markdown);
    assert.equal(cli(["--check", file]).status, 0);
    assert.equal(cli(["--osg-rev", "HEAD"]).status, 2);
    assert.equal(cli(["--date", "2026-02-30"]).status, 2);
  });
  it("produces identical pages at different commits with identical generator content", () => {
    const repo = join(temp, "commits"); mkdirSync(join(repo, "tools"), {recursive: true});
    for (const file of ["osg-support.mjs", "osd-kernel-compat.mjs", "osd-unit-ci.mjs", "osd-main.mjs"])
      cpSync(join(root, "tools", file), join(repo, "tools", file));
    symlinkSync(join(root, "node_modules"), join(repo, "node_modules"), "dir");
    const git = (...args) => execFileSync("git", args, {cwd: repo, encoding: "utf8"});
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    git("add", "tools"); git("commit", "-q", "-m", "First generator commit");
    const first = git("rev-parse", "HEAD");
    const args = [join(repo, "tools/osg-support.mjs"), join(root, "tools/testdata-kernel-valid")];
    const cli = (...more) => spawnSync(process.execPath, [...args, ...more], {cwd: repo, encoding: "utf8"});
    const page = join(repo, "page.md");
    const before = cli("--out", page); assert.equal(before.status, 0, before.stderr);
    git("commit", "-q", "--allow-empty", "-m", "Different commit, same generator");
    assert.notEqual(git("rev-parse", "HEAD"), first);
    const after = cli(); assert.equal(after.status, 0, after.stderr);
    assert.equal(after.stdout, readFileSync(page, "utf8"));
    const check = cli("--check", page); assert.equal(check.status, 0, check.stderr);
    // Content changes must invalidate provenance even without a new commit.
    const scanner = join(repo, "tools/osd-kernel-compat.mjs");
    writeFileSync(scanner, readFileSync(scanner, "utf8") + "\n// Changed scanner content.\n");
    assert.equal(cli("--check", page).status, 1);
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
    const rows = new Map([["A", [{status: "SUCCESS", method: "CHECK"}, {status: "FAILURE", method: "OTHER"}]],
      ["B", [{status: "NOT_COMPILED", message: "unsupported form\nprivate detail"}]],
      ["C", [{status: "SUCCESS"}]], ["D", [{status: "ERROR", method: "CHECK"}]]]);
    assert.equal(evidence(["A", "C"], {rows}).status, "fails");
    assert.equal(evidence(["D"], {rows}).status, "fails");
    assert.deepEqual(evidence(["B"], {rows}).refusals, [{class: "B", message: "unsupported form"}]);
    assert.equal(evidence(["C", "MISSING"], {rows}).status, "not measured");
    assert.equal(evidence(["C"], {rows}).status, "runs");
    assert.equal(evidence(["D"], {rows: new Map([["D", [{status: "FAILURE", message: "no test ran"}]]])}).status, "not measured");
    assert.equal(evidence(["D"], {rows: new Map([["D", [{source: "harness", status: "NOT_COMPILED", message: "node exited SIGABRT"}]]])}).status, "not measured");
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
    const titles = ["Runs on JS (osgo agrees)", "JS only", "osgo only", "Fails on JS", "Fails in some classes on JS", "Not measured on JS"];
    let previous = -1;
    for (const title of titles) {
      const index = markdown.indexOf("## " + title);
      assert.ok(index > previous, title); previous = index;
    }
    assert.match(markdown, /\| Lines \| VS Code \(OSG-JS\) \| osgo \|/);
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
    const refused = join(temp, "js-refused.json");
    writeFileSync(refused, JSON.stringify({rows: [{class: "ZCL_EXTRA", status: "NOT_COMPILED", message: "unsupported form"}]}));
    const paths = {osgo: [go, one], osgjs: [js, refused]};
    const page = generate(dirs, paths).markdown;
    assert.match(page, /## osgo only \([1-9]/);
    assert.equal(generate([...dirs].reverse(), paths).markdown, page);
    const file = join(temp, "page.md"), json = join(temp, "page.json");
    const args = ["tools/osg-support.mjs", ...dirs, "--osgo", go, "--osgo", one, "--osgjs", js, "--osgjs", refused];
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
    assert.ok(none.report.constructs.every((r) => r.osgo.status === "not measured" && r.osgjs.status === "not measured"));
  });
  it("rerenders a recorded inventory through CLI without source folders or runtime runs", () => {
    const original = generate([join(root, "tools/testdata-kernel-valid")], {osgo: [], osgjs: []}).report;
    const saved = structuredClone(original);
    for (const c of saved.constructs) for (const runtime of ["osgjs", "osgo"]) {
      delete c[runtime].failingClasses; delete c[runtime].passingClasses;
    }
    saved.generatorFiles = []; saved.openSteamgate = "old"; saved.knownWarnings = [];
    const recorded = join(temp, "recorded.json"), page = join(temp, "recorded.md"), json = join(temp, "rerendered.json");
    writeFileSync(recorded, JSON.stringify(saved));
    const cli = (...args) => spawnSync(process.execPath, ["tools/osg-support.mjs", "--recorded", recorded, ...args], {cwd: root, encoding: "utf8"});
    const result = cli("--out", page, "--json", json);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(json)), original);
    assert.equal(cli("--check", page).status, 0);
    writeFileSync(page, "stale"); assert.equal(cli("--check", page).status, 1);
    assert.equal(cli("tools/testdata-kernel-valid").status, 2);
    assert.equal(cli("--osgo", "absent.json").status, 2);
    assert.equal(readFileSync(recorded, "utf8"), JSON.stringify(saved));
  });
  it("rejects malformed evidence and duplicate owners", () => {
    const bad = join(temp, "bad.json"); writeFileSync(bad, '{"rows":[{"status":"SUCCESS"}]}');
    const valid = join(root, "tools/testdata-kernel-valid");
    assert.throws(() => generate([valid], {osgo: [bad], osgjs: []}), /invalid run row/);
    const duplicate = join(temp, "duplicate"); cpSync(valid, duplicate, {recursive: true});
    assert.throws(() => generate([valid, duplicate], {osgo: [], osgjs: []}), /duplicate class/);
  });
});
