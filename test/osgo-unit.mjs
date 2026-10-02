// Real Go builds; run under flock /tmp/osd-heavy.lock with the gogen checks.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {metadata, summarize} from "../tools/osgo-unit.mjs";
import {unitInputs} from "../tools/gogen/unit-inputs.mjs";
import {compileProgram} from "../tools/gogen/frontend.mjs";

const root = resolve(import.meta.dirname, "..");
const fixture = (dir, name = "zcl_osgo_ci", body = "cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).") => {
  writeFileSync(join(dir, `${name}.clas.abap`), `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC. ENDCLASS.\nCLASS ${name} IMPLEMENTATION. ENDCLASS.\n`);
  writeFileSync(join(dir, `${name}.clas.testclasses.abap`), `CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.\n PRIVATE SECTION. METHODS check FOR TESTING. ENDCLASS.\nCLASS ltcl_test IMPLEMENTATION. METHOD check. ${body} ENDMETHOD. ENDCLASS.\n`);
};
const snapshot = (dir) => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), "utf8")]));
const invoke = (dir, args = [], script = "tools/osgo-unit.mjs") => {
  const run = spawnSync(process.execPath, [script, ...(script.startsWith("bin/") ? ["unit", "--go"] : []), dir, ...args],
    {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 5e6});
  assert.equal(run.error, undefined, run.stderr);
  return run;
};

