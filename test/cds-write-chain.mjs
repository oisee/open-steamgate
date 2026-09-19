import {expect} from "chai";
import * as abaplint from "@abaplint/core";
import {readFileSync} from "node:fs";
import {parseDDLS, resolveWriteChain} from "../tools/cds2ddic.mjs";

// B.1, the write half: a projection of a writable view is writable too.
//
// `write.writable` asked for one **table** underneath, so a projection of a
// view -- the shape the read half taught to carry associations -- was
// refused with "<view> is not a table". A projection's field names a field
// of the view below it, that field names a column, and writing needs the
// composition of the two.
//
// Refusals say which LINK broke, because "not writable" over a two-level
// view is a sentence somebody then spends an evening on.
const XML = (n) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DDLS>
<DDLNAME>${n}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT></DDLS></asx:values></asx:abap></abapGit>`;

function views(sources) {
  const reg = new abaplint.Registry();
  for (const t of ["zstg_demo", "zstg_demo_bk"]) {
    reg.addFile(new abaplint.MemoryFile(`${t}.tabl.xml`, readFileSync(`src/ddic/${t}.tabl.xml`, "utf8")));
  }
  for (const [name, text] of Object.entries(sources)) {
    reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.asddls`, text));
    reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.xml`, XML(name)));
  }
  reg.parse();
  const parsed = Object.keys(sources).map((name) =>
    parseDDLS(reg.getObjectsByType("DDLS").find((x) => x.getName().toUpperCase() === name), reg));
  resolveWriteChain(parsed, new Map(parsed.map((v) => [v.name.toUpperCase(), v])));
  return Object.fromEntries(parsed.map((v) => [v.name, v]));
}

const BASE = `@AbapCatalog.sqlViewName: 'ZVBASE'
@ObjectModel.writeEnabled: true
define view ZC_BASE as select from zstg_demo
{ key travel_id as TravelId, description as Description, status as Status }`;

describe("a projection of a writable view is written through to the table", () => {
  it("composes the mapping, so the generated to_base stays one hop", () => {
    const {ZC_PROJ} = views({ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
@ObjectModel.writeEnabled: true
define view ZC_PROJ as select from ZC_BASE
{ key TravelId as Journey, Description as Text }`});
    expect(ZC_PROJ.write.writable, ZC_PROJ.write.why).to.equal(true);
    expect(ZC_PROJ.source, "it writes the TABLE, not the view above it").to.equal("ZSTG_DEMO");
    // the parser upper-cases a field's name, so the map is keyed JOURNEY and
    // not Journey -- my first version of this assertion looked for the
    // spelling in the source and found nothing, which is the check being
    // wrong rather than the code
    const byName = Object.fromEntries(ZC_PROJ.fields.map((f) => [f.name, f.base]));
    expect(byName.JOURNEY, "JOURNEY -> TRAVELID -> TRAVEL_ID, composed once").to.equal("TRAVEL_ID");
    expect(byName.TEXT).to.equal("DESCRIPTION");
    expect(ZC_PROJ.write.through, "and it says which view it went through").to.equal("ZC_BASE");
  });

  it("a view that reads a table directly is untouched by the pass", () => {
    const {ZC_BASE: base} = views({ZC_BASE: BASE});
    expect(base.source).to.equal("ZSTG_DEMO");
    expect(base.write.writable).to.equal(true);
    expect(base.write.through, "nothing was composed").to.equal(undefined);
  });
});

describe("and each refusal says which link broke", () => {
  it("the view below does not ask to be written", () => {
    const readOnly = BASE.replace("@ObjectModel.writeEnabled: true\n", "");
    const {ZC_PROJ} = views({ZC_BASE: readOnly, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
@ObjectModel.writeEnabled: true
define view ZC_PROJ as select from ZC_BASE
{ key TravelId as Journey }`});
    expect(ZC_PROJ.write.writable).to.equal(false);
    expect(ZC_PROJ.write.why).to.contain("ZC_BASE is not written through either");
  });

  it("a field names something the view below does not have", () => {
    const {ZC_PROJ} = views({ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
@ObjectModel.writeEnabled: true
define view ZC_PROJ as select from ZC_BASE
{ key TravelId as Journey, Nonsense as Extra }`});
    expect(ZC_PROJ.write.writable).to.equal(false);
    expect(ZC_PROJ.write.why, "the name that broke it, and on which side").to.contain("NONSENSE");
    expect(ZC_PROJ.write.why).to.contain("ZC_BASE does not have");
  });

  it("a key of the base table is not reachable through the projection", () => {
    const {ZC_PROJ} = views({ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
@ObjectModel.writeEnabled: true
define view ZC_PROJ as select from ZC_BASE
{ Description as Text }`});
    expect(ZC_PROJ.write.writable).to.equal(false);
    expect(ZC_PROJ.write.why, "the key it cannot fill").to.contain("TRAVEL_ID");
    expect(ZC_PROJ.write.why).to.contain("not reachable");
  });

  it("a projection that never asked is left alone, rather than refused", () => {
    // "did not ask" and "could not" are different answers, and the pass must
    // not turn the first into the second
    const {ZC_PROJ} = views({ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
define view ZC_PROJ as select from ZC_BASE
{ key TravelId as Journey }`});
    expect(ZC_PROJ.write.writable).to.equal(false);
    expect(ZC_PROJ.write.why).to.equal("the view does not ask for it");
  });
});
