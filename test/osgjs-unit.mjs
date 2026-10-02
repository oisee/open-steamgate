// Real isolated JS builds. Run with osgo-unit under flock /tmp/osd-heavy.lock.
import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, lstatSync, symlinkSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {metadata} from "../tools/osd-unit-ci.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = (dir, name = "zcl_osgjs_ci", body = "cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).") => {
  writeFileSync(join(dir, `${name}.clas.abap`), `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC. ENDCLASS.\nCLASS ${name} IMPLEMENTATION. ENDCLASS.\n`);
  writeFileSync(join(dir, `${name}.clas.testclasses.abap`), `CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.\n PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS.\nCLASS ltcl_test IMPLEMENTATION. METHOD check. ${body} ENDMETHOD. ENDCLASS.\n`);
};
const fingerprint = (path) => {
  const hash = createHash("sha256");
  const walk = (file) => {
    if (!existsSync(file)) { hash.update("absent"); return; }
    const link = lstatSync(file).isSymbolicLink();
    if (link) hash.update(readlinkSync(file));
    if (statSync(file).isDirectory()) for (const entry of readdirSync(file).sort()) { hash.update(entry); walk(join(file, entry)); }
    else hash.update(readFileSync(file));
  };
  walk(path);
  return hash.digest("hex");
};
const invoke = (dir, args = [], options = {}) => {
  const run = spawnSync(process.execPath, [join(root, "tools/osgjs-unit.mjs"), dir, ...args],
    {cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 8e6, ...options});
  assert.equal(run.error, undefined, run.stderr);
  return run;
};
const parallel = (dir) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [join(root, "tools/osgjs-unit.mjs"), dir, "--json"], {cwd: root});
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  child.on("error", reject);
  child.on("close", (status) => resolveRun({status, stdout, stderr}));
});
const parsed = (run, code = 0) => {
  assert.equal(run.status, code, run.stdout + run.stderr);
  return JSON.parse(run.stdout);
};

