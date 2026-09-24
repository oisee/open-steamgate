// The corpus oracle's pure half (tools/amdp-corpus-oracle.mjs): the kernel's
// form of a created procedure, the DDIC -> HANA type map, the reading of the
// shapes taken off a system, and the sorting of HANA's refusals. No HANA and
// no corpus here: a clean-room class over SFLIGHT's shapes.
import {expect} from "chai";
import {typesOfSource, createStatement, hanaOfDdic, TypeGap, classify, missingObject, libraryAbsent,
  readCatalog, readExtraDdic, defaultClause, withoutAbapCommentLines} from "../tools/amdp-corpus-oracle.mjs";

const SOURCE = `CLASS zcl_flight_demo DEFINITION PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             carrid TYPE c LENGTH 3,
             seatsmax TYPE i,
           END OF ty_row,
           tt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    TYPES ty_name TYPE c LENGTH 20.
ENDCLASS.`;

const body = (parameters, text, extra = {}) => ({
  className: "ZCL_FLIGHT_DEMO",
  types: typesOfSource(SOURCE),
  signature: {name: "RUN", language: "SQLSCRIPT", readOnly: true, parameters, body: text, ...extra},
  body: text,
});

describe("the corpus oracle: the kernel's form of a created procedure", () => {
  it("removes a `*` line as the kernel does, but not inside a block comment or a string", () => {
    expect(withoutAbapCommentLines("* note\nx = 1;\n")).to.equal("\nx = 1;\n");
    // A4H kept the `*/` in column one that closes a block comment
    expect(withoutAbapCommentLines("/*\n  old code;\n*/\ny = 2;")).to.equal("/*\n  old code;\n*/\ny = 2;");
    expect(withoutAbapCommentLines("s = 'a\n* b';\n* gone\n")).to.equal("s = 'a\n* b';\n\n");
    expect(withoutAbapCommentLines("x = 1; -- a /* in a line comment\n* gone\n")).to.equal("x = 1; -- a /* in a line comment\n\n");
  });

    it("writes an IN parameter's DEFAULT as the kernel does: the literal quoted, an optional table EMPTY", () => {
    // read off generated procedures on A4H: DEFAULT 1 on an INTEGER is
    // DEFAULT '1'; an optional table is DEFAULT EMPTY
    const sql = createStatement(body([
      {name: "iv_top", direction: "IN", abapType: "i", default: "1"},
      {name: "iv_flag", direction: "IN", abapType: "ty_name", default: "'X'"},
      {name: "it_rows", direction: "IN", abapType: "tt_rows", optional: true},
      {name: "iv_plain", direction: "IN", abapType: "i"},
      {name: "et_rows", direction: "OUT", abapType: "tt_rows"},
    ], "et_rows = SELECT * FROM :it_rows;"), undefined);
    expect(sql).to.contain("IN iv_top INTEGER DEFAULT '1'");
    expect(sql).to.contain("IN iv_flag NVARCHAR(20) DEFAULT 'X'");
    expect(sql).to.contain('IN it_rows TABLE ("CARRID" NVARCHAR(3), "SEATSMAX" INTEGER) DEFAULT EMPTY');
    expect(sql).to.contain("IN iv_plain INTEGER,");
    expect(sql).not.to.match(/et_rows[^,)]*DEFAULT/);
    // an optional OUT with a default gets none: DEFAULT is an input's
    const out = createStatement(body([
      {name: "ev_n", direction: "OUT", abapType: "i", optional: true, default: "1"},
    ], "ev_n = 1;"), undefined);
    expect(out).not.to.contain("DEFAULT");
    // a constant or a system field is not measured: no DEFAULT at all
    expect(defaultClause({default: "abap_true"}, "NVARCHAR(1)")).to.equal("");
    expect(defaultClause({default: "sy-datum"}, "NVARCHAR(8)")).to.equal("");
  });

  it("reads chained TYPES, a table of a structure and a scalar alias", () => {
    const types = typesOfSource(SOURCE);
    expect(types.get("TY_ROW")).to.deep.include({kind: "structure"});
    expect(types.get("TT_ROWS")).to.deep.equal({kind: "table", of: "TY_ROW"});
    expect(types.get("TY_NAME")).to.deep.equal({kind: "alias", of: "c LENGTH 20"});
  });

  it("writes a CHANGING table as IN X__IN__ and OUT X with the copy, the body in a block of its own", () => {
    const sql = createStatement(body([
      {name: "iv_name", direction: "IN", abapType: "ty_name"},
      {name: "ct_rows", direction: "INOUT", abapType: "tt_rows"},
    ], "* an ABAP comment line\n  ct_rows = SELECT * FROM :ct_rows;"), undefined);
    const table = 'TABLE ("CARRID" NVARCHAR(3), "SEATSMAX" INTEGER)';
    expect(sql).to.contain(`IN iv_name NVARCHAR(20)`);
    expect(sql).to.contain(`IN "CT_ROWS__IN__" ${table}, OUT "CT_ROWS" ${table}`);
    const lines = sql.split("\n");
    const as = lines.indexOf("AS BEGIN");
    expect(lines[as + 1]).to.equal('"CT_ROWS" = SELECT * FROM :"CT_ROWS__IN__";');
    expect(lines[as + 2]).to.equal("BEGIN");
    expect(lines.at(-2)).to.equal("END;");
    expect(lines.at(-1)).to.equal("END");
    // the kernel removes a full-line ABAP comment before HANA sees the body
    expect(sql).not.to.contain("an ABAP comment");
  });

  it("puts the HANA type in place of $ABAP.type( ... )", () => {
    const sql = createStatement(body([{name: "et", direction: "OUT", abapType: "tt_rows"}],
      "DECLARE lv_name $ABAP.type( ty_name );\n  et = SELECT 'LH' AS carrid, 1 AS seatsmax FROM dummy;"), undefined);
    expect(sql).to.contain("DECLARE lv_name NVARCHAR(20);");
    expect(sql).not.to.match(/\$ABAP/i);
  });

  it("returns a table from a function as RETURNS TABLE (...), a scalar as RETURNS name type", () => {
    const tableFn = createStatement(body([{name: "rt", direction: "RETURNING", abapType: "tt_rows"}],
      "RETURN SELECT 'LH' AS carrid, 1 AS seatsmax FROM dummy;", {dbKind: "FUNCTION"}), undefined);
    expect(tableFn).to.match(/RETURNS TABLE \("CARRID" NVARCHAR\(3\), "SEATSMAX" INTEGER\)/);
    const scalarFn = createStatement(body([{name: "rv", direction: "RETURNING", abapType: "i"}],
      "rv = 1;", {dbKind: "FUNCTION"}), undefined);
    expect(scalarFn).to.contain("RETURNS rv INTEGER");
  });
});

