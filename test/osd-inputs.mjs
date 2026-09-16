import {expect} from "chai";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describeDuplicates, excludePatterns, objectOf, report} from "../tools/osd-inputs.mjs";

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

    // the later input wins, the way a layer does and the way the transpiler
    // on its own writes the later file last, and every file of the object
    // in the earlier input is hidden, the XML with the source
    it("names the later input that wins an object, and the files it hides", () => {
      write("src", "zcl_one.clas.xml");
      write("local/used", "zcl_one.clas.abap");
      const r = report(join(root, "abap_transpile.json"), {root});
      expect(r.clashes).to.deep.equal([{object: "CLAS ZCL_ONE", winner: "local/used",
                                        hidden: ["src/zcl_one.clas.abap", "src/zcl_one.clas.xml"]}]);
      expect(r.hidden).to.deep.equal(["src/zcl_one.clas.abap", "src/zcl_one.clas.xml"]);
      expect(r.duplicates).to.deep.equal([]);
      // what keeps them from the transpiler: one anchored pattern per file
      const patterns = excludePatterns(r.hidden).map((p) => new RegExp(p, "i"));
      expect(patterns[0].test("src/zcl_one.clas.abap")).to.equal(true);
      expect(patterns[0].test("local/used/zcl_one.clas.abap")).to.equal(false);
      expect(patterns[0].test("src/sub/zcl_one.clas.abap")).to.equal(false);
    });

    it("a name twice inside one input is a duplicate no order decides, with both files named", () => {
      write("src/a", "zcl_two.clas.abap");
      write("src/b", "zcl_two.clas.abap");
      const r = report(join(root, "abap_transpile.json"), {root});
      expect(r.duplicates).to.deep.equal([{object: "CLAS ZCL_TWO", folder: "src",
                                           files: ["src/a/zcl_two.clas.abap", "src/b/zcl_two.clas.abap"]}]);
      expect(describeDuplicates(r.duplicates)).to.contain("src/a/zcl_two.clas.abap, src/b/zcl_two.clas.abap");
      // the same name in another input is an override, not a duplicate
      expect(r.clashes.map((c) => c.object)).to.deep.equal(["CLAS ZCL_TWO"]);
    });

    it("a package file is its folder's, so package.devc.xml everywhere is no duplicate", () => {
      write("src/a", "package.devc.xml");
      write("src/b", "package.devc.xml");
      const r = report(join(root, "abap_transpile.json"), {root});
      expect(r.duplicates).to.deep.equal([]);
      expect(r.total).to.equal(2);
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
