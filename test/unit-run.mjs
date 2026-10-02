import {expect} from "chai";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {testClassesIn, reported, missing, runCaptured, exitCodeOf} from "../tools/osd-unit-run.mjs";
import {harnessEntries, invalidEntries, runAll} from "../tools/osd-unit-all.mjs";

// **`npm run unit` printed OK whether it executed 156 test classes or none.**
//
// The report that prompted this was wrong and the correction is worth more
// than the report: eight tests said to have printed `OK` without running had
// run all along, and the first reading of them was `npm run unit 2>&1 |
// tail -15` over a seventeen-line file. **A log truncated by the command
// that produced it is indistinguishable from a log of something that never
// happened** (osg-osd-i7, who paid for that twice in one day).
//
// What survives the correction, and why this is still here:
//
//   its first run found a real one -- ZCL_EDITOR, which genuinely never
//   executes -- and named why;
//
//   and `OK` still meant "nothing failed" rather than "something passed".
//   "Nothing ran" is the third value of a test run's verdict, the way "not
//   measured" is the third value everywhere else in this tree.
describe("a unit run can say it ran nothing", () => {
  it("inventories pack and user test classes through the shared input order", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-unit-layers-"));
    try {
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: "src"}));
      const put = (folder, name) => {
        mkdirSync(join(root, folder), {recursive: true});
        writeFileSync(join(root, folder, `${name}.clas.abap`), "class source");
        writeFileSync(join(root, folder, `${name}.clas.testclasses.abap`), "test source");
      };
      put("src", "zcl_own");
      put("packs/example/src", "zcl_pack");
      writeFileSync(join(root, "packs/example/osd-pack.json"), "{}");
      put("user", "zcl_user");
      expect(testClassesIn(root, {OSD_LAYERS: "user"})).to.deep.equal(["ZCL_OWN", "ZCL_PACK", "ZCL_USER"]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
  it("counts an include only when it belongs to the winning class copy", () => {
    const root = mkdtempSync(join(tmpdir(), "osd-unit-winner-"));
    try {
      writeFileSync(join(root, "abap_transpile.json"), JSON.stringify({input_folder: ["src", "gen"]}));
      for (const folder of ["src", "gen", "user"]) mkdirSync(join(root, folder), {recursive: true});
      const put = (folder, name, include) => {
        writeFileSync(join(root, folder, `${name}.clas.abap`), "class source");
        if (include) writeFileSync(join(root, folder, `${name}.clas.testclasses.abap`), "test source");
      };
      put("src", "zcl_removed", true);
      put("gen", "zcl_removed", false);
      put("src", "zcl_added", false);
      put("user", "zcl_added", true);
      put("src", "zcl_hidden", true);
      put("user", "zcl_hidden", false);
      expect(testClassesIn(root, {OSD_LAYERS: "user"})).to.deep.equal(["ZCL_ADDED"]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
  it("counts the test classes from the FILES, not from a generated index", () => {
    const inTree = testClassesIn();
    expect(inTree, "the tree has test classes").to.have.length.greaterThan(5);
    expect(inTree).to.contain("ZCL_STG_SEGW_TEST");
  });

  it("and leaves out what the BUILD leaves out, using the build's own list", () => {
    // the first run of this check named ZCL_EDITOR -- a fixture under
    // test/fixtures/, excluded by `exclude_filter`, with an empty test class
    // that exists so the ADT editor tests have something to read. A check
    // that did not know that would have cried wolf on its first run, and a
    // check that cries wolf stops being read.
    expect(testClassesIn(), "one source of truth for what the build skips").to.not.contain("ZCL_EDITOR");
  });

  it("reads the names the runtime reported, and only those", () => {
    const ran = reported([
      "ZCL_STG_SEGW_TEST: running ltcl_crud",
      "ZCL_STG_SEGW_TEST: running ltcl_tree",
      "ZCL_OSD_LUW_TEST: running ltcl_luw",
      "something else entirely",
      "ZCL_ZOSD_TEST_DEMO: running ltcl_x, skipped due to configuration",
    ].join("\n"));
    expect(ran).to.deep.equal(["ZCL_OSD_LUW_TEST", "ZCL_STG_SEGW_TEST", "ZCL_ZOSD_TEST_DEMO"]);
  });

  // The half that matters: it has to be able to go red.
  it("names a class that is in the tree and never ran", () => {
    const never = missing(["ZCL_A", "ZCL_B", "ZCL_C"], ["ZCL_A", "ZCL_C"]);
    expect(never, "a run that executes nothing must not print OK").to.deep.equal(["ZCL_B"]);
  });

  it("and is silent when every one of them ran", () => {
    expect(missing(["ZCL_A", "ZCL_B"], ["ZCL_B", "ZCL_A", "ZCL_FROM_A_LIBRARY"])).to.deep.equal([]);
  });

  it("a test include with no class beside it is named as such rather than counted as fine", () => {
    // an include without its class is not an object at all, and saying so
    // where it is cheap beats wondering about it later
    const flagged = testClassesIn().filter((n) => n.includes("no .clas.abap"));
    expect(flagged, `these have a testclasses include and no class: ${flagged.join(", ")}`).to.deep.equal([]);
  });
});

// The generated harness ends the process at the first failing assertion, so
// one red class hid every class after it (ZCL_OSD_DEMO_TAXI, 2026-10-02).
describe("a unit run goes on past a failure", () => {
  const harness = [
    "function getData() {",
    "  const ret = [];",
    "  ret.push({objectName: \"ZCL_A\", localClass: \"ltcl_a\", methods: [{\"name\":\"red\",\"skip\":false},{\"name\":\"green\",\"skip\":false}], riskLevel: \"HARMLESS\", filename: \"./a.mjs\"});",
    "  ret.push({objectName: \"ZCL_B\", localClass: \"ltcl_b\", methods: [{\"name\":\"green\",\"skip\":false},{\"name\":\"off\",\"skip\":true}], riskLevel: \"DANGEROUS\", filename: \"./b.mjs\"});",
    "  return ret;",
    "}",
    "",
    "async function run() {}",
  ].join("\n");
  const fake = (methods) => class {
    async constructor_() { this.FRIENDS_ACCESS_INSTANCE = methods; return this; }
  };

  it("reads the list out of the generated harness", () => {
    const entries = harnessEntries(harness);
    expect(entries.map((e) => e.objectName)).to.deep.equal(["ZCL_A", "ZCL_B"]);
    expect(() => harnessEntries("run();")).to.throw(/shape changed/);
  });

  it("runs the class after a failing one and names the failure", async () => {
    const calls = [];
    const modules = {
      "./a.mjs": {ltcl_a: fake({red: async () => { calls.push("a.red"); throw new Error("assert"); }, green: async () => { calls.push("a.green"); }})},
      "./b.mjs": {ltcl_b: fake({green: async () => { calls.push("b.green"); }})},
    };
    const lines = [];
    const {ran, failed} = await runAll(harnessEntries(harness), async (f) => modules[f], {log: (l) => lines.push(l)});
    expect(calls).to.deep.equal(["a.red", "a.green", "b.green"]);
    expect(ran).to.equal(3);
    expect(failed.map((f) => f.name)).to.deep.equal(["ZCL_A: ltcl_a->red"]);
    expect(reported(lines.join("\n"))).to.deep.equal(["ZCL_A", "ZCL_B"]);
    expect(lines).to.include("ZCL_B: running ltcl_b->off, skipped due to configuration");
  });
  it("keeps the method's failure when its teardown fails too, and runs every teardown", async () => {
    const calls = [];
    const methods = {
      red: async () => { throw new Error("the assertion"); },
      teardown: async () => { calls.push("own.teardown"); throw new Error("the cleanup"); },
      SUPER: {teardown: async () => { calls.push("super.teardown"); }},
    };
    const Local = class {
      async constructor_() { this.FRIENDS_ACCESS_INSTANCE = methods; return this; }
    };
    const entries = [{objectName: "ZCL_A", localClass: "ltcl_a", methods: [{name: "red", skip: false}], riskLevel: "HARMLESS", filename: "./a.mjs"}];
    const {failed} = await runAll(entries, async () => ({ltcl_a: Local}), {log: () => {}});
    expect(calls, "a failing teardown does not stop the next one").to.deep.equal(["own.teardown", "super.teardown"]);
    expect(failed).to.have.length(1);
    expect(failed[0].error.message, "the original failure survives").to.equal("the assertion");
    expect(failed[0].errors.map((e) => `${e.phase}: ${e.error.message}`)).to.deep.equal(["method: the assertion", "teardown: the cleanup"]);
  });

  it("still tears down after a failing setup, and does not run the method", async () => {
    const calls = [];
    const methods = {
      setup: async () => { calls.push("setup"); throw new Error("no fixture"); },
      green: async () => { calls.push("method"); },
      teardown: async () => { calls.push("teardown"); },
    };
    const Local = class {
      async constructor_() { this.FRIENDS_ACCESS_INSTANCE = methods; return this; }
    };
    const entries = [{objectName: "ZCL_A", localClass: "ltcl_a", methods: [{name: "green", skip: false}], riskLevel: "HARMLESS", filename: "./a.mjs"}];
    const {failed} = await runAll(entries, async () => ({ltcl_a: Local}), {log: () => {}});
    expect(calls).to.deep.equal(["setup", "teardown"]);
    expect(failed[0].errors.map((e) => e.phase)).to.deep.equal(["setup"]);
  });

  it("refuses a harness list whose data is malformed, not just its syntax", () => {
    const good = {objectName: "ZCL_A", localClass: "ltcl_a", methods: [{name: "m", skip: false}], riskLevel: "HARMLESS", filename: "./a.mjs"};
    expect(invalidEntries([good])).to.deep.equal([]);
    expect(invalidEntries([{...good, riskLevel: "undefined"}]), "no RISK LEVEL clause").to.deep.equal([]);
    expect(invalidEntries({})).to.have.length(1);
    expect(invalidEntries([{...good, methods: [{name: "m", skip: "false"}]}]).join()).to.match(/skip "false" is not a boolean/);
    expect(invalidEntries([{...good, methods: "m"}]).join()).to.match(/methods is not an array/);
    expect(invalidEntries([{...good, methods: [{skip: false}]}]).join()).to.match(/has no name/);
    expect(invalidEntries([{...good, riskLevel: "harmless"}]).join()).to.match(/riskLevel "harmless"/);
    expect(invalidEntries([{...good, filename: ""}]).join()).to.match(/filename is not a non-empty string/);
    expect(invalidEntries([{...good, objectName: 7}]).join()).to.match(/objectName/);
    const quoted = harness.replace('{"name":"green","skip":false}', '{"name":"green","skip":"false"}');
    expect(quoted).to.not.equal(harness);
    expect(() => harnessEntries(quoted)).to.throw(/malformed/);
  });
});

describe("a unit run killed by a signal is not a pass", () => {
  it("reports the signal of a child that reported everything and was then killed", async function () {
    this.timeout(10000);
    const result = await runCaptured(["-e", "console.log('ZCL_A: running ltcl_a->m'); process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 5000);"], {echo: false});
    expect(result.signal).to.equal("SIGTERM");
    expect(result.code).to.equal(null);
    expect(reported(result.captured)).to.deep.equal(["ZCL_A"]);
    expect(exitCodeOf(result), "process.exit(null) would have exited 0").to.equal(1);
  });

  it("passes a clean exit and a failing one through", () => {
    expect(exitCodeOf({code: 0, signal: null})).to.equal(0);
    expect(exitCodeOf({code: 3, signal: null})).to.equal(3);
    expect(exitCodeOf({code: null, signal: null})).to.equal(1);
  });
});