describe("the corpus oracle: DDIC types as the kernel creates them on HANA", () => {
  for (const [ddic, hana] of [
    [{DATATYPE: "CHAR", LENG: 3}, "NVARCHAR(3)"], [{DATATYPE: "NUMC", LENG: 4}, "NVARCHAR(4)"],
    [{DATATYPE: "DATS", LENG: 8}, "NVARCHAR(8)"], [{DATATYPE: "CLNT", LENG: 3}, "NVARCHAR(3)"],
    [{DATATYPE: "INT4"}, "INTEGER"], [{DATATYPE: "INT2"}, "SMALLINT"], [{DATATYPE: "INT1"}, "TINYINT"],
    [{DATATYPE: "CURR", LENG: 15, DECIMALS: 2}, "DECIMAL(15, 2)"], [{DATATYPE: "STRG"}, "NCLOB"],
    [{DATATYPE: "RAW", LENG: 16}, "VARBINARY(16)"], [{DATATYPE: "FLTP"}, "DOUBLE"],
  ]) {
    it(`${ddic.DATATYPE} is ${hana}`, () => expect(hanaOfDdic(ddic)).to.equal(hana));
  }
  it("refuses a type it has no mapping for, and a CHAR without a length", () => {
    expect(() => hanaOfDdic({DATATYPE: "GEOM_EWKB"})).to.throw(TypeGap);
    expect(() => hanaOfDdic({DATATYPE: "CHAR", LENG: 0})).to.throw(TypeGap);
  });
});

