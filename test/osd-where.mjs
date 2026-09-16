import {expect} from "chai";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {abapFrames, describe as describeError, dumpOf, statementAfter} from "../tools/osd-where.mjs";

describe("osd-where, a stack in ABAP terms", () => {
  let folder = "";

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "osd-where-"));
    // a generated module, its map, and the ABAP it came from
    writeFileSync(join(folder, "zcl_x.clas.abap"), [
      "CLASS zcl_x DEFINITION PUBLIC.",
      "ENDCLASS.",
      "CLASS zcl_x IMPLEMENTATION.",
      "  METHOD run.",
      "    APPEND lv_val TO rt_values.",
      "  ENDMETHOD.",
      "ENDCLASS.",
    ].join("\n"));
    writeFileSync(join(folder, "zcl_x.clas.mjs"), "line1\nline2\n");
    // one mapping: generated line 2 column 0 -> source line 5 column 4
    writeFileSync(join(folder, "zcl_x.clas.mjs.map"), JSON.stringify({
      version: 3,
      file: "zcl_x.clas.mjs",
      sources: ["zcl_x.clas.abap"],
      names: [],
      mappings: ";AAII",
    }));
  });

  afterEach(() => rmSync(folder, {recursive: true, force: true}));

  it("a generated frame becomes the ABAP statement", () => {
    const stack = `Error\n    at foo (${join(folder, "zcl_x.clas.mjs")}:2:1)`;
    const [frame] = abapFrames(stack);
    expect(frame.file).to.equal("zcl_x.clas.abap");
    expect(frame.line).to.equal(5);
    expect(frame.text).to.equal("APPEND lv_val TO rt_values.");
  });

  it("describe says what and where in one line", () => {
    const error = new Error("boom");
    error.stack = `Error\n    at foo (${join(folder, "zcl_x.clas.mjs")}:2:1)`;
    expect(describeError(error)).to.contain("zcl_x.clas.abap:5");
    expect(describeError(error)).to.contain("APPEND lv_val TO rt_values.");
  });

  it("a frame with no map is kept, not dropped", () => {
    const stack = `Error\n    at foo (${join(folder, "zcl_nomap.clas.mjs")}:9:1)`;
    const [frame] = abapFrames(stack);
    expect(frame.mapped).to.equal(false);
    expect(frame.file).to.equal("zcl_nomap.clas.mjs");
  });

  it("a dump is the error, where it happened in ABAP, and the frames under it", () => {
    const error = new Error("boom");
    error.stack = `Error: boom\n    at foo (${join(folder, "zcl_x.clas.mjs")}:2:1)`;
    const d = dumpOf(error, {request: "GET /sap/opu/odata/sap/X/Set"});
    expect(d.name).to.equal("ERROR");
    expect(d.message).to.equal("boom");
    expect(d.where).to.contain("zcl_x.clas.abap:5").and.contain("APPEND lv_val TO rt_values.");
    expect(d.frames[0]).to.include({file: "zcl_x.clas.abap", line: 5, mapped: true});
    expect(d.request).to.equal("GET /sap/opu/odata/sap/X/Set");
    expect(d.at).to.match(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("no ABAP anywhere says so rather than guessing", () => {
    expect(describeError(new Error("boom"))).to.contain("write_source_map");
  });

  it("statementAfter still names the next statement, not the line above", () => {
    const source = "METHOD run.\n\n\n  APPEND x TO y.\n";
    expect(statementAfter(source, 1, 11)).to.deep.equal({line: 4, column: 3});
  });
});
