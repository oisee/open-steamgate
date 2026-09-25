import {expect} from "chai";
import {readFileSync, writeFileSync} from "node:fs";
import {ObjectStore} from "../tools/osd-store.mjs";

// **A CDS view was checked by nobody**, which a screen with a Check button
// turns from a gap into a lie.
//
// Measured before anything was written, on `ZC_OSD_PACK`:
//
//   intact                      no issues
//   `definnnne vieeew`          no issues      <- syntactically broken
//   selecting from a table
//   that does not exist         no issues
//
// and `npm run lint` agreed with all three: 0 of 416. The BUILD then failed
// naming a **consumer** -- `zcl_zosd_status_dpc:43`, "ZC_OSD_PACK not found"
// -- and never the file somebody had just edited. Check says fine, Activate
// fails somewhere else, and the person edited a view.
//
// The generator is the only thing here that reads a CDS view and it already
// refuses by name, so the check asks it: "the check passed" now means "the
// thing that has to read this can", which is what activation needs anyway.
const FILE = "src/cds/zc_osd_pack.ddls.asddls";

function checkWith(mangle) {
  const original = readFileSync(FILE, "utf8");
  try {
    if (mangle !== undefined) writeFileSync(FILE, mangle(original));
    return new ObjectStore().check("DDLS", "ZC_OSD_PACK").issues;
  } finally {
    writeFileSync(FILE, original);
  }
}

describe("a CDS view is checked by the thing that has to read it", function () {
  this.timeout(30000);

  it("says nothing about a view that is fine, or nobody reads the second one", () => {
    expect(checkWith(undefined)).to.deep.equal([]);
  });

  it("catches a view it cannot parse at all", () => {
    const issues = checkWith((s) => s.replace("define view", "definnnne vieeew"));
    expect(issues, "it used to answer [] to this").to.have.length.greaterThan(0);
    expect(issues[0].message).to.contain("not a CDS view this system can read");
  });

  it("catches a source that is not in the system, which the build only names through a consumer", () => {
    const issues = checkWith((s) => s.replace(/\bzosd_pack\b/, "znot_a_table"));
    expect(issues).to.have.length.greaterThan(0);
    expect(issues[0].message, "the view and the name it could not find").to.contain("ZNOT_A_TABLE");
    expect(issues[0].message).to.contain("ZC_OSD_PACK");
  });

  // The difference between a class and a view, and it is the whole of G.8's
  // CDS half: a class's dependents are SOURCES and the registry is the
  // truth; a view's are GENERATED and the registry lags by one generation.
  // Measured: rename a field and five candidates are found -- the registry,
  // the source class, a DPC -- and not one fails its own check, because they
  // still hold the previous shape and agree with each other. The build then
  // fails naming a consumer and never the view.
  it("names the field that left the view, which the build never does", () => {
    const issues = checkWith((s) => s.replace("description as Description", "description as Renamed"));
    expect(issues, "activation said active, 0 issues, 0 dependents").to.have.length.greaterThan(0);
    expect(issues[0].message).to.contain("DESCRIPTION");
    expect(issues[0].message, "and where it still is").to.contain("ZVOSDPACK");
    expect(issues[0].severity, "a warning: the view is fine, the consequence lands elsewhere").to.equal("W");
  });

  it("and a view whose shape did not change says nothing, so the warning means something", () => {
    expect(checkWith((s) => s.replace("@EndUserText.label: \'Folders\'", "@EndUserText.label: \'Directories\'")))
      .to.deep.equal([]);
  });

  // **A table function is not a broken view.** `define table function` has
  // no SELECT by design -- its rows come from an AMDP method -- so the
  // generator skips it, and reporting that skip as an error would tell a
  // person their table function is broken. Found by running the check over
  // the whole tree rather than over the fixture it was written against: 11
  // of 13 clean, and one of the two was this.
  it("says nothing about a table function, which has no SELECT by design", async () => {
    const {ObjectStore} = await import("../tools/osd-store.mjs");
    expect(new ObjectStore().check("DDLS", "ZTF_OSD_SQUARES").issues,
      "the kinds the generator does not handle are silent; the ones it cannot READ are not").to.deep.equal([]);
  });

  it("and every view in the tree checks clean, so the check is not crying wolf", async () => {
    const {ObjectStore} = await import("../tools/osd-store.mjs");
    const store = new ObjectStore();
    const noisy = store.list().filter((o) => o.type === "DDLS")
      .map((o) => ({name: o.name, issues: store.check("DDLS", o.name).issues}))
      .filter((one) => one.issues.length > 0)
      // ZDEMO_EDITOR is a FIXTURE under test/fixtures/, which the build
      // excludes and the store indexes anyway -- the same shape as the
      // gen/segw-editor folder had, one folder short of the rule that fixed it. Its
      // complaint is true of the object and false of the system.
      .filter((one) => one.name !== "ZDEMO_EDITOR");
    expect(noisy.map((one) => `${one.name}: ${one.issues[0].message}`)).to.deep.equal([]);
  });

  it("and the file is restored, or this suite breaks the tree it measures", () => {
    expect(readFileSync(FILE, "utf8")).to.contain("define view");
  });
});