describe("the corpus oracle: shapes read off a system, and HANA's refusals sorted", () => {
  it("reads the catalog's lines, a + line continuing the one before, an empty object kept out", () => {
    const catalog = readCatalog("T:SCARR:MANDT/NVARCHAR/3/0;CARRID/NVARCHAR/3/0;CARRNA\n+ME/NVARCHAR/20/0;PRICE/DECIMAL/15/2;\nT:NOTHING:\n");
    expect(catalog.get("SCARR")).to.deep.equal([
      {name: "MANDT", type: "NVARCHAR(3)"}, {name: "CARRID", type: "NVARCHAR(3)"},
      {name: "CARRNAME", type: "NVARCHAR(20)"}, {name: "PRICE", type: "DECIMAL(15, 2)"}]);
    expect(catalog.has("NOTHING")).to.equal(false);
  });

  it("reads elements, table types, structures and domains", () => {
    const extra = readExtraDdic([
      "E:S_CARR_ID:CHAR/000003/000000/S_CARR_ID",
      "Y:TT_SCARR:SCARR/S/STRU/000000/000000",
      "S:SCARR:MANDT/CLNT/000003/000000/MANDT;CARRID/CHAR/000003/000000/S_CARR_ID;.INCLUDE//0/0/;",
      "+CARRNAME/CHAR/000020/000000/S_CARRNAME;",
      "D:S_CARR_ID:CHAR/000003/000000",
    ].join("\n"));
    expect(extra.elements.get("S_CARR_ID")).to.include({DATATYPE: "CHAR", LENG: 3});
    expect(extra.ttyp.get("TT_SCARR")).to.equal("SCARR");
    expect(extra.struct.get("SCARR").map((f) => f.NAME)).to.deep.equal(["MANDT", "CARRID", "CARRNAME"]);
    expect(extra.doms.get("S_CARR_ID")).to.include({DATATYPE: "CHAR"});
  });

  it("names what is missing, and sorts each refusal by whose fault it is", () => {
    expect(missingObject("invalid table name:  Could not find table/view SCARR in schema OSD_CORPUS: line 3 col 10"))
      .to.deep.equal({kind: "table", name: "SCARR"});
    expect(missingObject("invalid name of function or procedure: ZCL_FLIGHT_DEMO=>RUN: line 5 col 3").kind).to.equal("routine");
    // HXE's longer form names the routine after "no procedure with name"
    expect(missingObject("invalid name of function or procedure: no procedure with name ZCL_FLIGHT_DEMO=>RUN found: line 5 col 3"))
      .to.deep.equal({kind: "routine", name: "ZCL_FLIGHT_DEMO=>RUN"});
    expect(missingObject('invalid name of function or procedure: no procedure with name "OSD_CORPUS"."ZCL_FLIGHT_DEMO=>RUN" found: line 5 col 3'))
      .to.deep.equal({kind: "routine", name: "ZCL_FLIGHT_DEMO=>RUN"});
    expect(classify("invalid table name:  Could not find table/view SCARR in schema X: line 3 col 10")).to.equal("missing");
    expect(classify("invalid schema name: ANOTHER: line 9 col 2")).to.equal("missing");
    expect(classify("invalid column name: CARRNAME: line 12 col 4")).to.equal("shape");
    expect(classify("inconsistent datatype: lhs and rhs: line 12 col 4")).to.equal("shape");
    // within the head we wrote: the signature, not the body
    expect(classify("sql syntax error: incorrect syntax near \"TABLE\": line 2 col 18", 5)).to.equal("signature");
    expect(classify("sql syntax error: incorrect syntax near \"FOR\": line 9 col 3", 5)).to.equal("hxe-refuses");
    expect(classify("something nobody expected")).to.equal("other");
  });

  it("takes a body that needs an absent library out of the other classes, and every body that calls one", () => {
    const refused = [
      // the roots: a table type of APL in the head, a UMML schema in the body
      {key: "ZCL_A=>ROOT#1", routine: "ZCL_A=>ROOT", message: "invalid datatype: unknown type SAP_PA_APL.sap.pa.apl.base::BASE.T.X: line 6 col 40"},
      {key: "ZCL_U=>READ#2", routine: "ZCL_U=>READ", message: "invalid schema name: SAP_HANA_UMML_ENGINE_STATIC: line 13 col 10"},
      // a caller, and its caller: missing routines that are roots
      {key: "ZCL_B=>MID#3", routine: "ZCL_B=>MID", message: "invalid name of function or procedure: no procedure with name ZCL_A=>ROOT found",
        missing: {kind: "routine", name: "ZCL_A=>ROOT"}},
      {key: "ZCL_C=>TOP#4", routine: "ZCL_C=>TOP", message: "...", missing: {kind: "routine", name: "zcl_b=>mid"}},
      // not this: a routine missing for another reason, and another schema
      {key: "ZCL_D=>OTHER#5", routine: "ZCL_D=>OTHER", message: "...", missing: {kind: "routine", name: "ZCL_E=>GONE"}},
      {key: "ZCL_F=>REPO#6", routine: "ZCL_F=>REPO", message: "invalid schema name: SOMETHING_ELSE: line 1 col 1"},
      // a table or a procedure inside the library's own schema is a root too
      {key: "ZCL_G=>TAB#7", routine: "ZCL_G=>TAB", message: "invalid table name:  Could not find table/view X in schema SAP_PA_APL: line 3 col 10"},
      {key: "ZCL_H=>CALL#8", routine: "ZCL_H=>CALL", message: 'invalid name of function or procedure: no procedure with name "SAP_PA_APL"."sap.pa.apl.base::PING" found'},
    ];
    expect([...libraryAbsent(refused)].sort()).to.deep.equal(["ZCL_A=>ROOT#1", "ZCL_B=>MID#3", "ZCL_C=>TOP#4", "ZCL_G=>TAB#7", "ZCL_H=>CALL#8", "ZCL_U=>READ#2"]);
  });
});

