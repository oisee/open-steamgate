// Real isolated JS builds. Run with osgo-unit through tools/osd-heavy.sh.
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
  const {execArgv = [], ...spawnOptions} = options;
  const run = spawnSync(process.execPath, [...execArgv, join(root, "tools/osgjs-unit.mjs"), dir, ...args],
    {cwd: root, encoding: "utf8", timeout: 240000, maxBuffer: 8e6, ...spawnOptions});
  assert.equal(run.error, undefined, run.stderr);
  return run;
};
const parallel = (dir, args = []) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [join(root, "tools/osgjs-unit.mjs"), dir, "--json", ...args], {cwd: root});
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
  let temp, input, live, output, config, ownedPaths, started;
  before(() => { started = performance.now(); });
  after(() => { console.error(`osgjs suite wall time: ${((performance.now() - started) / 1000).toFixed(2)}s`); });
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
    // Extra corpus folders alone are not the two M1 owner/test pairs.
    const hasM1 = ["add", "factorial"].every((name) => ["abap", "testclasses.abap"]
      .every((suffix) => existsSync(join(supplied, `zcl_abapiti_${name}.clas.${suffix}`))));
    const dir = hasM1 ? supplied : input;
    if (dir === input) for (const name of ["add", "factorial"]) {
      const fixtures = join(root, "test/fixtures/osgjs-unit-m1");
      writeFileSync(join(input, `zcl_abapiti_${name}.clas.abap`), readFileSync(join(fixtures, `${name}.abap`)));
      writeFileSync(join(input, `zcl_abapiti_${name}.clas.testclasses.abap`), readFileSync(join(fixtures, `${name}-testclasses.abap`)));
    }
    const before = fingerprint(dir);
    const pack = join(temp, "packs/unfetched");
    mkdirSync(pack, {recursive: true});
    writeFileSync(join(pack, "osd-pack.json"), JSON.stringify({name: "unfetched", sources: [{folder: "upstream", repo: "https://example.invalid/fixture.git"}]}));
    assert.equal(existsSync(join(pack, "upstream")), false);
    // Its overlay must be ignored too, rather than flattened into checkout layers.
    mkdirSync(join(pack, "src"));
    fixture(join(pack, "src"), "zcl_osgjs_pack", "DATA x TYPE i. x = .");
    writeFileSync(join(pack, "src/zcl_osgjs_pack.clas.xml"), metadata("ZCL_OSGJS_PACK"));
    const heapFile = join(temp, "child-heap.json"), preload = join(temp, "heap-probe.mjs");
    writeFileSync(preload, `import {writeFileSync} from 'node:fs';
import {getHeapStatistics} from 'node:v8';
if (process.argv[1]?.endsWith('/osgjs-unit-run.mjs')) writeFileSync(${JSON.stringify(heapFile)}, JSON.stringify(getHeapStatistics().heap_size_limit));
`);
    const result = parsed(invoke(dir, ["--json", "--db", "file"], {execArgv: ["--max-old-space-size=4096", "--max-old-space-size=5120", "--import", preload], env: {...process.env, NODE_OPTIONS: "--max-old-space-size=2048 --max-old-space-size=3072", OSD_PACKS: join(temp, "packs")}}));
    assert.deepEqual(result.totals, {success: 14, failure: 0, not_compiled: 0, error: 0, tests: 14});
    assert.equal(result.classes, 2); assert.equal(result.compiled, 2);
    assert.equal(result.provenance.database, "--db file (node:sqlite)");
    assert.equal(result.provenance.heap, "--max-old-space-size=5120 MiB");
    const reference = spawnSync(process.execPath, ["--max-old-space-size=5120", "-e", "console.log(require('node:v8').getHeapStatistics().heap_size_limit)"], {encoding: "utf8"});
    assert.equal(reference.status, 0, reference.stderr);
    assert.equal(JSON.parse(readFileSync(heapFile, "utf8")), Number(reference.stdout), "measurement child uses the recorded heap override");
    assert.equal(result.provenance.versions.Node, process.version);
    assert.equal(result.provenance.versions["node:sqlite (SQLite)"], process.versions.sqlite);
    assert.equal(fingerprint(dir), before);
  });
  it("rejects 256 characters before any build", () => {
    fixture(input);
    writeFileSync(join(input, "zcl_osgjs_ci.clas.locals_imp.abap"), "*" + "x".repeat(255) + "\n");
    const result = parsed(invoke(input, ["--json"], {env: {...process.env, PATH: ""}}), 2);
    assert.deepEqual(result.rows, [{status: "ERROR", message: "zcl_osgjs_ci.clas.locals_imp.abap:1: line exceeds 255 characters (the kernel refuses it)"}]);
  });
  it("returns 3 for empty, nonrecursive and methodless input", () => {
    mkdirSync(join(input, "nested")); fixture(join(input, "nested"));
    assert.equal(parsed(invoke(input, ["--json"], {env: {...process.env, PATH: ""}}), 3).totals.tests, 0);
    fixture(input); writeFileSync(join(input, "zcl_osgjs_ci.clas.testclasses.abap"), "");
    assert.equal(parsed(invoke(input, ["--json"]), 3).totals.tests, 0);
  });
  it("shares one file-backed build for success, failure, dumps, line boundary and lifecycle cases", () => {
    fixture(input, "zcl_osgjs_ci", `cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).
WRITE '@KERNEL if (!abap.context.databaseConnections.DEFAULT.path?.endsWith("unit.sqlite")) throw new Error("expected private SQLite file");'.
WRITE '@KERNEL if (!process.env.NODE_OPTIONS.includes("5120")) throw new Error("heap option lost");'.`);
    const file = join(input, "zcl_osgjs_ci.clas.testclasses.abap");
    writeFileSync(file, "*" + "x".repeat(254) + "\r\n" + readFileSync(file, "utf8"));
    writeFileSync(join(input, "zcl_osgjs_ci.clas.xml"), metadata("ZCL_OSGJS_CI").replace("<FIXPT>X</FIXPT>", "<FIXPT></FIXPT>"));
    fixture(input, "zcl_osgjs_fail", "cl_abap_unit_assert=>assert_equals( act = 1 exp = 2 ).");
    fixture(input, "zcl_osgjs_dump", "ASSERT 1 = 2.");
    fixture(input, "zcl_osgjs_lifecycle");
    writeFileSync(join(input, "zcl_osgjs_lifecycle.clas.testclasses.abap"), `CLASS ltcl_test DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
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
    for (const [name, hook, body] of [
      ["zcl_osgjs_setup", "class_setup", "cl_abap_unit_assert=>fail( )."],
      ["zcl_osgjs_teardown", "class_teardown", "ASSERT 1 = 2."],
    ]) {
      fixture(input, name);
      const path = join(input, `${name}.clas.testclasses.abap`);
      writeFileSync(path, readFileSync(path, "utf8")
        .replace("METHODS check", `CLASS-METHODS ${hook}. METHODS check`)
        .replace("CLASS ltcl_test IMPLEMENTATION.", `CLASS ltcl_test IMPLEMENTATION. METHOD ${hook}. ${body} ENDMETHOD.`));
    }
    const before = fingerprint(input);
    const foreign = join(temp, "must-not-open.sqlite");
    const result = parsed(invoke(input, ["--json", "--db", "file"], {cwd: temp,
      env: {...process.env, NODE_OPTIONS: "--max-old-space-size=5120", STG_DB_PATH: foreign}}), 2);
    assert.equal(existsSync(foreign), false, "inherited database path never opened");
    assert.deepEqual(result.totals, {success: 4, failure: 2, not_compiled: 0, error: 2, tests: 7});
    const rows = (name) => result.rows.filter((row) => row.class === name);
    assert.equal(rows("ZCL_OSGJS_CI")[0].status, "SUCCESS");
    assert.equal(rows("ZCL_OSGJS_FAIL")[0].status, "FAILURE");
    assert.match(rows("ZCL_OSGJS_FAIL")[0].message, /Expected \[2\].*Actual \[1\]/);
    assert.equal(rows("ZCL_OSGJS_DUMP")[0].status, "ERROR");
    assert.equal(rows("ZCL_OSGJS_DUMP")[0].method, "CHECK");
    assert.match(rows("ZCL_OSGJS_DUMP")[0].message, /ASSERT|assertion/i);
    assert.equal(rows("ZCL_OSGJS_LIFECYCLE").filter((row) => row.status === "SUCCESS").length, 2);
    assert.match(rows("ZCL_OSGJS_SETUP")[0].message, /class_setup/);
    assert.equal(rows("ZCL_OSGJS_SETUP")[0].status, "FAILURE");
    assert.equal(rows("ZCL_OSGJS_TEARDOWN")[0].status, "SUCCESS");
    assert.equal(rows("ZCL_OSGJS_TEARDOWN")[1].status, "ERROR");
    assert.match(rows("ZCL_OSGJS_TEARDOWN")[1].message, /class_teardown/);
    assert.equal(fingerprint(input), before);
    assert.equal(existsSync(join(temp, ".local")), false);
  });
  it("carries syntax diagnostics with file:line and exit 2 before building", () => {
    fixture(input, "zcl_osgjs_ci", "DATA x TYPE i. x = .");
    const result = parsed(invoke(input, ["--json"]), 2);
    assert.equal(result.rows[0].status, "NOT_COMPILED");
    assert.match(result.rows[0].message, /zcl_osgjs_ci\.clas\.testclasses\.abap:3/);
  });
  it("runs two filtered invocations in parallel and warns about checkout overrides", async () => {
    fixture(input);
    fixture(input, "zcl_stg_phase0_test");
    fixture(input, "zcl_osgjs_fail", "cl_abap_unit_assert=>assert_equals( act = 1 exp = 2 ).");
    const before = fingerprint(input);
    const results = await Promise.all([
      parallel(input, ["--class", "zcl_osgjs_fail"]),
      parallel(input, ["--class", "zcl_stg_phase0_test"]),
    ]);
    const failed = parsed(results[0], 1);
    assert.equal(failed.totals.failure, 1);
    assert.match(failed.rows[0].message, /Expected \[2\].*Actual \[1\]/);
    for (const run of results.slice(1)) {
      const result = parsed(run);
      assert.equal(result.totals.success, 1);
      assert.match(run.stderr, /Override CLAS ZCL_STG_PHASE0_TEST:/);
      const overrides = result.overrides.filter((o) => o.object === "CLAS ZCL_STG_PHASE0_TEST");
      assert.equal(overrides.length, 1);
      assert.ok(overrides[0].hidden.startsWith(root + "/"));
    }
    assert.equal(fingerprint(input), before);
  });
  it("returns parseable ERROR JSON on invalid arguments", () => {
    for (const args of [["--class", "MISSING"], ["--class"], ["--unknown"], ["--db", "invalid"], ["--db"]])
      assert.equal(parsed(invoke(input, ["--json", ...args]), 2).totals.error, 1);
  });
});