describe("osgo unit CI entry point", function () {
  this.timeout(240000);
  let temp, input, config;
  beforeEach(() => {
    mkdirSync(join(root, ".local"), {recursive: true});
    temp = mkdtempSync(join(root, ".local", "osgo-ci-test-"));
    input = join(temp, "input"); mkdirSync(input);
    config = readFileSync(join(root, "abap_transpile.json"), "utf8");
  });
  afterEach(() => {
    assert.equal(readFileSync(join(root, "abap_transpile.json"), "utf8"), config);
    assert.equal(readdirSync(join(root, ".local")).some((name) => name.startsWith("osgo-unit-")), false, "staging cleaned");
    rmSync(temp, {recursive: true, force: true});
  });
  it("passes without XML, emits totals, and leaves the caller's folder unchanged", () => {
    fixture(input);
    const before = snapshot(input);
    const run = invoke(input, ["--json"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = JSON.parse(run.stdout);
    assert.deepEqual(result.totals, {success: 1, failure: 0, not_compiled: 0, error: 0, tests: 1});
    assert.equal(result.classes, 1); assert.equal(result.compiled, 1);
    assert.equal(result.rows[0].status, "SUCCESS");
    assert.deepEqual(snapshot(input), before);
    assert.equal(existsSync(resolve(result.buildDir)), false, "generated Go tree cleaned");
  });
  it("returns 1 and a human method line on a failing assertion", () => {
    fixture(input, "zcl_osgo_ci", "cl_abap_unit_assert=>assert_equals( act = 1 exp = 2 ).");
    const run = invoke(input);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /ZCL_OSGO_CI\/LTCL_TEST\/CHECK: FAILURE/);
    assert.match(run.stdout, /Tests: 1, SUCCESS: 0, FAILURE: 1, NOT_COMPILED: 0, ERROR: 0/);
  });
  it("returns 2 for a construct gogen refuses", () => {
    fixture(input, "zcl_osgo_ci", "CALL TRANSACTION 'DUMMY'.");
    const run = invoke(input, ["--json"]);
    assert.equal(run.status, 2, run.stdout + run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.totals.not_compiled, 1);
    assert.equal(result.totals.tests, 1);
  });
  it("returns 3 on empty or nonrecursive input", () => {
    mkdirSync(join(input, "nested")); fixture(join(input, "nested"));
    const run = invoke(input, ["--json"]);
    assert.equal(run.status, 3, run.stdout + run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).totals, {success: 0, failure: 0, not_compiled: 0, error: 0, tests: 0});
  });
  it("returns 3 when an owner has a test include but no test methods", () => {
    fixture(input);
    writeFileSync(join(input, "zcl_osgo_ci.clas.testclasses.abap"), "");
    const run = invoke(input, ["--json"]);
    assert.equal(run.status, 3, run.stdout + run.stderr);
    assert.equal(JSON.parse(run.stdout).totals.tests, 0);
  });
  it("preserves existing XML bytes and uses its metadata", () => {
    fixture(input);
    const xml = metadata("ZCL_OSGO_CI").replace("<DESCRIPT>ZCL_OSGO_CI</DESCRIPT>", "<DESCRIPT>Caller metadata</DESCRIPT>");
    writeFileSync(join(input, "zcl_osgo_ci.clas.xml"), xml);
    const before = snapshot(input);
    const run = invoke(input, ["--json", "--jobs", "1"]);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(snapshot(input), before);
    const program = compileProgram({folders: [input], objects: ["ZCL_OSGO_CI"]});
    assert.equal(program.reg.getObject("CLAS", "ZCL_OSGO_CI").getDescription(), "Caller metadata");
  });
  it("filters multiple names through the checkout's osd host", () => {
    fixture(input, "zcl_osgo_one"); fixture(input, "zcl_osgo_two");
    fixture(input, "zcl_osgo_fail", "cl_abap_unit_assert=>fail( ).");
    const run = invoke(input, ["--json", "--jobs", "2", "--class", "ZCL_OSGO_ONE", "ZCL_OSGO_TWO"], "bin/osd.mjs");
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.totals.success, 2); assert.equal(result.totals.tests, 2); assert.equal(result.classes, 2);
  });
  it("adds --input after checkout layers and hides the complete earlier object", () => {
    const base = join(temp, "base"), overlay = join(temp, "overlay"); mkdirSync(base); mkdirSync(overlay);
    fixture(base); fixture(overlay);
    writeFileSync(join(base, "zcl_osgo_ci.clas.xml"), metadata("ZCL_OSGO_CI"));
    writeFileSync(join(base, "zcl_osgo_ci.clas.locals_def.abap"), "earlier include");
    const {skip, sources, folders} = unitInputs({home: temp, config: {input_folder: ["base"]}, extraInputs: [overlay]});
    assert.equal(folders.at(-1), overlay);
    for (const file of readdirSync(base)) assert.equal(skip(join(base, file)), true);
    assert.deepEqual(sources, [join(overlay, "zcl_osgo_ci.clas.testclasses.abap")]);
    // Exercise the actual option by replacing a checkout owner and its test include.
    fixture(overlay, "zcl_osd_statics_test");
    const run = spawnSync(process.execPath, ["tools/gogen/unit.mjs", "--fixture", "test/fixtures/unit-statics", "--input", overlay,
      "--class", "ZCL_OSD_STATICS_TEST", "--jobs", "1", "--no-cache", "--out", join(temp, "out")],
    {cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 5e6});
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.deepEqual(JSON.parse(run.stdout).rows.map((row) => row.status), ["SUCCESS"]);
  });
  it("classifies infrastructure, skipped methods, and mixed outcomes conservatively", () => {
    for (const row of [{status: "FAILED", message: "runner: crashed", method: "CHECK"}, {status: "SKIPPED", method: "CHECK"}]) {
      const result = summarize({rows: [row]}); assert.equal(result.code, 2); assert.equal(result.result.totals.error, 1);
    }
    assert.equal(summarize({rows: [{status: "FAILED", method: "ONE"}, {status: "NOT_COMPILED", method: "TWO"}]}).code, 2);
  });
  it("returns parseable ERROR JSON on invalid arguments", () => {
    for (const args of [["--jobs", "0"], ["--class", "MISSING"], ["--unknown"]]) {
      const run = invoke(input, ["--json", ...args]); assert.equal(run.status, 2);
      assert.equal(JSON.parse(run.stdout).totals.error, 1);
    }
  });
});