describe("the corpus oracle: a signature declared elsewhere", () => {
  it("takes a REDEFINITION's parameters from the superclass, and an interface method's from the interface", async () => {
    const {inheritedSignatures} = await import("../tools/sqlscript/coverage.mjs");
    const classSources = new Map([
      ["ZCL_CHILD", `CLASS zcl_child DEFINITION INHERITING FROM zcl_mid.
  PUBLIC SECTION.
    METHODS get_max FINAL REDEFINITION.
    INTERFACES zif_exit.
ENDCLASS.`],
      ["ZCL_MID", "CLASS zcl_mid DEFINITION INHERITING FROM zcl_base ABSTRACT.\nENDCLASS."],
      ["ZCL_BASE", `CLASS zcl_base DEFINITION ABSTRACT.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row, id TYPE i, END OF ty_row,
           tt_rows TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    METHODS get_max ABSTRACT
      IMPORTING VALUE(iv_id) TYPE i VALUE(it_rows) TYPE tt_rows
      EXPORTING VALUE(ev_max) TYPE i.
ENDCLASS.`],
    ]);
    const interfaceSources = new Map([["ZIF_EXIT", `INTERFACE zif_exit PUBLIC.
  METHODS process IMPORTING VALUE(iv_name) TYPE string EXPORTING VALUE(ev_value) TYPE string.
ENDINTERFACE.`]]);
    const bodies = [
      {className: "ZCL_CHILD", signature: {name: "get_max", parameters: []}, types: new Map([["TY_ROW", {kind: "structure", components: [{name: "own", abapType: "i"}]}]])},
      {className: "ZCL_CHILD", signature: {name: "zif_exit~process", parameters: []}, types: new Map()},
      {className: "ZCL_CHILD", signature: {name: "not_declared_anywhere", parameters: []}, types: new Map()},
    ];
    expect(inheritedSignatures(bodies, classSources, interfaceSources)).to.equal(2);
    expect(bodies[0].signature.parameters.map((p) => [p.name.toUpperCase(), p.direction])).to.deep.equal([["IV_ID", "IN"], ["IT_ROWS", "IN"], ["EV_MAX", "OUT"]]);
    expect(bodies[0].signature.signatureSource).to.equal("superclass");
    expect([bodies[0].types.has("TY_ROW"), bodies[0].types.has("TT_ROWS")]).to.deep.equal([true, true]);
    // the class's own type wins a name it shares with an ancestor
    expect(bodies[0].types.get("TY_ROW").components[0].name).to.equal("own");
    expect(bodies[1].signature.parameters.map((p) => p.name.toUpperCase())).to.deep.equal(["IV_NAME", "EV_VALUE"]);
    expect(bodies[1].signature.signatureSource).to.equal("interface");
    expect(bodies[2].signature.parameters).to.deep.equal([]);
  });
});

