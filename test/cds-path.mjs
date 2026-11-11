// R10 (docs/rap-runtime.md, "Path elements"): `_A._B.Element as X [:
// localized]` in a CDS view. Before R10 such an element was taken for an
// exposed association and silently not served; now it is a calculated
// element, typed from the element the path ends in, filled after the read
// by a generated class (tools/cds-path.mjs). The views here are the demo's
// tables; the flight's (_SupplementText.Description : localized) are
// test/rap-r10.mjs.
import {expect} from "chai";
import * as abaplint from "@abaplint/core";
import {readFileSync} from "node:fs";
import {parseDDLS} from "../tools/cds2ddic.mjs";
import {resolveTree} from "../tools/cds-tree.mjs";
import {pathClass} from "../tools/cds-path.mjs";

const DDLS_XML = (name) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DDLS>
<DDLNAME>${name}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT></DDLS></asx:values></asx:abap></abapGit>`;

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
  const parsed = Object.keys(sources).map((name) => parseDDLS(reg.getObjectsByType("DDLS").find((x) => x.getName().toUpperCase() === name), reg));
  resolveTree(parsed, new Map(parsed.map((v) => [v.name.toUpperCase(), v])));
  return Object.fromEntries(parsed.map((v) => [v.name, v]));
}

const TRAVEL = `define view entity ZC_PTRAVEL as select from zstg_demo
{ key travel_id as TravelId, status as Status }`;
const BOOKING = `define view entity ZC_PBOOKING as select from zstg_demo_bk
  association [1..1] to ZC_PTRAVEL as _Travel on $projection.TravelId = _Travel.TravelId
{ key travel_id as TravelId, key booking_id as BookingId,
  _Travel.Status as TravelStatus,
  _Travel }`;

describe("CDS path elements (R10)", () => {
  it("are calculated elements typed from the element they end in", () => {
    const all = views({ZC_PTRAVEL: TRAVEL, ZC_PBOOKING: BOOKING});
    const f = all.ZC_PBOOKING.fields.find((x) => x.name === "TRAVELSTATUS");
    expect(f, "served, not taken for an association").to.not.equal(undefined);
    expect(f.virtual).to.equal(true);
    expect(f.calculatedBy).to.match(/^ZCL_STG_CDS_ZC_PBOOKING_P$/);
    expect(f.path.steps).to.deep.equal([{assoc: "_Travel", target: "ZC_PTRAVEL", sqlView: "ZC_PTRAVEL",
      pairs: [{source: "TRAVELID", target: "TRAVELID"}], language: undefined}]);
    const status = all.ZC_PTRAVEL.fields.find((x) => x.name === "STATUS");
    expect(f.abapType).to.equal(status.typeABAP);
    expect(f.edm).to.equal(status.edm);
    expect(all.ZC_PBOOKING.exposedAssociations).to.deep.equal(["_Travel"]);
  });

  it("writes the class that fills them: one SELECT SINGLE per hop, a draft's first hop from the draft table", () => {
    const all = views({ZC_PTRAVEL: TRAVEL, ZC_PBOOKING: BOOKING});
    const abap = pathClass(all.ZC_PBOOKING);
    expect(abap).to.match(/CLASS zcl_stg_cds_zc_pbooking_p DEFINITION/);
    expect(abap).to.match(/INTERFACES if_sadl_exit_calc_element_read\./);
    expect(abap).to.match(/zcl_stg_cds_path=>is_draft\( cs_row \)/);
    expect(abap).to.match(/SELECT SINGLE \* FROM \(lv_table\) INTO CORRESPONDING FIELDS OF ls_h1\n\s+WHERE travelid = <lv_k0>\./);
    expect(abap).to.match(/<lv_out> = ls_h1-status\./);
  });

  it("does not serve a path it cannot resolve, and says which hop broke", () => {
    const all = views({ZC_PBOOKING: BOOKING.replace("ZC_PTRAVEL as _Travel", "ZC_NOWHERE as _Travel")});
    expect(all.ZC_PBOOKING.fields.some((x) => x.name === "TRAVELSTATUS")).to.equal(false);
    expect(all.ZC_PBOOKING.droppedPaths).to.deep.equal([{name: "TRAVELSTATUS", why: "_Travel ends in ZC_NOWHERE, which is not a generated CDS view"}]);
  });

  it("does not serve a path over a to-many hop without a language condition (an arbitrary row)", () => {
    const all = views({ZC_PTRAVEL: `define view entity ZC_PTRAVEL as select from zstg_demo
  association [0..*] to ZC_PBOOKING as _Booking on $projection.TravelId = _Booking.TravelId
{ key travel_id as TravelId, status as Status, _Booking.BookingId as AnyBooking, _Booking }`, ZC_PBOOKING: BOOKING});
    expect(all.ZC_PTRAVEL.fields.some((x) => x.name === "ANYBOOKING")).to.equal(false);
    expect(all.ZC_PTRAVEL.droppedPaths[0].why).to.match(/is to-many \[0\.\.\*\] without a language condition/);
  });
});
