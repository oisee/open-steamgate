import {expect} from "chai";
import * as abaplint from "@abaplint/core";
import {readFileSync} from "node:fs";
import {parseDDLS, viewFieldsOf} from "../tools/cds2ddic.mjs";

// A CDS SQL view over a client-dependent table carries the client as its
// first key field, named in the DDL or not; the CDS entity does not. A
// runtime that filters by client cannot read a view without it, and one that
// does not filter hands out every client's rows. A view over a table with no
// client stays as it is.
const XML = (n) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DDLS>
<DDLNAME>${n}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT></DDLS></asx:values></asx:abap></abapGit>`;

function parse(name, text) {
  const reg = new abaplint.Registry();
  reg.addFile(new abaplint.MemoryFile("zstg_demo.tabl.xml", readFileSync("src/ddic/zstg_demo.tabl.xml", "utf8")));
  reg.addFile(new abaplint.MemoryFile("zosd_sys.tabl.xml", readFileSync("src/status/zosd_sys.tabl.xml", "utf8")));
  reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.asddls`, text));
  reg.addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.xml`, XML(name)));
  reg.parse();
  return parseDDLS(reg.getObjectsByType("DDLS").find((x) => x.getName().toUpperCase() === name), reg);
}

describe("the client in a generated CDS SQL view", () => {
  it("is the first key field of a view over a client-dependent table, which the DDL does not name", () => {
    const view = parse("ZC_CLI", `@AbapCatalog.sqlViewName: 'ZVCLI'
define view ZC_CLI as select from zstg_demo
{ key travel_id as TravelId, description as Description }`);
    const fields = viewFieldsOf(view);
    expect(fields[0]).to.include({name: "MANDT", base: "MANDT", key: true});
    expect(fields.map((f) => f.name)).to.deep.equal(["MANDT", "TRAVELID", "DESCRIPTION"]);
  });

  it("is not a field of the CDS entity itself, as on a system", () => {
    const view = parse("ZC_CLI", `@AbapCatalog.sqlViewName: 'ZVCLI'
define view ZC_CLI as select from zstg_demo
{ key travel_id as TravelId, description as Description }`);
    expect(viewFieldsOf(view, {client: false}).map((f) => f.name)).to.deep.equal(["TRAVELID", "DESCRIPTION"]);
  });

  it("goes first and into the key when the DDL names it somewhere else", () => {
    const view = parse("ZC_CLI", `@AbapCatalog.sqlViewName: 'ZVCLI'
define view ZC_CLI as select from zstg_demo
{ key travel_id as TravelId, mandt as Mandt, description as Description }`);
    const fields = viewFieldsOf(view);
    expect(fields[0]).to.include({name: "MANDT", base: "MANDT", key: true});
    expect(fields.filter((f) => String(f.base).toUpperCase() === "MANDT")).to.have.length(1);
  });

  it("is absent from a view over a table without a client", () => {
    const view = parse("ZC_NOCLI", `@AbapCatalog.sqlViewName: 'ZVNOCLI'
define view ZC_NOCLI as select from zosd_sys
{ key sid as Sid }`);
    expect(view.skip, JSON.stringify(view.skip)).to.equal(undefined);
    expect(viewFieldsOf(view).some((f) => String(f.base).toUpperCase() === "MANDT")).to.equal(false);
  });
});
