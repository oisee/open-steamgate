// A method declared FOR TABLE FUNCTION has no signature in the class; the
// DDLS it names holds the parameters and the RETURNS list. Measured on the
// corpus 2026-09-22: 24 working bodies were "unknown scalar :p_sapclient"
// for exactly this reason, and reading the DDLS took them to lowered.
import {expect} from "chai";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseTableFunction} from "../tools/sqlscript/table-function-ddls.mjs";
import {extract} from "../tools/amdp-extract.mjs";
import {FolderDdic} from "../tools/sqlscript/folder-ddic.mjs";
import {signatureScalars} from "../tools/sqlscript/scalar-types.mjs";

const DDLS = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@ClientHandling.type: #CLIENT_DEPENDENT
@EndUserText.label: 'Model versions'
define table function P_X_TF
with parameters
    @Environment.systemField: #CLIENT
    p_clnt : mandt,
    p_guid : abap.raw(16), // the version
    p_limit: abap.int4
returns
 {
 key MANDT       : mandt;
     @EndUserText.quickInfo: 'Total runtime in seconds'
     runtime     : abap.dec( 20, 2 );
     parent_type : zde_otype;
}
implemented by method cl_x_impl=>get_versions
`;

describe("a CDS table function, read off its DDLS", () => {
  it("reads the parameters, the RETURNS list and the implementing method", () => {
    const tf = parseTableFunction(DDLS);
    expect(tf.name).to.equal("P_X_TF");
    expect(tf.parameters).to.deep.equal([
      {name: "p_clnt", direction: "IN", abapType: "mandt", systemField: "CLIENT"},
      {name: "p_guid", direction: "IN", abapType: "abap.raw(16)"},
      {name: "p_limit", direction: "IN", abapType: "abap.int4"},
    ]);
    expect(tf.returns.map((c) => [c.name, c.abapType, c.key])).to.deep.equal([
      ["MANDT", "mandt", true], ["runtime", "abap.dec( 20, 2 )", false], ["parent_type", "zde_otype", false],
    ]);
    expect(tf.implementedBy).to.deep.equal({class: "CL_X_IMPL", method: "GET_VERSIONS"});
  });

  it("keeps a quoted annotation value with // in it, and a record-valued annotation inside RETURNS", () => {
    const tf = parseTableFunction(`define table function P_Q
      with parameters
        @EndUserText.label: 'see http://help.example/x' // the docs
        p_a : abap.char(2)
      returns {
        @ObjectModel.text: { element: 'txt' }
        key a : abap.char(2); /* the key */
        txt   : abap.char(40);
      }`);
    expect(tf.parameters).to.deep.equal([{name: "p_a", direction: "IN", abapType: "abap.char(2)"}]);
    expect(tf.returns.map((c) => c.name)).to.deep.equal(["a", "txt"]);
  });

  it("reads one without parameters, and says no to a source that is not a table function", () => {
    const tf = parseTableFunction("define table function P_PLAIN returns { key a : abap.char(1); }");
    expect(tf.parameters).to.deep.equal([]);
    expect(tf.returns).to.have.length(1);
    expect(parseTableFunction("define view I_X as select from t { key a }")).to.equal(undefined);
  });

  it("types its parameters the way a method signature's are typed: CLIENT is a flag, not a binding", () => {
    const tf = parseTableFunction(DDLS);
    const resolve = (name) => (name === "MANDT" ? {DATATYPE: "CLNT", LENG: 3, DECIMALS: 0} : undefined);
    const {types, unresolved} = signatureScalars({parameters: tf.parameters}, resolve);
    expect(types).to.deep.equal({P_CLNT: {abap: "C", len: 3}, P_GUID: {abap: "X", len: 16}, P_LIMIT: {abap: "I"}});
    expect(unresolved).to.deep.equal({});
    expect(tf.parameters[0].systemField).to.equal("CLIENT");
  });
});

describe("the extractor names the DDLS of a FOR TABLE FUNCTION method", () => {
  const source = `CLASS cl_x_impl DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS get_versions FOR TABLE FUNCTION p_x_tf.
    CLASS-METHODS plain IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(et_rows) TYPE tt_rows.
ENDCLASS.
CLASS cl_x_impl IMPLEMENTATION.
  METHOD get_versions BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY USING zversions.
    return select mandt, 1 as runtime, otype as parent_type from zversions where mandt = :p_clnt;
  ENDMETHOD.
  METHOD plain BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    et_rows = select :iv_n as n from dummy;
  ENDMETHOD.
ENDCLASS.`;

  it("records the DDLS name on that method and nothing on the others", () => {
    const {methods} = extract(source, "cl_x_impl.clas.abap");
    const byName = Object.fromEntries(methods.map((m) => [m.name.toUpperCase(), m]));
    expect(byName.GET_VERSIONS.tableFunction).to.equal("P_X_TF");
    expect(byName.GET_VERSIONS.parameters).to.deep.equal([]);
    expect(byName.GET_VERSIONS.dbKind).to.equal("FUNCTION");
    expect(byName.PLAIN.tableFunction).to.equal(undefined);
    expect(byName.PLAIN.parameters.map((p) => p.name)).to.deep.equal(["iv_n", "et_rows"]);
  });
});

describe("the folder dictionary hands a DDLS back by name", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "osd-folder-ddls-"));
    writeFileSync(join(dir, "p_x_tf.ddls.asddls"), DDLS);
    writeFileSync(join(dir, "p_x_tf.ddls.xml"), "<abapGit/>");
  });
  after(() => rmSync(dir, {recursive: true, force: true}));

  it("indexes the source, not the XML beside it", () => {
    const ddic = new FolderDdic([dir]);
    expect(ddic.read("DDLS", "P_X_TF").source).to.equal(DDLS);
    expect(ddic.read("DDLS", "P_NOBODY")).to.equal(undefined);
  });
});
