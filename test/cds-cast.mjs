import {expect} from "chai";
import * as abaplint from "@abaplint/core";
import {parseDDLS} from "../tools/cds2ddic.mjs";

// B.14: a cast in a CDS view dropped the field.
//
// The generator handled `cast( '' as abap.char(12) ) as X` when the element
// was annotated as a virtual one. Without that annotation the element has no
// direct `CDSName` child at all — the source column sits *inside* the cast —
// so the field was skipped without a word. Three elements in, two fields out,
// and an entity keyed on the casted one then answered with no key.
//
// Found 2026-09-17 building the status service, and pinned here rather than
// by a fixture view in `src/cds/`: the defect is in reading one element, so
// the test reads one element.
const TABLE = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DD02V>
  <TABNAME>ZTEST_CAST</TABNAME><TABCLASS>TRANSP</TABCLASS><DDTEXT>t</DDTEXT>
 </DD02V><DD09L><TABNAME>ZTEST_CAST</TABNAME><TABKAT>0</TABKAT><TABART>APPL0</TABART></DD09L>
 <DD03P_TABLE>
  <DD03P><FIELDNAME>PORT</FIELDNAME><KEYFLAG>X</KEYFLAG><INTTYPE>C</INTTYPE><INTLEN>000010</INTLEN><DATATYPE>CHAR</DATATYPE><LENG>000005</LENG></DD03P>
  <DD03P><FIELDNAME>PROTOCOL</FIELDNAME><INTTYPE>C</INTTYPE><INTLEN>000040</INTLEN><DATATYPE>CHAR</DATATYPE><LENG>000020</LENG></DD03P>
  <DD03P><FIELDNAME>PURPOSE</FIELDNAME><INTTYPE>C</INTTYPE><INTLEN>000080</INTLEN><DATATYPE>CHAR</DATATYPE><LENG>000040</LENG></DD03P>
 </DD03P_TABLE></asx:values></asx:abap>
</abapGit>`;

const DDLS_XML = (name) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DDLS>
  <DDLNAME>${name}</DDLNAME><DDLANGUAGE>E</DDLANGUAGE><DDTEXT>t</DDTEXT>
 </DDLS></asx:values></asx:abap>
</abapGit>`;

function entityOf(source, name = "ZC_CAST") {
  const reg = new abaplint.Registry()
    .addFile(new abaplint.MemoryFile("ztest_cast.tabl.xml", TABLE))
    .addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.asddls`, source))
    .addFile(new abaplint.MemoryFile(`${name.toLowerCase()}.ddls.xml`, DDLS_XML(name)))
    .parse();
  const ddls = reg.getObjectsByType("DDLS").find((o) => o.getName().toUpperCase() === name);
  expect(ddls, "the fixture parsed as a DDLS").to.not.equal(undefined);
  return parseDDLS(ddls, reg);
}

describe("a cast in a CDS view is a column, not a dropped field", () => {
  it("keeps a cast over a real column, with the cast's type", () => {
    const e = entityOf(`@AbapCatalog.sqlViewName: 'ZVCAST'
define view ZC_CAST as select from ztest_cast {
  key port as Port,
      cast( protocol as abap.char( 10 ) ) as Proto,
      purpose as Purpose
}`);
    expect(e.skip, e.skip).to.equal(undefined);
    expect(e.fields.map((f) => f.name), "three elements, three fields")
      .to.deep.equal(["PORT", "PROTO", "PURPOSE"]);
    const proto = e.fields.find((f) => f.name === "PROTO");
    expect(proto.base, "the column underneath is still named, so the view reads it").to.equal("PROTOCOL");
    expect(proto.abapType, "and the type is the cast's, because that is what a cast is for").to.equal("c LENGTH 10");
  });

  it("a casted column can be the key, which is the symptom that was reported", () => {
    // "an entity keyed on it answers PortSet() with no key"
    const e = entityOf(`@AbapCatalog.sqlViewName: 'ZVCAST'
define view ZC_CAST as select from ztest_cast {
  key cast( port as abap.char( 5 ) ) as Port,
      purpose as Purpose
}`);
    expect(e.skip, e.skip).to.equal(undefined);
    expect(e.fields.filter((f) => f.key).map((f) => f.name), "the key survived the cast").to.deep.equal(["PORT"]);
  });

  it("a virtual element still goes down its own path, untouched", () => {
    const e = entityOf(`@AbapCatalog.sqlViewName: 'ZVCAST'
define view ZC_CAST as select from ztest_cast {
  key port as Port,
      @ObjectModel.virtualElement: true
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZCL_SOMETHING'
      cast( '' as abap.char( 12 ) ) as Computed
}`);
    expect(e.skip, e.skip).to.equal(undefined);
    const computed = e.fields.find((f) => f.name === "COMPUTED");
    expect(computed.virtual, "no column behind it").to.equal(true);
    expect(computed.calculatedBy).to.equal("ZCL_SOMETHING");
  });

  it("and a cast the generator cannot read is named, not dropped", () => {
    // the failure this defect had: silence. A constant column with no
    // virtualElement annotation is a decision nobody has taken, and saying so
    // is the difference between a gap and a disappearance
    const e = entityOf(`@AbapCatalog.sqlViewName: 'ZVCAST'
define view ZC_CAST as select from ztest_cast {
  key port as Port,
      cast( '' as abap.char( 12 ) ) as Constant
}`);
    expect(e.skip, "it says which element and why").to.match(/CONSTANT.*no column inside it/);
  });
});
