// A table parameter's schema comes from the class or from the dictionary,
// and a parameter neither can type is left alone rather than given an empty
// schema -- an empty schema is how a column becomes STRING.
import {expect} from "chai";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {relationSchemaOf, typedParameters} from "../tools/sqlscript/signature-schemas.mjs";
import {FolderDdic} from "../tools/sqlscript/folder-ddic.mjs";
import {localTypes} from "../tools/amdp-extract.mjs";

const dtel = (name, datatype, leng) => `<abapGit><asx:abap><asx:values><DD04V><ROLLNAME>${name}</ROLLNAME><DATATYPE>${datatype}</DATATYPE><LENG>${String(leng).padStart(6, "0")}</LENG><DECIMALS>000000</DECIMALS></DD04V></asx:values></asx:abap></abapGit>`;
const field = (name, element) => `<DD03P><FIELDNAME>${name}</FIELDNAME><ROLLNAME>${element}</ROLLNAME></DD03P>`;
const tabl = (name, rows) => `<abapGit><asx:abap><asx:values><DD02V><TABNAME>${name}</TABNAME></DD02V><DD03P_TABLE>${rows.join("")}</DD03P_TABLE></asx:values></asx:abap></abapGit>`;
const ttyp = (name, row) => `<abapGit><asx:abap><asx:values><DD40V><TYPENAME>${name}</TYPENAME><ROWTYPE>${row}</ROWTYPE><ROWKIND>S</ROWKIND></DD40V></asx:values></asx:abap></abapGit>`;

describe("the schema of a table parameter", () => {
  let dir;
  let store;
  const resolve = (name) => (name === "MANDT" ? {DATATYPE: "CLNT", LENG: 3, DECIMALS: 0} : undefined);
  const types = localTypes(`CLASS x DEFINITION.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row, k TYPE c LENGTH 4, n TYPE i, END OF ty_row.
    TYPES tt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    TYPES: BEGIN OF ty_dark, m TYPE mandt, z TYPE zunknown, END OF ty_dark.
    TYPES tt_dark TYPE STANDARD TABLE OF ty_dark WITH EMPTY KEY.
ENDCLASS.`);
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-signature-schemas-"));
    writeFileSync(join(dir, "mandt.dtel.xml"), dtel("MANDT", "CLNT", 3));
    writeFileSync(join(dir, "zid.dtel.xml"), dtel("ZID", "CHAR", 10));
    writeFileSync(join(dir, "zs_row.tabl.xml"), tabl("ZS_ROW", [field("MANDT", "MANDT"), field("ID", "ZID")]));
    writeFileSync(join(dir, "zt_rows.ttyp.xml"), ttyp("ZT_ROWS", "ZS_ROW"));
    writeFileSync(join(dir, "zt_orphan.ttyp.xml"), ttyp("ZT_ORPHAN", "ZS_NOWHERE"));
    store = new FolderDdic([dir]);
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("comes from the class when the class declares the type", () => {
    const got = relationSchemaOf("tt_rows", {types, store, resolve});
    expect(got.from).to.equal("class");
    expect(got.schema).to.deep.equal({K: {abap: "C", len: 4}, N: {abap: "I"}});
  });

  it("comes from the dictionary when the class does not: TTYP, its row TABL, each field's element", () => {
    const got = relationSchemaOf("zt_rows", {types, store, resolve: store.resolver()});
    expect(got.from).to.equal("ddic");
    expect(got.schema).to.deep.equal({MANDT: {abap: "C", len: 3}, ID: {abap: "C", len: 10}});
  });

  it("carries a column it cannot type as a marked one, refused when a body reads it, not when the table is present", () => {
    const got = relationSchemaOf("tt_dark", {types, store, resolve});
    expect(got.schema.M).to.deep.equal({abap: "C", len: 3});
    expect(got.schema.Z.abap).to.equal("UNRESOLVED");
    expect(got.schema.Z.reason).to.match(/ZUNKNOWN is not a data element/);
  });

  it("says why when it cannot, and gives no schema at all", () => {
    expect(relationSchemaOf("zt_orphan", {types, store}).reason).to.match(/row type ZS_NOWHERE/);
    expect(relationSchemaOf("zs_row", {types, store}).reason).to.match(/structure, not a table type/);
    expect(relationSchemaOf("zt_nothing", {types, store}).reason).to.match(/no DTEL, TABL or TTYP/);
  });

  it("knows a scalar when it sees one, with or without a dictionary", () => {
    expect(relationSchemaOf("i", {types, store})).to.deep.equal({scalar: true});
    expect(relationSchemaOf("abap.int4", {})).to.deep.equal({scalar: true});
    expect(relationSchemaOf("mandt", {types, store})).to.deep.equal({scalar: true});
  });

  it("types a whole signature: tables get their schema and kind, scalars their kind, the rest are left as they were", () => {
    const signature = {parameters: [
      {name: "it_rows", direction: "IN", abapType: "tt_rows"},
      {name: "iv_n", direction: "IN", abapType: "i"},
      {name: "it_dark", direction: "IN", abapType: "tt_dark"},
      {name: "et_out", direction: "OUT", abapType: "zt_rows"},
    ]};
    const {parameters, untyped} = typedParameters(signature, {types, store, resolve: store.resolver()});
    expect(parameters.map((p) => p.kind)).to.deep.equal(["table", "scalar", "table", "table"]);
    expect(parameters[3].schemaFrom).to.equal("ddic");
    expect(Object.keys(untyped)).to.deep.equal([]);
    const orphan = typedParameters({parameters: [{name: "it_x", direction: "IN", abapType: "zt_orphan"}]}, {types, store});
    expect(orphan.parameters[0].kind).to.equal(undefined);
    expect(Object.keys(orphan.untyped)).to.deep.equal(["IT_X"]);
  });
});
