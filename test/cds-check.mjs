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

  it("and the file is restored, or this suite breaks the tree it measures", () => {
    expect(readFileSync(FILE, "utf8")).to.contain("define view");
  });
});
