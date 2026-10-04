import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {compareFailures, compareDrift, identityDigest} from "../tools/osd-kernel-check.mjs";
import {fingerprint, verifyCorpus, pin} from "../tools/osd-kernel-corpus.mjs";
import {render} from "../tools/osg-support.mjs";
import {regenerateEvidence, publicFolders, unmeasuredInputs} from "../tools/osd-kernel-conformance.mjs";

const root = resolve(import.meta.dirname, "..");
const row = {class: "ZCL_TEST", testclass: "LTCL_TEST", method: "EDGE", status: "FAILURE"};
const known = {...row, reason: "upstream byte conversion", upstream: "https://github.com/abaplint/transpiler/pull/1964"};
const result = (rows) => ({rows, totals: {tests: rows.length, success: rows.filter((r) => r.status === "SUCCESS").length,
  failure: rows.filter((r) => r.status === "FAILURE").length, error: rows.filter((r) => r.status === "ERROR").length, not_compiled: 0}});

describe("kernel conformance gate", function () {
  this.timeout(15000);
  let temp;
  before(() => { mkdirSync(join(root, ".local"), {recursive: true}); temp = mkdtempSync(join(root, ".local/kernel-check-")); });
  after(() => rmSync(temp, {recursive: true, force: true}));
  it("unchanged known failures pass, with matching count and runner exit", () => {
    assert.deepEqual(compareFailures(result([row]), [known], {tests: 1, exitCode: 1}), []);
  });
  it("a synthetic new failure makes the actual checker process red", () => {
    const file = join(temp, "result.json"), list = join(temp, "known.json");
    writeFileSync(file, JSON.stringify(result([row, {...row, method: "NEW"}])));
    writeFileSync(list, JSON.stringify({entries: [{...known, runtime: "osgjs", folder: "int8"}]}));
    const child = spawnSync(process.execPath, ["tools/osd-kernel-check.mjs", "--result", file, "--known", list, "--runtime", "osgjs", "--folder", "int8", "--tests", "2"], {cwd: root, encoding: "utf8"});
    assert.equal(child.status, 1); assert.match(child.stderr, /new failure: ZCL_TEST\/LTCL_TEST\/NEW/);
  });
  it("a fixed known failure is flagged for removal", () => {
    assert.match(compareFailures(result([{...row, status: "SUCCESS"}]), [known]).join("\n"), /known failure fixed: ZCL_TEST\/LTCL_TEST\/EDGE; remove this entry from \.github\/ci\/kernel-known-failures\.json/);
    assert.match(compareFailures(result([{...row, status: "SUCCESS"}]), [known], {knownFile: "allowances.json"}).join("\n"), /remove this entry from allowances\.json/);
    assert.match(compareFailures(result([{...row, method: "OTHER", status: "SUCCESS"}]), [known]).join("\n"), /known failure missing.*restore the pinned test input/);
  });
  it("rejects missing, duplicate, setup and changed-status results", () => {
    assert.match(compareFailures(result([]), [known]).join("\n"), /missing test rows/);
    assert.match(compareFailures(result([row, row]), [known]).join("\n"), /duplicate test/);
    assert.match(compareFailures(result([{source: "harness", status: "ERROR"}]), [known]).join("\n"), /missing test identity/);
    assert.match(compareFailures(result([{...row, status: "ERROR"}]), [known]).join("\n"), /changed status/);
    assert.match(compareFailures(result([row]), [known], {tests: 2, exitCode: 0}).join("\n"), /test count[\s\S]*runner exit/);
  });
  it("rejects malformed totals and an unreasoned allowance", () => {
    assert.match(compareFailures({...result([row]), totals: {tests: 7}}, [{...known, reason: ""}]).join("\n"), /invalid known failure[\s\S]*invalid totals/);
  });
  it("identities detect replacement of a passing test even with the same count", () => {
    assert.notEqual(identityDigest([row]), identityDigest([{...row, method: "OTHER"}]));
    assert.equal(identityDigest([row, {...row, method: "OTHER"}]), identityDigest([{...row, method: "OTHER"}, row]));
  });
  it("hash-checks cache hits and refuses missing/unpinned auxiliary fixtures", () => {
    assert.deepEqual(publicFolders, ["TestOSD_EmitUnitClasses", "int8"]);
    assert.equal(unmeasuredInputs.length, 2);
    for (const line of unmeasuredInputs) assert.match(line, /not measured in CI: no public pinned source \(local copies only; see docs\/ci-tests\.md\)/);
    const folder = join(temp, "int8"); mkdirSync(folder);
    writeFileSync(join(folder, "a.abap"), "public fixture");
    const manifest = {abapiti: pin(), folders: {int8: fingerprint(folder)}};
    verifyCorpus(temp, manifest, ["int8"]);
    writeFileSync(join(folder, "a.clas.xml"), "unexpected XML");
    assert.throws(() => verifyCorpus(temp, manifest, ["int8"]), /content differs/);
    rmSync(join(folder, "a.clas.xml"));
    writeFileSync(join(folder, "b.abap"), "unexpected fixture");
    assert.throws(() => verifyCorpus(temp, manifest, ["int8"]), /content differs/);
    assert.throws(() => verifyCorpus(temp, manifest, ["mono"]), /missing pinned fixture/);
    assert.throws(() => verifyCorpus(temp, {...manifest, abapiti: "0".repeat(40)}, []), /pin differ/);
  });

  const key = "conversion: int8 → x LENGTH 4";
  const inventory = {abapiti: pin(), folders: {
    int8: {constructs: [{key, count: 1, lines: 1, classes: ["ZCL_TEST"]}]},
    qjs: {constructs: [{key, count: 2, lines: 2, classes: ["ZCL_HELPER"]}]},
  }};
  const report = {abapiti: pin(), folders: [{name: "int8", evidence: {osgjs: "full run"}}], constructs: [{kind: "conversion", name: "int8 → x LENGTH 4", count: 1, lines: 1, classes: ["ZCL_TEST"],
    osgjs: {status: "fails", failingClasses: ["ZCL_TEST"], passingClasses: [], missing: [], refusals: []}}]};
  const page = `ABAPiti commit: ${pin()}.\n| ${key} | 3 | 2 | 3 | fails in 1 of 2 classes (ZCL_TEST); passes in 1 | runs |\n`;
  it("unchanged support claims agree with a measured subset", () => {
    assert.deepEqual(compareDrift(report, page, inventory), []);
    const extra = structuredClone(inventory);
    extra.folders.qjs.constructs.push({key: "type: unmeasured", count: 1, lines: 1, classes: ["ZCL_HELPER"]});
    assert.deepEqual(compareDrift(report, page + "| type: unmeasured | 999 | 1 | 1 | not measured | not measured |\n", extra), []);
    assert.deepEqual(compareDrift(report, page.replace("| runs |", "| not measured |"), extra), []);
    const passing = structuredClone(report);
    Object.assign(passing.constructs[0].osgjs, {status: "runs", failingClasses: [], passingClasses: ["ZCL_TEST"]});
    assert.deepEqual(compareDrift(passing, page.replace("(ZCL_TEST)", "(ZCL_HELPER)"), inventory), []);
  });
  it("support drift names the construct, including inventory count changes", () => {
    assert.match(compareDrift(report, page.replace("fails in 1 of 2 classes (ZCL_TEST); passes in 1", "runs"), inventory).join("\n"), /conversion: int8 → x LENGTH 4: osgjs disagrees/);
    assert.match(compareDrift(report, page.replace("| 3 | 2 | 3 |", "| 4 | 2 | 3 |"), inventory).join("\n"), /support inventory counts differ/);
    assert.match(compareDrift(report, page.replace(key, "type: i"), inventory).join("\n"), /missing from support page/);
    assert.match(compareDrift(report, page.replace("of 2 classes", "of 999 classes"), inventory).join("\n"), /conversion: int8 → x LENGTH 4: osgjs: inconsistent class counts/);
    assert.match(compareDrift(report, page.replace("passes in 1", "passes in 998"), inventory).join("\n"), /inconsistent class counts/);
  });
  it("refuses pin drift, missing evidence and measured inventory drift", () => {
    assert.match(compareDrift({...report, abapiti: "0".repeat(40)}, page, inventory).join("\n"), /pin differs/);
    const changed = structuredClone(report); changed.constructs[0].osgjs.missing = ["ZCL_TEST"];
    assert.match(compareDrift(changed, page, inventory).join("\n"), /disagrees/);
    changed.constructs[0].count++;
    assert.match(compareDrift(changed, page, inventory).join("\n"), /measured inventory differs/);
  });
  it("tracked inventory preserves the page counts while empty measured evidence cannot pass", () => {
    const stored = JSON.parse(readFileSync(join(root, ".github/ci/kernel-inventory.json"), "utf8"));
    assert.deepEqual(compareDrift({abapiti: pin(), folders: [], constructs: []}, readFileSync(join(root, "docs/osg-support.md"), "utf8"), stored), ["no measured support evidence"]);
  });
  it("the rendered support artifact carries the verified pin even without the source checkout", () => {
    const minimal = {abapiti: pin(), folders: [], constructs: [], runtime: {}, generatorFiles: [], knownWarnings: [], warnings: []};
    assert.match(render(minimal), new RegExp(`ABAPiti commit: ${pin()}\\.`));
  });
  it("regenerates fresh evidence from the same run manifest the job writes", () => {
    const dir = join(temp, "small"); mkdirSync(dir);
    writeFileSync(join(dir, "zcl_test.clas.abap"), "CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.");
    writeFileSync(join(dir, "zcl_test.clas.testclasses.abap"), "CLASS ltcl_test DEFINITION FOR TESTING. PRIVATE SECTION. METHODS edge FOR TESTING. ENDCLASS. CLASS ltcl_test IMPLEMENTATION. METHOD edge. ASSERT 1 = 1. ENDMETHOD. ENDCLASS.");
    writeFileSync(join(temp, "small.json"), JSON.stringify(result([{...row, status: "SUCCESS"}])));
    const report = regenerateEvidence(temp, [{folder: "small", runtime: "osgjs", file: "small.json", wallSeconds: 1}], temp, pin());
    assert.equal(report.runtime.osgjs.tests, 1);
    assert.equal(report.folders[0].evidence.osgjs, "all 1 tests SUCCESS");
    assert.match(readFileSync(join(temp, "support.md"), "utf8"), new RegExp(`ABAPiti commit: ${pin()}\\.`));
    assert.doesNotMatch(readFileSync(join(temp, "support.md"), "utf8"), /undefined KiB/);
  });
});