describe("osgjs unit CI entry point", function () {
  this.timeout(300000);
  let temp, input, live, output, config, ownedPaths;
  beforeEach(() => {
    temp = mkdtempSync(join(root, ".local/osgjs-ci-test-"));
    input = join(temp, "input"); mkdirSync(input);
    ownedPaths = [];
    // Even a fresh checkout must exercise preservation of existing live bytes.
    for (const path of [join(root, "output"), join(root, "build/live")]) {
      if (existsSync(path)) continue;
      if (path.endsWith("build/live") && !existsSync(join(root, "build"))) {
        mkdirSync(join(root, "build")); ownedPaths.push(join(root, "build"));
      }
      const target = join(temp, "sentinel-" + ownedPaths.length);
      mkdirSync(target);
      writeFileSync(join(target, "generation.mjs"), "export const unchanged = true;\n");
      symlinkSync(target, path, "dir"); ownedPaths.push(path);
    }
    live = fingerprint(join(root, "build/live"));
    output = fingerprint(join(root, "output"));
    config = fingerprint(join(root, "abap_transpile.json"));
  });
  afterEach(() => {
    assert.equal(fingerprint(join(root, "build/live")), live, "live generation unchanged");
    assert.equal(fingerprint(join(root, "output")), output, "output unchanged");
    assert.equal(fingerprint(join(root, "abap_transpile.json")), config);
    assert.equal(readdirSync(join(root, ".local")).some((name) => name.startsWith("osgjs-unit-")), false, "staging cleaned");
    for (const path of ownedPaths.reverse()) {
      if (path === join(root, "build")) { if (!readdirSync(path).length) rmSync(path, {recursive: true}); }
      else rmSync(path);
    }
    rmSync(temp, {recursive: true, force: true});
  });
  it("runs the ABAPiti M1 input: 14 SUCCESS without writing its folder", () => {
    const supplied = join(root, ".local/abapiti");
    const dir = existsSync(supplied) ? supplied : input;
    if (dir === input) for (const name of ["add", "factorial"]) {
      const fixtures = join(root, "test/fixtures/osgjs-unit-m1");
      writeFileSync(join(input, `zcl_abapiti_${name}.clas.abap`), readFileSync(join(fixtures, `${name}.abap`)));
      writeFileSync(join(input, `zcl_abapiti_${name}.clas.testclasses.abap`), readFileSync(join(fixtures, `${name}-testclasses.abap`)));
    }
    const before = fingerprint(dir);
    const result = parsed(invoke(dir, ["--json"]));
    assert.deepEqual(result.totals, {success: 14, failure: 0, not_compiled: 0, error: 0, tests: 14});
    assert.equal(result.classes, 2); assert.equal(result.compiled, 2);
    assert.equal(fingerprint(dir), before);
  });
  it("returns FAILURE and exit 1 for an assertion", () => {
    fixture(input, "zcl_osgjs_ci", "cl_abap_unit_assert=>assert_equals( act = 1 exp = 2 ).");
    const run = invoke(input);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /ZCL_OSGJS_CI\/LTCL_TEST\/CHECK: FAILURE/);
    assert.match(run.stdout, /Expected \[2\].*Actual \[1\]/);
  });
  it("returns ERROR for a dump rather than an assertion failure", () => {
    fixture(input, "zcl_osgjs_ci", "ASSERT 1 = 2.");
    const result = parsed(invoke(input, ["--json"]), 2);
    assert.equal(result.totals.error, 1);
    assert.equal(result.totals.failure, 0);
    assert.equal(result.totals.tests, 1, "the method must execute before dumping");
    assert.equal(result.rows[0].method, "CHECK");
    assert.match(result.rows[0].message, /ASSERT|assertion/i);
  });
  it("carries syntax diagnostics with file:line and exit 2", () => {
    fixture(input, "zcl_osgjs_ci", "DATA x TYPE i. x = .");
    const result = parsed(invoke(input, ["--json"]), 2);
    assert.equal(result.rows[0].status, "NOT_COMPILED");
    assert.match(result.rows[0].message, /zcl_osgjs_ci\.clas\.testclasses\.abap:3/);
  });
  it("rejects 256 characters before any build", () => {
    fixture(input);
    writeFileSync(join(input, "zcl_osgjs_ci.clas.locals_imp.abap"), "*" + "x".repeat(255) + "\n");
    const result = parsed(invoke(input, ["--json"], {env: {...process.env, PATH: ""}}), 2);
    assert.deepEqual(result.rows, [{status: "ERROR", message: "zcl_osgjs_ci.clas.locals_imp.abap:1: line exceeds 255 characters (the kernel refuses it)"}]);
  });
  it("accepts exactly 255 characters, CRLF and caller metadata from another cwd", () => {
    fixture(input);
    const file = join(input, "zcl_osgjs_ci.clas.testclasses.abap");
    writeFileSync(file, "*" + "x".repeat(254) + "\r\n" + readFileSync(file, "utf8"));
    writeFileSync(join(input, "zcl_osgjs_ci.clas.xml"), metadata("ZCL_OSGJS_CI").replace("<FIXPT>X</FIXPT>", "<FIXPT></FIXPT>"));
    const before = fingerprint(input);
    assert.equal(parsed(invoke(input, ["--json"], {cwd: temp})).totals.success, 1);
    assert.equal(fingerprint(input), before);
    assert.equal(existsSync(join(temp, ".local")), false);
  });
  it("returns 3 for empty, nonrecursive and methodless input", () => {
    mkdirSync(join(input, "nested")); fixture(join(input, "nested"));
    assert.equal(parsed(invoke(input, ["--json"]), 3).totals.tests, 0);
    fixture(input); writeFileSync(join(input, "zcl_osgjs_ci.clas.testclasses.abap"), "");
    assert.equal(parsed(invoke(input, ["--json"]), 3).totals.tests, 0);
  });
  it("warns about an override and filters out the unselected failing owner", () => {
    fixture(input, "zcl_stg_phase0_test");
    fixture(input, "zcl_osgjs_fail", "cl_abap_unit_assert=>fail( ).");
    const run = invoke(input, ["--json", "--class", "zcl_stg_phase0_test"]);
    const result = parsed(run);
    assert.equal(result.totals.success, 1);
    assert.match(run.stderr, /Override CLAS ZCL_STG_PHASE0_TEST:/);
    const overrides = result.overrides.filter((o) => o.object === "CLAS ZCL_STG_PHASE0_TEST");
    assert.equal(overrides.length, 1);
    assert.ok(overrides[0].hidden.startsWith(root + "/"));
  });
  it("runs class and instance lifecycle hooks in order and keeps fresh instances", () => {
    fixture(input);
    writeFileSync(join(input, "zcl_osgjs_ci.clas.testclasses.abap"), `CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
 PRIVATE SECTION.
 CLASS-DATA count TYPE i.
 DATA instance_count TYPE i.
 CLASS-METHODS class_setup.
 CLASS-METHODS class_teardown.
 METHODS setup.
 METHODS teardown.
 METHODS one FOR TESTING.
 METHODS two FOR TESTING.
 ENDCLASS.
 CLASS ltcl_test IMPLEMENTATION.
 METHOD class_setup. count = 10. ENDMETHOD.
 METHOD setup. count = count + 1. instance_count = instance_count + 1. ENDMETHOD.
 METHOD one.
 cl_abap_unit_assert=>assert_equals( act = count exp = 11 ).
 cl_abap_unit_assert=>assert_equals( act = instance_count exp = 1 ).
 ENDMETHOD.
 METHOD two.
 cl_abap_unit_assert=>assert_equals( act = count exp = 13 ).
 cl_abap_unit_assert=>assert_equals( act = instance_count exp = 1 ).
 ENDMETHOD.
 METHOD teardown. count = count + 1. ENDMETHOD.
 METHOD class_teardown. cl_abap_unit_assert=>assert_equals( act = count exp = 14 ). ENDMETHOD.
 ENDCLASS.
 `);
    assert.equal(parsed(invoke(input, ["--json"])).totals.success, 2);
  });
  it("counts tests blocked by a class_setup assertion as failures", () => {
    fixture(input);
    const file = join(input, "zcl_osgjs_ci.clas.testclasses.abap");
    writeFileSync(file, readFileSync(file, "utf8")
      .replace("METHODS check", "CLASS-METHODS class_setup. METHODS check")
      .replace("CLASS ltcl_test IMPLEMENTATION.", "CLASS ltcl_test IMPLEMENTATION. METHOD class_setup. cl_abap_unit_assert=>fail( ). ENDMETHOD."));
    const result = parsed(invoke(input, ["--json"]), 1);
    assert.equal(result.totals.failure, 1); assert.equal(result.totals.tests, 1);
    assert.match(result.rows[0].message, /class_setup/);
  });
  it("does not silently lose class_teardown failures", () => {
    fixture(input);
    const file = join(input, "zcl_osgjs_ci.clas.testclasses.abap");
    writeFileSync(file, readFileSync(file, "utf8")
      .replace("METHODS check", "CLASS-METHODS class_teardown. METHODS check")
      .replace("CLASS ltcl_test IMPLEMENTATION.", "CLASS ltcl_test IMPLEMENTATION. METHOD class_teardown. ASSERT 1 = 2. ENDMETHOD."));
    const result = parsed(invoke(input, ["--json"]), 2);
    assert.equal(result.totals.success, 1); assert.equal(result.totals.error, 1);
    assert.match(result.rows.at(-1).message, /class_teardown/);
  });
  it("runs two invocations in parallel without shared build output", async () => {
    fixture(input);
    const before = fingerprint(input);
    const results = await Promise.all([parallel(input), parallel(input)]);
    for (const run of results) assert.equal(parsed(run).totals.success, 1);
    assert.equal(fingerprint(input), before);
  });
  it("returns parseable ERROR JSON on invalid arguments", () => {
    for (const args of [["--class", "MISSING"], ["--class"], ["--unknown"]])
      assert.equal(parsed(invoke(input, ["--json", ...args]), 2).totals.error, 1);
  });
});