describe("the corpus oracle: type texts it reads", () => {
  it("reads the old length form of a component and of an alias, `x(2) TYPE n` and `x(10)`", () => {
    const types = typesOfSource(`CLASS zcl_old DEFINITION.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_s,
             priority(2) TYPE n,
             label(10),
           END OF ty_s,
           ty_code(4) TYPE c.
ENDCLASS.`);
    expect(types.get("TY_S").components).to.deep.equal([{name: "priority", abapType: "n LENGTH 2"}, {name: "label", abapType: "c LENGTH 10"}]);
    expect(types.get("TY_CODE")).to.deep.equal({kind: "alias", of: "c LENGTH 4"});
  });

  it("types a `struct-field` parameter by the component, and an `if_x=>ty` one by the interface", () => {
    const sql = createStatement(body([
      {name: "iv_carrid", direction: "IN", abapType: "ty_row-carrid"},
      {name: "et_rows", direction: "OUT", abapType: "tt_rows"},
    ], "et_rows = SELECT * FROM :et_rows;"), undefined);
    expect(sql).to.contain("IN iv_carrid NVARCHAR(3)");
  });
});

describe("the corpus oracle: a type the owner declares hides the dictionary's", () => {
  const SRC = `CLASS zcl_mine DEFINITION.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row,
             amt(8) TYPE p DECIMALS 2,
             code(2) TYPE n,
             raw(4) TYPE x,
             sub TYPE ty_other,
           END OF ty_row,
           ty_n(2) TYPE n,
           ty_p(8) TYPE p DECIMALS 2.
ENDCLASS.`;
  // a dictionary holding an object of the same name, with other fields
  const store = {
    lookup: () => undefined,
    resolver: () => () => undefined,
  };
  const types = typesOfSource(SRC);
  const typed = (t) => createStatement({className: "ZCL_MINE", types, signature: {name: "RUN", language: "SQLSCRIPT", parameters: [{name: "iv", direction: "IN", abapType: t}], body: "x"}, body: "x"}, undefined).split("\n")[0];

  it("reads the old length form with DECIMALS, for a component and an alias, and n, x, p", () => {
    expect(types.get("TY_ROW").components.slice(0, 3)).to.deep.equal([
      {name: "amt", abapType: "p LENGTH 8 DECIMALS 2"}, {name: "code", abapType: "n LENGTH 2"}, {name: "raw", abapType: "x LENGTH 4"}]);
    expect(types.get("TY_N")).to.deep.equal({kind: "alias", of: "n LENGTH 2"});
    expect(typed("ty_p")).to.contain("IN iv DECIMAL(15, 2)");
    expect(typed("ty_row-amt")).to.contain("IN iv DECIMAL(15, 2)");
    expect(typed("ty_row-raw")).to.contain("IN iv VARBINARY(4)");
  });

  it("refuses a component the owner's structure lacks, or does not read, rather than ask the dictionary", () => {
    expect(() => typed("ty_row-nope")).to.throw(/component NOPE of TY_ROW is not there/);
    expect(() => typed("ty_row-sub-f")).to.throw();
  });
});

describe("the corpus oracle: another owner's types, through `=>`", () => {
  it("reads if_x=>ty and if_x=>ty_s-f from the interface, and says so when the owner lacks the type", async () => {
    const {mkdtempSync, writeFileSync, rmSync} = await import("node:fs");
    const {tmpdir} = await import("node:os");
    const {join} = await import("node:path");
    const {readOwnerTypes} = await import("../tools/amdp-corpus-oracle.mjs");
    const dir = mkdtempSync(join(tmpdir(), "osd-owner-"));
    try {
      writeFileSync(join(dir, "zif_osd_x.intf.abap"), `INTERFACE zif_osd_x PUBLIC.
  TYPES: BEGIN OF ty_s, code TYPE c LENGTH 4, n TYPE i, END OF ty_s,
         ty_code TYPE c LENGTH 7.
ENDINTERFACE.`);
      readOwnerTypes([dir]);
      const typed = (t) => createStatement({className: "ZCL_Y", types: new Map(), signature: {name: "RUN", language: "SQLSCRIPT", parameters: [{name: "iv", direction: "IN", abapType: t}], body: "x"}, body: "x"}, undefined).split("\n")[0];
      expect(typed("zif_osd_x=>ty_code")).to.contain("IN iv NVARCHAR(7)");
      expect(typed("zif_osd_x=>ty_s-code")).to.contain("IN iv NVARCHAR(4)");
      expect(() => typed("zif_osd_x=>ty_missing")).to.throw(/ZIF_OSD_X has no type TY_MISSING here/);
      expect(() => typed("zif_osd_x=>ty_s-nope")).to.throw(/component NOPE of ZIF_OSD_X=>TY_S is not there/);
    } finally { rmSync(dir, {recursive: true, force: true}); }
  });
});
