import {expect} from "chai";
import * as abaplint from "@abaplint/core";
import {readFileSync} from "node:fs";
import {parseDDLS, inheritAssociations} from "../tools/cds2ddic.mjs";

// B.1, the read half: associations in a projection.
//
// `parseDDLS` reads one view at a time, and a view's associations are the
// `association [0..*] to X on ...` clauses it declares. A **projection**
// declares none — it names an element, `_Child`, that the view underneath
// declared — so the element was collected as "exposed" and then had nothing
// to be exposed **of**. Measured before the fix: the base view came back with
// its association and the projection of it with none, silently.
const DDLS_XML = (name) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DDLS>
<DDLNAME>${name}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT></DDLS></asx:values></asx:abap></abapGit>`;

/** the demo's own tables, so the shapes are the ones actually served */
function views(sources) {
  const reg = new abaplint.Registry();
  for (const t of ["zstg_demo", "zstg_demo_bk"]) {
    reg.addFile(new abaplint.MemoryFile(`${t}.tabl.xml`, readFileSync(`src/ddic/${t}.tabl.xml`, "utf8")));
  }
  for (const [name, text] of Object.entries(sources)) {
    reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.asddls`, text));
    reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.xml`, DDLS_XML(name)));
  }
  reg.parse();
  const parsed = Object.keys(sources).map((name) => {
    const o = reg.getObjectsByType("DDLS").find((x) => x.getName().toUpperCase() === name);
    expect(o, `${name} parsed as a DDLS`).to.not.equal(undefined);
    return parseDDLS(o, reg);
  });
  inheritAssociations(parsed, new Map(parsed.map((v) => [v.name.toUpperCase(), v])));
  return Object.fromEntries(parsed.map((v) => [v.name, v]));
}

const CHILD = `@AbapCatalog.sqlViewName: 'ZVCHILD'
define view ZC_CHILD as select from zstg_demo_bk
{ key travel_id as TravelId, key booking_id as BookingId }`;

const BASE = `@AbapCatalog.sqlViewName: 'ZVBASE'
define view ZC_BASE as select from zstg_demo
  association [0..*] to ZC_CHILD as _Child on $projection.TravelId = _Child.TravelId
{ key travel_id as TravelId, status as Status, _Child }`;

describe("an association a projection re-exposes belongs to the projection", () => {
  it("was dropped before, and is carried now, with the view it came from", () => {
    const all = views({ZC_CHILD: CHILD, ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
define view ZC_PROJ as select from ZC_BASE { key TravelId, Status, _Child }`});
    expect(all.ZC_BASE.associations.map((a) => a.alias), "the base declares it").to.deep.equal(["_Child"]);
    const proj = all.ZC_PROJ.associations;
    expect(proj.map((a) => a.alias), "and the projection re-exposes it").to.deep.equal(["_Child"]);
    expect(proj[0].target).to.equal("ZC_CHILD");
    // named, because "where did this come from" is the first question a
    // reader of a generated artefact asks
    expect(proj[0].inheritedFrom).to.equal("ZC_BASE");
  });

  it("keeps the source's ON pairs, because the condition is written in its names", () => {
    const all = views({ZC_CHILD: CHILD, ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
define view ZC_PROJ as select from ZC_BASE { key TravelId, Status, _Child }`});
    expect(all.ZC_PROJ.associations[0].pairs).to.deep.equal(all.ZC_BASE.associations[0].pairs);
  });

  it("refuses to inherit one whose ON column the projection renamed", () => {
    // the pairs name columns of the source; a projection that renames one
    // would get pairs naming a column that is not there. Refused by name
    // rather than emitted wrong — the alternative is a join on a column that
    // does not exist, found at run time by an engine
    const all = views({ZC_CHILD: CHILD, ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
define view ZC_PROJ as select from ZC_BASE { key TravelId as Journey, Status, _Child }`});
    expect(all.ZC_PROJ.associations ?? [], "nothing invented").to.have.length(0);
    expect(all.ZC_PROJ.unresolvedAssociations, "and it says which one").to.deep.equal(["_Child"]);
  });

  it("says so when the element names an association the source does not have", () => {
    const all = views({ZC_CHILD: CHILD, ZC_BASE: BASE, ZC_PROJ: `@AbapCatalog.sqlViewName: 'ZVPROJ'
define view ZC_PROJ as select from ZC_BASE { key TravelId, Status, _Nope }`});
    expect(all.ZC_PROJ.unresolvedAssociations).to.deep.equal(["_Nope"]);
  });

  it("leaves a view that selects from a table exactly as it was", () => {
    const all = views({ZC_CHILD: CHILD, ZC_BASE: BASE});
    expect(all.ZC_BASE.associations, "one, declared, not inherited").to.have.length(1);
    expect(all.ZC_BASE.associations[0].inheritedFrom, "nothing to inherit from").to.equal(undefined);
  });
});
