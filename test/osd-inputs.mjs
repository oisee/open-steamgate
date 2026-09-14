import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {objectOf, report} from "../tools/osd-inputs.mjs";

describe("osd-inputs", () => {
  it("reads the object out of an abapGit file name", () => {
    expect(objectOf("zcl_x.clas.abap")).to.equal("CLAS ZCL_X");
    expect(objectOf("zcl_x.clas.xml")).to.equal("CLAS ZCL_X");
    // a function module is a member of its group, not an object of its own
    expect(objectOf("zw3mi.fugr.wwwdata_import.abap")).to.equal("FUGR ZW3MI");
    // the percent abapGit writes for a dot is part of the name
    expect(objectOf("zork-mini%2ez3.w3mi.xml")).to.equal("W3MI ZORK-MINI.Z3");
    expect(objectOf("README.md")).to.equal(undefined);
  });

  describe("against a tree", () => {
    let root;
    const write = (folder, name) => {
      mkdirSync(join(root, folder), {recursive: true});
      writeFileSync(join(root, folder, name), "");
    };

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "osd-inputs-"));
      writeFileSync(join(root, "abap_transpile.json"),
        JSON.stringify({input_folder: ["src", "local/used"]}));
      write("src", "zcl_one.clas.abap");
      write("local/used", "zcl_two.clas.abap");
    });

    afterEach(() => rmSync(root, {recursive: true, force: true}));

    it("says nothing when the inputs are the whole story", () => {
      const r = report(join(root, "abap_transpile.json"), {root});
      expect(r.total).to.equal(2);
      expect(r.clashes).to.deep.equal([]);
      expect(r.shadows).to.deep.equal([]);
    });

    it("names the later input that wins an object", () => {
      write("local/used", "zcl_one.clas.abap");
      const r = report(join(root, "abap_transpile.json"), {root});
      expect(r.clashes).to.deep.equal([{object: "CLAS ZCL_ONE", earlier: "src", winner: "local/used"}]);
    });

    // the day this was written: local/vivid-vibes held 85 objects the build
    // also has, and was not an input, so every edit to it did nothing
    it("names a folder that looks like an input and is not", () => {
      write("local/shadow", "zcl_one.clas.abap");
      write("local/shadow", "zcl_own.clas.abap");
      const r = report(join(root, "abap_transpile.json"), {root});
      expect(r.shadows).to.have.length(1);
      expect(r.shadows[0].folder).to.equal("local/shadow");
      expect(r.shadows[0].total).to.equal(2);
      expect(r.shadows[0].shared).to.deep.equal(["CLAS ZCL_ONE"]);
    });
  });
});
