import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {objectOf, findingsIn, checkRequest, BODY_IS_OBSERVED} from "../tools/osd-preflight.mjs";

// Everything here runs without a system, which is the point: the only part
// of the preflight that needs one is the request body, and that part is
// isolated and marked as constructed rather than observed.
describe("osd-preflight: what can be asserted without a system", () => {
  it("names the ADT object a file is, by its abapGit name", () => {
    expect(objectOf("zcl_osd_se16.clas.abap")).to.deep.equal({
      object: "ZCL_OSD_SE16", kind: "clas", uri: "/sap/bc/adt/oo/classes/zcl_osd_se16"});
    expect(objectOf("zstg_demo.tabl.abap").uri).to.equal("/sap/bc/adt/ddic/tables/zstg_demo");
    expect(objectOf("zif_stg_cds_source.intf.abap").kind).to.equal("intf");
  });

  it("says nothing about a file it cannot name, instead of guessing one", () => {
    // a guessed URI would be asked of the system and answered about the
    // wrong object, which is worse than not asking
    expect(objectOf("readme.md")).to.equal(undefined);
    expect(objectOf("zstg_demo.tabu.json")).to.equal(undefined);
    expect(objectOf("zcl_x.clas.xml")).to.equal(undefined);
  });

  it("keeps three answers apart: findings, none, and no answer at all", () => {
    const one = `<chkrun:checkMessage chkrun:uri="/sap/bc/adt/oo/classes/zcl_x" chkrun:type="E" chkrun:shortText="&quot;TT_B&quot; is a generic type"/>`;
    expect(findingsIn(one)).to.have.length(1);
    expect(findingsIn(one)[0]).to.include({type: "E"});
    expect(findingsIn(one)[0].text).to.contain('"TT_B" is a generic type');
    // an answer with no message element is **accepted**, not "unknown"
    expect(findingsIn("<chkrun:checkRunReports/>")).to.deep.equal([]);
    // and no answer at all is neither: the caller turns this into "not
    // checked", and the parser must not hand it back as an empty list --
    // that is the shape that made a queue check call every unmerged item
    // merged, earlier the same day
    expect(findingsIn(undefined)).to.equal(undefined);
  });

  it("asks about every object in one request, and says the body is not observed", () => {
    const r = checkRequest([objectOf("zcl_a.clas.abap"), objectOf("zcl_b.clas.abap")]);
    expect(r.body).to.contain("/sap/bc/adt/oo/classes/zcl_a");
    expect(r.body).to.contain("/sap/bc/adt/oo/classes/zcl_b");
    expect(BODY_IS_OBSERVED, "nobody has seen this on the wire yet").to.equal(false);
  });

  const run = (args) => {
    try {
      execFileSync("node", ["tools/osd-preflight.mjs", ...args], {encoding: "utf8", stdio: "pipe"});
      return 0;
    } catch (e) {
      return e.status;
    }
  };

  it("exits 'not checked' rather than 'accepted' when it cannot ask", () => {
    // no system named
    expect(run(["src/webgui/zcl_osd_se16.clas.abap"]), "no --to").to.equal(2);
    // a system that is not configured here
    expect(run(["src/webgui/zcl_osd_se16.clas.abap", "--to", "NOPE"]), "unknown system").to.equal(2);
    // nothing it can ask about
    expect(run(["README.md", "--to", "NOPE"]), "no objects").to.equal(2);
  });
});
