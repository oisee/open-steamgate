import {expect} from "chai";
import * as abaplint from "@abaplint/core";
import {readFileSync} from "node:fs";
import {parseDDLS} from "../tools/cds2ddic.mjs";

// B.1, on the way to the write half: **a WHERE in a view was read and thrown
// away**, and it was wrong in both directions.
//
// Measured before anything was changed, on a fixture rather than on a view in
// the tree, because there is no view in the tree with a WHERE -- which is
// also why refusing now costs nothing:
//
//   reads   the generated DDIC view carries DD26V (the table) and DD27P (the
//           fields) and no selection condition at all, so a filtered view
//           returned EVERY row
//   writes  `write.writable` came back **true**, so a row failing the filter
//           could be INSERTed through a view that can never show it -- which
//           is exactly what SADL refuses to do
//
// Both silent. The clause is refused at generation now, by name, because the
// author is there and the reader of a wrong row is not.
const XML = (n) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DDLS>
<DDLNAME>${n}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT></DDLS></asx:values></asx:abap></abapGit>`;

function parse(name, text) {
  const reg = new abaplint.Registry();
  reg.addFile(new abaplint.MemoryFile("zstg_demo.tabl.xml", readFileSync("src/ddic/zstg_demo.tabl.xml", "utf8")));
  reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.asddls`, text));
  reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.xml`, XML(name)));
  reg.parse();
  return parseDDLS(reg.getObjectsByType("DDLS").find((x) => x.getName().toUpperCase() === name), reg);
}

const body = (name, sqlView, where) => `@AbapCatalog.sqlViewName: '${sqlView}'
@ObjectModel.writeEnabled: true
define view ${name} as select from zstg_demo
{ key travel_id as TravelId, description as Description, status as Status }${where ? "\n" + where : ""}`;

describe("a clause the generator reads and does not carry is refused, not dropped", () => {
  it("a view without one is writable, so the refusal below is narrow", () => {
    const view = parse("ZC_PLAIN", body("ZC_PLAIN", "ZVPLAIN"));
    expect(view.skip, "nothing to refuse here").to.equal(undefined);
    expect(view.write.writable).to.equal(true);
  });

  it("a view WITH a WHERE is refused by name rather than generated without it", () => {
    const view = parse("ZC_FILT", body("ZC_FILT", "ZVFILT", "where status = 'A'"));
    expect(view.skip, "it used to come back writable, with the filter gone").to.be.a("string");
    expect(view.write, "and nothing downstream is offered a writable view").to.equal(undefined);
  });

  // The reason has to carry BOTH consequences. Reduced to "not supported
  // yet" it reads like a missing feature, and the next person adds the
  // clause back without the filter.
  it("and the reason names what would go wrong, in both directions", () => {
    const {skip} = parse("ZC_FILT2", body("ZC_FILT2", "ZVFILT2", "where status = 'A'"));
    expect(skip, "the read consequence").to.contain("every row");
    expect(skip, "the write consequence").to.match(/insert a row the view cannot show/i);
  });

  it("a WHERE inside an association's ON is not a view filter, and is left alone", () => {
    // the ON of an association is a join condition, not a selection over the
    // view's own rows; refusing it would refuse every view with an
    // association, which is the over-wide version of this check
    const withAssoc = `@AbapCatalog.sqlViewName: 'ZVASSOC'
define view ZC_ASSOC as select from zstg_demo
  association [0..*] to zstg_demo_bk as _Booking on _Booking.travel_id = zstg_demo.travel_id
{ key travel_id as TravelId, _Booking }`;
    const reg = new abaplint.Registry();
    for (const t of ["zstg_demo", "zstg_demo_bk"]) {
      reg.addFile(new abaplint.MemoryFile(`${t}.tabl.xml`, readFileSync(`src/ddic/${t}.tabl.xml`, "utf8")));
    }
    reg.addFile(new abaplint.MemoryFile("zc_assoc.ddls.asddls", withAssoc));
    reg.addFile(new abaplint.MemoryFile("zc_assoc.ddls.xml", XML("ZC_ASSOC")));
    reg.parse();
    const view = parseDDLS(reg.getObjectsByType("DDLS").find((x) => x.getName() === "ZC_ASSOC"), reg);
    expect(view.skip, "an association is not a filter").to.equal(undefined);
    expect(view.associations, "and it is still read").to.have.length.greaterThan(0);
  });
});
