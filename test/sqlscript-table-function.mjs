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
import {registryFromDdls, registryFromClass} from "../tools/sqlscript/table-function-registry.mjs";
import {localTypes, definitionsByText, definitionsDisagree} from "../tools/amdp-extract.mjs";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

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

describe("the registry of table functions a body may call", () => {
  const resolve = (name) => ({MANDT: {DATATYPE: "CLNT", LENG: 3, DECIMALS: 0}, ZDE_OTYPE: {DATATYPE: "CHAR", LENG: 2, DECIMALS: 0}})[name];

  it("registers a DDLS table function under its name and under the method that implements it", () => {
    let dir;
    dir = mkdtempSync(join(tmpdir(), "osd-tf-registry-"));
    try {
      writeFileSync(join(dir, "p_x_tf.ddls.asddls"), DDLS);
      writeFileSync(join(dir, "i_view.ddls.asddls"), "define view I_VIEW as select from t { key a }");
      const {registry, unreadable} = registryFromDdls(new FolderDdic([dir]), resolve);
      expect(unreadable).to.deep.equal([]);
      expect(Object.keys(registry).sort()).to.deep.equal(["CL_X_IMPL=>GET_VERSIONS", "P_X_TF"]);
      const fn = registry.P_X_TF;
      expect(fn.parameters.map((p) => [p.name, p.kind])).to.deep.equal([["P_CLNT", "scalar"], ["P_GUID", "scalar"], ["P_LIMIT", "scalar"]]);
      expect(fn.parameters[0].systemField).to.equal("CLIENT");
      expect(fn.returns.MANDT).to.deep.equal({abap: "C", len: 3});
      expect(fn.returns.PARENT_TYPE).to.deep.equal({abap: "C", len: 2});
      expect(fn.returns.RUNTIME).to.deep.equal({abap: "P", len: 20, dec: 2});
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it("registers an AMDP function of a class by CLASS=>METHOD, with its RETURNING type as the schema", () => {
    const source = `CLASS cl_util DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    TYPES: BEGIN OF ty_cfg, key TYPE c LENGTH 30, value TYPE string, END OF ty_cfg.
    TYPES tt_cfg TYPE STANDARD TABLE OF ty_cfg WITH EMPTY KEY.
    CLASS-METHODS convert_configuration IMPORTING VALUE(it_configuration) TYPE tt_cfg VALUE(iv_convert) TYPE i DEFAULT 0 RETURNING VALUE(rt_configuration) TYPE tt_cfg.
    CLASS-METHODS count_rows IMPORTING VALUE(it_configuration) TYPE tt_cfg RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.
CLASS cl_util IMPLEMENTATION.
  METHOD convert_configuration BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    return select key, value from :it_configuration;
  ENDMETHOD.
  METHOD count_rows BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    return select count(*) from :it_configuration;
  ENDMETHOD.
ENDCLASS.`;
    const {className, methods, types} = extract(source, "cl_util.clas.abap");
    const {registry, skipped} = registryFromClass(className, methods, {types, resolve});
    expect(Object.keys(registry)).to.deep.equal(["CL_UTIL=>CONVERT_CONFIGURATION"]);
    const fn = registry["CL_UTIL=>CONVERT_CONFIGURATION"];
    expect(fn.parameters.map((p) => [p.name, p.kind, p.optional])).to.deep.equal([["IT_CONFIGURATION", "table", undefined], ["IV_CONVERT", "scalar", true]]);
    expect(fn.returns).to.deep.equal({KEY: {abap: "C", len: 30}, VALUE: {abap: "STRING"}});
    expect(skipped).to.deep.equal(["CL_UTIL=>COUNT_ROWS: returns a scalar"]);
  });
});

describe("method definitions read as text, when abaplint hands back no class definition", () => {
  it("reads the four parameter sections, VALUE and REFERENCE, OPTIONAL and DEFAULT, and skips table-function and bare methods", () => {
    const defs = definitionsByText(`CLASS x DEFINITION. PUBLIC SECTION.
  class-methods BUILD IMPORTING value(IT_CONFIGURATION) type ISLM_T_ENG_CONTEXT_CONFIG
    value(IV_N) type i default 0 optional " a comment, with IMPORTING in it
    returning value(ET_CONFIG_EXT) type ISLM_T_EXT .
  METHODS plain.
  CLASS-METHODS tf FOR TABLE FUNCTION p_x.
* METHODS commented_out IMPORTING iv_x TYPE i.
  METHODS two IMPORTING iv_a TYPE string iv_b TYPE c LENGTH 10 CHANGING cv_c TYPE i EXPORTING et_rows TYPE tt_rows RAISING cx_x.
ENDCLASS.`);
    expect([...defs.keys()]).to.deep.equal(["BUILD", "TWO"]);
    const chained = definitionsByText(`CLASS-METHODS:
      a IMPORTING VALUE(iv_a) TYPE sy-mandt VALUE(iv_b) TYPE spfli-carrid EXPORTING et TYPE tt_x,
      b AMDP OPTIONS READ-ONLY CDS SESSION CLIENT clnt IMPORTING VALUE(clnt) TYPE sy-mandt EXPORTING VALUE(rows) TYPE tt_rows RAISING cx_amdp_error,
      c FOR TABLE FUNCTION p_x.`);
    expect([...chained.keys()]).to.deep.equal(["A", "B"]);
    expect(chained.get("A").map((p) => [p.name, p.abapType])).to.deep.equal([["iv_a", "sy-mandt"], ["iv_b", "spfli-carrid"], ["et", "tt_x"]]);
    expect(chained.get("B").map((p) => [p.name, p.direction, p.abapType])).to.deep.equal([["clnt", "IN", "sy-mandt"], ["rows", "OUT", "tt_rows"]]);
    expect(defs.get("BUILD").map((p) => [p.name, p.direction, p.abapType, p.optional])).to.deep.equal([
      ["IT_CONFIGURATION", "IN", "ISLM_T_ENG_CONTEXT_CONFIG", false], ["IV_N", "IN", "i", true], ["ET_CONFIG_EXT", "RETURNING", "ISLM_T_EXT", false]]);
    expect(defs.get("TWO").map((p) => [p.name, p.direction, p.abapType])).to.deep.equal([
      ["iv_a", "IN", "string"], ["iv_b", "IN", "c LENGTH 10"], ["cv_c", "INOUT", "i"], ["et_rows", "OUT", "tt_rows"]]);
  });

  it("is what extract() falls back to for a class abaplint cannot read, so the body's IN table is not an unknown variable", () => {
    // a USING list of CLASS=>METHOD names over several lines is what abaplint
    // stops on in the ISLM classes; the definition above it is plain ABAP
    const source = `CLASS cl_apl DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS build IMPORTING VALUE(it_configuration) TYPE tt_cfg RETURNING VALUE(et_ext) TYPE tt_ext.
ENDCLASS.
CLASS cl_apl IMPLEMENTATION.
  METHOD build BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY
  USING cl_util=>convert_configuration
        cl_other=>get_model_algorithm.
    declare lv_x integer;
    return select key, value from "CL_UTIL=>CONVERT_CONFIGURATION"(:it_configuration);
  ENDMETHOD.
ENDCLASS.`;
    const {methods} = extract(source, "cl_apl.clas.abap");
    expect(methods[0].parameters.map((p) => [p.name, p.direction, p.abapType])).to.deep.equal([["it_configuration", "IN", "tt_cfg"], ["et_ext", "RETURNING", "tt_ext"]]);
    expect(methods[0].usings).to.deep.equal(["cl_util=>convert_configuration", "cl_other=>get_model_algorithm"]);
  });
});

describe("the text reader, checked against abaplint where abaplint reads the class", () => {
  it("agrees with abaplint on every method of the extractor's own fixture class", () => {
    const source = readFileSync(fileURLToPath(new URL("fixtures/amdp/zcl_vsp_00_amdp_test.clas.abap.txt", import.meta.url)), "utf8");
    const {compared, differing} = definitionsDisagree(source, "zcl_vsp_00_amdp_test.clas.abap");
    expect(compared).to.be.greaterThan(0);
    expect(differing).to.deep.equal([]);
  });

  it("marks where a signature came from, and compares nothing on a class abaplint could not read", () => {
    // the implementation-side clause drops the whole class definition; the
    // second, plain method is what makes abaplint still find one body
    const source = `CLASS cl_apl DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS build IMPORTING VALUE(it_configuration) TYPE tt_cfg RETURNING VALUE(et_ext) TYPE tt_ext.
    CLASS-METHODS plain IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(et_rows) TYPE tt_rows.
ENDCLASS.
CLASS cl_apl IMPLEMENTATION.
  METHOD build BY DATABASE FUNCTION FOR HDB LANGUAGE SQLSCRIPT OPTIONS SUPPRESS SYNTAX ERRORS.
    return select key, value from :it_configuration;
  ENDMETHOD.
  METHOD plain BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    et_rows = select :iv_n as n from dummy;
  ENDMETHOD.
ENDCLASS.`;
    const parsed = extract(source, "cl_apl.clas.abap");
    expect(parsed.definitionSource).to.equal("text");
    const plainMethod = parsed.methods.find((m) => /plain/i.test(m.name));
    expect(plainMethod.signatureSource).to.equal("text");
    expect(plainMethod.parameters.map((p) => p.name)).to.deep.equal(["iv_n", "et_rows"]);
    expect(definitionsDisagree(source, "cl_apl.clas.abap")).to.deep.equal({compared: 0, differing: []});
    const fixed = extract(source.replace("OPTIONS SUPPRESS SYNTAX ERRORS", "OPTIONS READ-ONLY"), "cl_apl.clas.abap");
    expect(fixed.definitionSource).to.equal("abaplint");
    expect(fixed.methods.map((m) => m.signatureSource)).to.deep.equal(["abaplint", "abaplint"]);
  });

  it("takes the text reader for one method abaplint dropped from a definition it otherwise read, and says so", () => {
    const source = `CLASS cl_opt DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_amdp_marker_hdb.
    CLASS-METHODS with_options AMDP OPTIONS READ-ONLY IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(et_rows) TYPE tt_rows.
    CLASS-METHODS plain IMPORTING VALUE(iv_n) TYPE i EXPORTING VALUE(et_rows) TYPE tt_rows.
ENDCLASS.
CLASS cl_opt IMPLEMENTATION.
  METHOD with_options BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    et_rows = select :iv_n as n from dummy;
  ENDMETHOD.
  METHOD plain BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.
    et_rows = select :iv_n as n from dummy;
  ENDMETHOD.
ENDCLASS.`;
    const parsed = extract(source, "cl_opt.clas.abap");
    expect(parsed.definitionSource).to.equal("abaplint");
    const byName = Object.fromEntries(parsed.methods.map((m) => [m.name.toUpperCase(), m]));
    expect(byName.WITH_OPTIONS.signatureSource).to.equal("text");
    expect(byName.WITH_OPTIONS.parameters.map((p) => p.name)).to.deep.equal(["iv_n", "et_rows"]);
    expect(byName.PLAIN.signatureSource).to.equal("abaplint");
    // and the cross-check compares only what abaplint read
    expect(definitionsDisagree(source, "cl_opt.clas.abap")).to.deep.equal({compared: 1, differing: []});
  });
});
