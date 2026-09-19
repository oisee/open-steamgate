import {expect} from "chai";
import {testClassesIn, reported, missing} from "../tools/osd-unit-run.mjs";

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
