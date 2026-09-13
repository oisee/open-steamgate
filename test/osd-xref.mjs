import {expect} from "chai";
import {existsSync, readFileSync} from "node:fs";
import {CrossReference} from "../tools/osd-xref.mjs";

// The cross-reference of OSD: who calls what, who reads which table, what
// loads what. vsp's graph tools read these over freestyle SQL, so the rows
// are checked against what the repository actually contains.
describe("tools/osd-xref: the cross-reference, derived from the parse", () => {
  const xref = new CrossReference().build();
  const tables = xref.tables();
  const where = (rows, name) => rows.filter((r) => r.NAME === name).map((r) => r.INCLUDE);

  it("fills the four tables vsp reads", () => {
    expect(Object.keys(tables)).to.deep.equal(["cross", "wbcrossgt", "wbcrossgtx", "d010inc"]);
    expect(tables.cross.length).to.be.greaterThan(20);
    expect(tables.wbcrossgt.length).to.be.greaterThan(500);
    expect(tables.d010inc.length).to.be.greaterThan(10);
  });

  it("a function module call becomes a CROSS row of type F", () => {
    const callers = where(tables.cross.filter((r) => r.TYPE === "F"), "BAPI_TRANSACTION_COMMIT");
    expect(callers).to.include("ZCL_ZSTG_MAPPED_DPC");
    // the generated DPCs call it, the hand-written gateway does not
    expect(callers).to.not.include("ZCL_STG_DISPATCHER");
  });

  it("a table read becomes a CROSS row of type S, which is what who-touches asks", () => {
    const readers = where(tables.cross.filter((r) => r.TYPE === "S"), "ZSTG_DEMO");
    expect(readers).to.include("ZCL_ZSTG_DEMO_DPC_EXT");
    expect(readers).to.include("ZCL_STG_TAB_ZSTG_DEMO");
  });

  it("a type reference becomes a WBCROSSGT row of OTYPE TY", () => {
    expect(tables.wbcrossgt.every((r) => r.OTYPE === "TY")).to.equal(true);
    expect(where(tables.wbcrossgt, "CL_ABAP_ZIP")).to.include("ZCL_STG_SEGW_REPO");
    expect(where(tables.wbcrossgt, "ZIF_STG_CDS_SOURCE")).to.include("ZCL_STG_SEGW_IMPORT");
  });

  it("an object does not reference itself, and a row appears once", () => {
    expect(tables.wbcrossgt.filter((r) => r.NAME === r.INCLUDE)).to.deep.equal([]);
    const keys = tables.wbcrossgt.map((r) => `${r.OTYPE}|${r.NAME}|${r.INCLUDE}`);
    expect(new Set(keys).size).to.equal(keys.length);
  });

  it("the load graph carries a class's own includes", () => {
    const includes = tables.d010inc.filter((r) => r.MASTER === "ZCL_STG_SEGW_TEST").map((r) => r.INCLUDE);
    expect(includes.join(" ")).to.contain("TESTCLASSES");
  });

  it("a long name goes to WBCROSSGTX, the short ones do not", () => {
    for (const row of tables.wbcrossgt) {
      expect(row.NAME.length, row.NAME).to.be.at.most(30);
    }
    for (const row of tables.wbcrossgtx) {
      expect(row.NAME.length, row.NAME).to.be.greaterThan(30);
    }
  });

  it("the DDIC of the four tables is in the repository, so the runtime creates them", () => {
    for (const table of ["cross", "wbcrossgt", "wbcrossgtx", "d010inc"]) {
      const file = `src/osd/ddic/${table}.tabl.xml`;
      expect(existsSync(file), file).to.equal(true);
      expect(readFileSync(file, "utf8")).to.contain(`<TABNAME>${table.toUpperCase()}</TABNAME>`);
    }
    // the columns are the ones vsp selects, no more
    const cross = readFileSync("src/osd/ddic/cross.tabl.xml", "utf8");
    for (const field of ["TYPE", "NAME", "INCLUDE"]) {
      expect(cross).to.contain(`<FIELDNAME>${field}</FIELDNAME>`);
    }
    const wb = readFileSync("src/osd/ddic/wbcrossgt.tabl.xml", "utf8");
    for (const field of ["OTYPE", "NAME", "INCLUDE"]) {
      expect(wb).to.contain(`<FIELDNAME>${field}</FIELDNAME>`);
    }
    expect(readFileSync("src/osd/ddic/d010inc.tabl.xml", "utf8")).to.contain("<FIELDNAME>MASTER</FIELDNAME>");
  });
});
