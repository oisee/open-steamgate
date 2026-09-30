// Recipe R1 end to end (recipes/r1-lookup-enrich/): the model comes out of
// BEFORE by tools/lift.mjs, the ABAP template engine renders AFTER from it,
// the rendered text is the generated region of ZCL_OSD_LIFT_R1_DEMO, and the
// two methods are run on the same rows while the database calls are counted.
// Equality of the rows is ABAP Unit's job (the class's own test class, which
// runs on a system as well); what only the host can see is the cost.
import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DEFAULT_DDIC, find, modelR1, modelR1FromSource} from "../tools/lift.mjs";
import {region} from "../tools/dsl-regions.mjs";

const DEMO = "src/lift/zcl_osd_lift_r1_demo.clas.abap";
const TEMPLATE = "recipes/r1-lookup-enrich/template.tpl";

describe("verified lift R1: lookup-enrich", function () {
  this.timeout(60000);
  let abap;
  const box = (value) => new abap.types.String().set(value);

  before(async () => {
    await import("./start.mjs");
    abap = globalThis.abap;
    await import("../output/zcl_osd_tpl.clas.mjs");
    await import("../output/zcl_ajson.clas.mjs");
    await import("../output/zcl_osd_lift_r1_demo.clas.mjs");
  });

  async function render(model) {
    const data = await abap.Classes.ZCL_AJSON.parse({iv_json: box(JSON.stringify(model))});
    const result = await abap.Classes.ZCL_OSD_TPL.render({iv_template: box(readFileSync(TEMPLATE, "utf8")), ii_data: data});
    return {
      text: (await abap.Classes.ZCL_OSD_TPL.to_string({is_result: result})).get(),
      trace: result.get().trace.array().map((t) => ({
        line: t.get().line.get(), template_line: t.get().template_line.get(), path: t.get().path.get()})),
    };
  }

  it("the model is read out of BEFORE, the key checked against the DDIC", () => {
    const model = modelR1(DEMO, "before");
    expect(model.source).to.deep.equal({
      table: "zosd_lift_txt",
      keys: [{column: "kind", component: "kind"}, {column: "code", component: "code"}],
    });
    expect(model.fields).to.deep.equal([{column: "text", component: "text"}]);
  });

  // One method per boundary of the shape; each must be refused by the named
  // obligation. The table of the fixtures is the demo's (kind, code key).
  const fixture = (body, declarations = "", parameters = "") => `CLASS zcl_fx DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_row, kind TYPE c LENGTH 4, code TYPE c LENGTH 10, text TYPE c LENGTH 40, END OF ty_row.
    TYPES tt_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    CLASS-METHODS m ${parameters}CHANGING ct_rows TYPE tt_rows.
ENDCLASS.
CLASS zcl_fx IMPLEMENTATION.
  METHOD m.
    FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.
${declarations}    LOOP AT ct_rows ASSIGNING <ls_row>.
${body}
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.`;
  const SELECT = "      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE";
  const refusals = [
    ["a partial key", `${SELECT} kind = <ls_row>-kind.`, "", /^full key: WHERE names kind/],
    ["an extra condition", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code AND text = <ls_row>-text.`, "", /^full key: /],
    ["OR", `${SELECT} kind = <ls_row>-kind OR code = <ls_row>-code.`, "", /^full key: /],
    ["a literal", `${SELECT} kind = 'STAT' AND code = <ls_row>-code.`, "", /^full key: /],
    ["INTO CORRESPONDING", "      SELECT SINGLE text FROM zosd_lift_txt INTO CORRESPONDING FIELDS OF <ls_row> WHERE kind = <ls_row>-kind AND code = <ls_row>-code.", "", /^shape: /],
    ["a second SELECT", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.\n      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE kind = <ls_row>-kind AND code = <ls_row>-code.`, "", /^no other database statement in the loop: /],
    ["a nested loop", `      LOOP AT ct_rows TRANSPORTING NO FIELDS WHERE kind = 'X'.\n      ENDLOOP.`, "", /^shape: /],
    ["lt_lookup taken", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, "    DATA lt_lookup TYPE i.\n", /^names: lt_lookup/],
    ["lt_lookup as a parameter", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, "", /^names: lt_lookup/, "IMPORTING lt_lookup TYPE i OPTIONAL "],
    ["<ls_lookup> taken", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, "    FIELD-SYMBOLS <ls_lookup> TYPE any.\n", /^names: <ls_lookup>/],
    ["the shape rewritten already", null, null, /^names: lt_lookup/],
    ["a method that is not there", "", "", /^shape: no method absent/, "", "absent"],
  ];
  for (const [what, body, declarations, reason, parameters, method = "m"] of refusals) {
    it(`R1 refuses ${what}, naming the obligation`, () => {
      const run = body === null
        ? () => modelR1(DEMO, "after")
        : () => modelR1FromSource("zcl_fx.clas.abap", fixture(body, declarations, parameters), method);
      expect(run).to.throw(reason);
    });
  }

  it("R1b keeps the SELECT's body position", () => {
    const model = modelR1(DEMO, "before_mixed");
    expect(model.recipe).to.equal("R1b");
    expect(model.position).to.equal(1);
    expect(model.before.map((s) => s.text)).to.deep.equal(["ADD 1 TO <ls_row>-visits."]);
    expect(model.after.map((s) => s.text)).to.deep.equal(["MOVE sy-subrc TO <ls_row>-status."]);
    expect(model.open).to.include("prefetch may read keys the loop skips");
  });

  for (const [what, body, reason] of [
    ["key written before", `      CLEAR <ls_row>-kind.\n${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, /^key not written before the read:/],
    ["key passed CHANGING", `      change_key( CHANGING cv_key = <ls_row>-kind ).\n${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, /^key not written before the read:/],
    ["key aliased through ASSIGN", `      ASSIGN <ls_row>-kind TO FIELD-SYMBOL(<alias>).\n${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, /^key not written before the read:/],
    ["loop table modified", `      MODIFY ct_rows FROM <ls_row> INDEX 1.\n${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, /^key not written before the read:/],
    ["sy-dbcnt read after", `${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.\n      MOVE sy-dbcnt TO <ls_row>-text.`, /^sy-dbcnt after the read:/],
    ["another database statement", `      DELETE FROM zosd_lift_txt WHERE kind = 'NONE'.\n${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`, /^no other database statement in the loop:/],
  ]) {
    it(`R1b refuses ${what}`, () => {
      const source = fixture(body).replace("CLASS zcl_fx IMPLEMENTATION.",
        "CLASS zcl_fx IMPLEMENTATION.");
      expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(reason);
    });
  }

  // The key is read off the DDIC only where its layout is unambiguous.
  const table = (name, category, clidep, fields) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V><TABNAME>${name}</TABNAME><DDLANGUAGE>E</DDLANGUAGE><TABCLASS>${category}</TABCLASS>${clidep ? "<CLIDEP>X</CLIDEP>" : ""}</DD02V>
   <DD03P_TABLE>${fields.map((f) => `<DD03P>${f}</DD03P>`).join("")}</DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>`;
  const char = (name, length, key) => `<FIELDNAME>${name}</FIELDNAME>${key ? "<KEYFLAG>X</KEYFLAG>" : ""}<INTTYPE>C</INTTYPE><INTLEN>${String(length * 2).padStart(6, "0")}</INTLEN><DATATYPE>CHAR</DATATYPE><LENG>${String(length).padStart(6, "0")}</LENG>`;
  const MANDT = "<FIELDNAME>MANDT</FIELDNAME><KEYFLAG>X</KEYFLAG><ROLLNAME>MANDT</ROLLNAME><COMPTYPE>E</COMPTYPE>";
  // the demo's table, laid out differently; the DDIC is the fixture's folder
  // plus open-abap-core's (data element MANDT)
  const withDdic = (files, run) => {
    const dir = mkdtempSync(join(tmpdir(), "lift-ddic-"));
    try {
      for (const [name, xml] of Object.entries(files)) writeFileSync(join(dir, name), xml);
      return run([dir, ...DEFAULT_DDIC.filter((d) => d !== "src")]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  };
  const layouts = [
    ["a client-dependent table whose first key field is not the client",
      [char("KIND", 4, true), MANDT, char("CODE", 10, true), char("TEXT", 40)], true, /first field is not the client key field/],
    ["a client-independent table with a client-typed key field",
      [MANDT, char("KIND", 4, true), char("CODE", 10, true), char("TEXT", 40)], false, /client-typed key field mandt/],
    ["a non-key column before the client (no layout SAP allows either)",
      [char("NOTE", 4), MANDT, char("KIND", 4, true), char("CODE", 10, true), char("TEXT", 40)], true, /^full key: zosd_lift_txt does not resolve/], // abaplint itself will not lay out a key after a non-key field,
    ["data element MANDT with a type that is not CLNT",
      [MANDT + "<DATATYPE>CHAR</DATATYPE><LENG>000003</LENG><INTTYPE>C</INTTYPE><INTLEN>000006</INTLEN>", char("KIND", 4, true), char("CODE", 10, true), char("TEXT", 40)], true, /MANDT but type CHAR/],
  ];
  for (const [what, fields, clidep, reason] of layouts) {
    it(`R1 refuses ${what}`, () => {
      withDdic({"zosd_lift_txt.tabl.xml": table("ZOSD_LIFT_TXT", "TRANSP", clidep, fields)},
        (ddic) => expect(() => modelR1(DEMO, "before", ddic)).to.throw(reason));
    });
  }

  it("R1 reads a key that comes through an include, as abaplint expands it", () => {
    const model = withDdic({
      "zosd_lift_key.tabl.xml": table("ZOSD_LIFT_KEY", "INTTAB", false, [char("KIND", 4), char("CODE", 10)]),
      "zosd_lift_txt.tabl.xml": table("ZOSD_LIFT_TXT", "TRANSP", true,
        [MANDT, "<FIELDNAME>.INCLUDE</FIELDNAME><KEYFLAG>X</KEYFLAG><PRECFIELD>ZOSD_LIFT_KEY</PRECFIELD><COMPTYPE>S</COMPTYPE>", char("TEXT", 40)]),
    }, (ddic) => modelR1(DEMO, "before", ddic));
    expect(model.source.keys.map((k) => k.column)).to.deep.equal(["kind", "code"]);
    expect(model.open).to.not.include("key types equal column types");
  });

  it("R1 refuses a table no provider knows", () => {
    withDdic({}, (ddic) => expect(() => modelR1(DEMO, "before", ddic)).to.throw(/^full key: no provider knows zosd_lift_txt/));
  });

  // find: which calls are to the class's own database-reading method.
  const receivers = [
    ["fetch( ).", 1], ["me->fetch( ).", 1], ["CALL METHOD fetch.", 1], ["CALL METHOD me->fetch.", 1],
    ["other->fetch( ).", 0], ["other->me->fetch( ).", 0], ["CALL METHOD other->fetch.", 0], ["zcl_fx=>fetch( ).", 0],
    ["CALL METHOD m EXPORTING iv = fetch( ).", 1], ["CALL METHOD fetch=>m.", 0], ["CALL METHOD me->other->fetch.", 0],
  ];
  for (const [call, expected] of receivers) {
    it(`find counts \`${call}\` as ${expected ? "an own" : "another object's"} call`, () => {
      const dir = mkdtempSync(join(tmpdir(), "lift-find-"));
      try {
        writeFileSync(join(dir, "zcl_fx.clas.abap"), `CLASS zcl_fx DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    METHODS m IMPORTING iv TYPE i OPTIONAL.
    METHODS fetch RETURNING VALUE(rv) TYPE i.
    DATA other TYPE REF TO zcl_fx.
ENDCLASS.
CLASS zcl_fx IMPLEMENTATION.
  METHOD fetch.
    DATA lv_text TYPE c LENGTH 40.
    SELECT SINGLE text FROM zosd_lift_txt INTO lv_text WHERE kind = 'A'.
  ENDMETHOD.
  METHOD m.
    DO 2 TIMES.
      ${call}
    ENDDO.
  ENDMETHOD.
ENDCLASS.`);
        expect(find(dir).loops_via_own_method).to.equal(expected);
      } finally {
        rmSync(dir, {recursive: true, force: true});
      }
    });
  }

  it("the fixture itself is accepted, so the refusals above are about their one change", () => {
    const model = modelR1FromSource("zcl_fx.clas.abap", fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`), "m");
    // the key types were checked against the DDIC, so they are not open
    expect(model.open).to.have.members(["no concurrent writes to the table during the loop", "reads confined to one client",
      "sy-subrc and sy-dbcnt after the loop not read"]);
  });

  it("R1 refuses a key component whose type differs from the column", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`).replace("kind TYPE c LENGTH 4", "kind TYPE c LENGTH 5");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^key types: ct_rows-kind is Character\(5\), zosd_lift_txt-kind is Character\(4\)/);
  });

  it("a row the syntax cannot resolve leaves the key types open instead of guessing", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`).replace("kind TYPE c LENGTH 4", "kind TYPE zsomething_unknown");
    expect(modelR1FromSource("zcl_fx.clas.abap", source, "m").open).to.include("key types equal column types");
  });

  // Critic round r1d (10602587): each of these was accepted before.
  it("R1 refuses a key include the DDIC given does not hold, even a CI_ one abaplint skips", () => {
    // abaplint's parseType would refuse the first itself; the CI_ one it
    // skips, and only the check of the key includes here catches it
    for (const include of ["ZOSD_LIFT_MISSING", "CI_LIFT_MISSING"]) {
      const reason = new RegExp(`^full key: zosd_lift_txt has a key include ${include} that is not in the DDIC given`);
      withDdic({
        "zosd_lift_txt.tabl.xml": table("ZOSD_LIFT_TXT", "TRANSP", true,
          [MANDT, char("KIND", 4, true), char("CODE", 10, true), `<FIELDNAME>.INCLUDE</FIELDNAME><KEYFLAG>X</KEYFLAG><PRECFIELD>${include}</PRECFIELD><COMPTYPE>S</COMPTYPE>`, char("TEXT", 40)]),
      }, (ddic) => expect(() => modelR1(DEMO, "before", ddic), include).to.throw(reason));
    }
  });

  // diagnostic: abaplint keeps .INCLU-_X in the key as a literal name that
  // never resolves, so this was refused before too, only for a vaguer reason
  it("R1 refuses a suffixed key include and says why", () => {
    withDdic({
      "zosd_lift_key.tabl.xml": table("ZOSD_LIFT_KEY", "INTTAB", false, [char("CODE", 10)]),
      "zosd_lift_txt.tabl.xml": table("ZOSD_LIFT_TXT", "TRANSP", true,
        [MANDT, char("KIND", 4, true), char("CODE", 10, true), "<FIELDNAME>.INCLU-_X</FIELDNAME><KEYFLAG>X</KEYFLAG><PRECFIELD>ZOSD_LIFT_KEY</PRECFIELD><COMPTYPE>S</COMPTYPE>", char("TEXT", 40)]),
    }, (ddic) => expect(() => modelR1(DEMO, "before", ddic)).to.throw(/^full key: zosd_lift_txt has a key include with a suffix/));
  });

  it("R1 refuses a field symbol that is not typed like the loop table's line", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "FIELD-SYMBOLS <ls_row> TYPE ty_row.")
      .replace("TYPES tt_rows TYPE STANDARD TABLE OF ty_row", "TYPES: BEGIN OF ty_other, a TYPE c LENGTH 4, b TYPE c LENGTH 10, c TYPE c LENGTH 40, END OF ty_other.\n    TYPES tt_rows TYPE STANDARD TABLE OF ty_other");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^shape: <ls_row> is not laid out like a line of ct_rows: kind, code, text against a, b, c/);
  });

  it("R1 refuses a generically typed loop table", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "FIELD-SYMBOLS <ls_row> TYPE ty_row.")
      .replace("CHANGING ct_rows TYPE tt_rows", "CHANGING ct_rows TYPE ANY TABLE");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^shape: ct_rows is typed generically/);
  });

  // abaplint gives INT1, INT2 and INT4 one type with no width: only a data
  // element on the row's side and INT4 on the column's close the obligation
  const int = (name, datatype, length, key = true) => `<FIELDNAME>${name}</FIELDNAME>${key ? "<KEYFLAG>X</KEYFLAG>" : ""}<INTTYPE>${datatype === "INT1" ? "b" : datatype === "INT2" ? "s" : "I"}</INTTYPE><INTLEN>00000${length}</INTLEN><DATATYPE>${datatype}</DATATYPE><LENG>000003</LENG>`;
  const intTable = (datatype, length) => ({"zosd_lift_txt.tabl.xml": table("ZOSD_LIFT_TXT", "TRANSP", true, [MANDT, int("KIND", datatype, length), int("CODE", datatype, length), char("TEXT", 40)])});
  const intFixture = (declaration) => fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
    .replace("kind TYPE c LENGTH 4, code TYPE c LENGTH 10", declaration);
  const integerCases = [
    ["INT1 column, TYPE i row", intTable("INT1", 1), intFixture("kind TYPE i, code TYPE i"), true],
    ["INT2 column, TYPE i row", intTable("INT2", 2), intFixture("kind TYPE i, code TYPE i"), true],
    ["INT4 column, TYPE i row (TYPE i proves nothing: it may be an INT1 field of a DDIC structure)", intTable("INT4", 4), intFixture("kind TYPE i, code TYPE i"), true],
    ["INT4 column, data element INT1 row", intTable("INT4", 4), intFixture("kind TYPE int1, code TYPE int1"), true],
    ["INT4 column, data element INT4 row", intTable("INT4", 4), intFixture("kind TYPE int4, code TYPE int4"), false],
  ];
  for (const [what, ddicFiles, source, open] of integerCases) {
    it(`integer keys: ${what} ${open ? "stays open" : "closes"}`, () => {
      const model = withDdic(ddicFiles, (ddic) => modelR1FromSource("zcl_fx.clas.abap", source, "m", ddic));
      if (open) expect(model.open).to.include("key types equal column types");
      else expect(model.open).to.not.include("key types equal column types");
    });
  }

  it("integer keys: an INT1 field of a DDIC structure against an INT4 column stays open", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("TYPES tt_rows TYPE STANDARD TABLE OF ty_row", "TYPES tt_rows TYPE STANDARD TABLE OF zosd_lift_irow");
    const model = withDdic({...intTable("INT4", 4),
      "zosd_lift_irow.tabl.xml": table("ZOSD_LIFT_IROW", "INTTAB", false, [int("KIND", "INT1", 1, false), int("CODE", "INT1", 1, false), char("TEXT", 40)])},
    (ddic) => modelR1FromSource("zcl_fx.clas.abap", source, "m", ddic));
    expect(model.open).to.include("key types equal column types");
  });

  const symbolCases = [
    ["a field symbol TYPE any", "FIELD-SYMBOLS <ls_row> TYPE any.", /^shape: <ls_row> is not typed as a structure/],
    ["a field symbol whose same-named component has another type",
      "TYPES: BEGIN OF ty_wide, kind TYPE c LENGTH 5, code TYPE c LENGTH 10, text TYPE c LENGTH 40, END OF ty_wide.\n    FIELD-SYMBOLS <ls_row> TYPE ty_wide.",
      /^shape: <ls_row>-kind is Character\(5\), ct_rows-kind is Character\(4\)/],
  ];
  for (const [what, declaration, reason] of symbolCases) {
    it(`R1 refuses ${what}`, () => {
      const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`).replace("FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", declaration);
      expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(reason);
    });
  }

  // critic r1f: LOOP ASSIGNING maps by position, the SELECT and FOR ALL
  // ENTRIES read by name, so equal names in another order are another row
  it("R1 refuses a field symbol with the line's components in another order", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("kind TYPE c LENGTH 4, code TYPE c LENGTH 10", "kind TYPE c LENGTH 10, code TYPE c LENGTH 10")
      .replace("FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "TYPES: BEGIN OF ty_swapped, code TYPE c LENGTH 10, kind TYPE c LENGTH 10, text TYPE c LENGTH 40, END OF ty_swapped.\n    FIELD-SYMBOLS <ls_row> TYPE ty_swapped.");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^shape: <ls_row> is not laid out like a line of ct_rows: code, kind, text against kind, code, text/);
  });

  it("integer keys: a data element named like a built-in type proves nothing", () => {
    const dtelI = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><DD04V><ROLLNAME>I</ROLLNAME><DDLANGUAGE>E</DDLANGUAGE><DATATYPE>INT4</DATATYPE><LENG>000010</LENG><REFKIND>D</REFKIND></DD04V></asx:values>
 </asx:abap>
</abapGit>`;
    // an INT1 field of a DDIC structure answers "I" as its qualified name
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("TYPES tt_rows TYPE STANDARD TABLE OF ty_row", "TYPES tt_rows TYPE STANDARD TABLE OF zosd_lift_irow");
    const model = withDdic({...intTable("INT4", 4), "i.dtel.xml": dtelI,
      "zosd_lift_irow.tabl.xml": table("ZOSD_LIFT_IROW", "INTTAB", false, [int("KIND", "INT1", 1, false), int("CODE", "INT1", 1, false), char("TEXT", 40)])},
    (ddic) => modelR1FromSource("zcl_fx.clas.abap", source, "m", ddic));
    expect(model.open).to.include("key types equal column types");
  });

  it("R1 takes a parenthesised list of targets", () => {
    const model = modelR1FromSource("zcl_fx.clas.abap", fixture("      SELECT SINGLE kind text FROM zosd_lift_txt INTO (<ls_row>-kind, <ls_row>-text) WHERE kind = <ls_row>-kind AND code = <ls_row>-code."), "m");
    expect(model.fields).to.deep.equal([{column: "kind", component: "kind"}, {column: "text", component: "text"}]);
  });

  it("R1 reads a SELECT split by line breaks and an ABAP comment", () => {
    const body = `      SELECT SINGLE text
        FROM zosd_lift_txt
        INTO <ls_row>-text
        WHERE kind = <ls_row>-kind
        " the second key follows on another line
        AND code = <ls_row>-code.`;
    expect(modelR1FromSource("zcl_fx.clas.abap", fixture(body), "m").source.keys)
      .to.deep.equal([{column: "kind", component: "kind"}, {column: "code", component: "code"}]);
  });

  it("R1 reads an explicit host variable in INTO", () => {
    const body = "      SELECT SINGLE text FROM zosd_lift_txt INTO @<ls_row>-text WHERE kind = <ls_row>-kind AND code = <ls_row>-code.";
    const model = modelR1FromSource("zcl_fx.clas.abap", fixture(body), "m");
    expect(model.fields).to.deep.equal([{column: "text", component: "text"}]);
  });

  it("R1 reads explicit host variables in WHERE", () => {
    const body = "      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE kind = @<ls_row>-kind AND code = @<ls_row>-code.";
    const model = modelR1FromSource("zcl_fx.clas.abap", fixture(body), "m");
    expect(model.source.keys.map((k) => k.component)).to.deep.equal(["kind", "code"]);
  });

  it("R1 reads grouped key equalities", () => {
    const body = "      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE ( kind = <ls_row>-kind ) AND ( code = <ls_row>-code ).";
    expect(modelR1FromSource("zcl_fx.clas.abap", fixture(body), "m").source.keys)
      .to.deep.equal([{column: "kind", component: "kind"}, {column: "code", component: "code"}]);
  });

  it("R1 reads EQ as key equality", () => {
    const body = "      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE kind EQ <ls_row>-kind AND code = <ls_row>-code.";
    expect(modelR1FromSource("zcl_fx.clas.abap", fixture(body), "m").source.keys)
      .to.deep.equal([{column: "kind", component: "kind"}, {column: "code", component: "code"}]);
  });

  it("R1 refuses an additional SELECT clause", () => {
    const body = "      SELECT SINGLE text FROM zosd_lift_txt INTO <ls_row>-text WHERE kind = <ls_row>-kind AND code = <ls_row>-code ORDER BY PRIMARY KEY.";
    expect(() => modelR1FromSource("zcl_fx.clas.abap", fixture(body), "m")).to.throw(/^shape: /);
  });

  it("a field symbol the syntax cannot resolve leaves its agreement with the line open", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`).replace("FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "FIELD-SYMBOLS <ls_row> TYPE zsomething_unknown.");
    expect(modelR1FromSource("zcl_fx.clas.abap", source, "m").open).to.include("<ls_row> typed like a line of ct_rows");
  });

  it("R1 refuses a loop table with a header line", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("FIELD-SYMBOLS <ls_row> LIKE LINE OF ct_rows.", "DATA lt_h TYPE STANDARD TABLE OF ty_row WITH HEADER LINE.\n    FIELD-SYMBOLS <ls_row> LIKE LINE OF lt_h.")
      .replace("LOOP AT ct_rows ASSIGNING", "LOOP AT lt_h ASSIGNING");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^shape: lt_h has a header line/);
  });

  it("R1 refuses a key include that is a view, naming it as unsupported rather than missing", () => {
    const view = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_VIEW" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values><DD25V><VIEWNAME>ZOSD_LIFT_V</VIEWNAME><VIEWCLASS>D</VIEWCLASS></DD25V></asx:values>
 </asx:abap>
</abapGit>`;
    withDdic({
      "zosd_lift_v.view.xml": view,
      "zosd_lift_txt.tabl.xml": table("ZOSD_LIFT_TXT", "TRANSP", true,
        [MANDT, char("KIND", 4, true), char("CODE", 10, true), "<FIELDNAME>.INCLUDE</FIELDNAME><KEYFLAG>X</KEYFLAG><PRECFIELD>ZOSD_LIFT_V</PRECFIELD><COMPTYPE>S</COMPTYPE>", char("TEXT", 40)]),
    }, (ddic) => expect(() => modelR1(DEMO, "before", ddic)).to.throw(/^full key: zosd_lift_txt has a key include ZOSD_LIFT_V that is a view/));
  });

  it("an unresolved key type does not hide a known mismatch in another key", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("kind TYPE c LENGTH 4", "kind TYPE n LENGTH 4")
      .replace("code TYPE c LENGTH 10", "code TYPE zsomething_unknown");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^key types: ct_rows-kind is Numeric\(4\), zosd_lift_txt-kind is Character\(4\)/);
  });

  it("an unresolved first key does not stop the check of the next", () => {
    const source = fixture(`${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`)
      .replace("kind TYPE c LENGTH 4", "kind TYPE zsomething_unknown")
      .replace("code TYPE c LENGTH 10", "code TYPE n LENGTH 10");
    expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^key types: ct_rows-code is Numeric\(10\), zosd_lift_txt-code is Character\(10\)/);
  });

  for (const [what, into] of [
    ["INTO CORRESPONDING FIELDS OF a component", "INTO CORRESPONDING FIELDS OF <ls_row>-text"],
    ["INTO ... INDICATORS", "INTO <ls_row>-text INDICATORS NULL STRUCTURE nulls"],
  ]) {
    it(`R1 refuses ${what}`, () => {
      const source = fixture(`      SELECT SINGLE text FROM zosd_lift_txt ${into} WHERE kind = <ls_row>-kind AND code = <ls_row>-code.`,
        "    DATA nulls TYPE c LENGTH 1.\n");
      expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(/^shape: /);
    });
  }

  // merge critic on #290: the loop table written through a table expression,
  // and system fields read before the lookup, were accepted
  for (const [what, extra, reason] of [
    ["the loop table written in the body", "      ct_rows[ 1 ]-kind = 'DIFF'.", /^key not written before the read: .*touches the loop table ct_rows/],
    ["sy-dbcnt read before the lookup", "      <ls_row>-text = sy-dbcnt.", /^system fields before the read: /],
    ["sy-subrc read before the lookup", "      IF sy-subrc = 0. ENDIF.", /^system fields before the read: /],
  ]) {
    it(`R1b refuses ${what}`, () => {
      const source = fixture(`${extra}\n${SELECT} kind = <ls_row>-kind AND code = <ls_row>-code.`);
      expect(() => modelR1FromSource("zcl_fx.clas.abap", source, "m")).to.throw(reason);
    });
  }

  it("the generated region of AFTER is exactly what the template renders", async () => {
    const {text, trace} = await render(modelR1(DEMO, "before"));
    expect(region(readFileSync(DEMO, "utf8"), "before")).to.equal(text);
    // the line that copies the value traces to the template line of the
    // field loop and to the first value on it
    const copy = text.split("\n").findIndex((l) => l.includes("-text = <ls_lookup>-text")) + 1;
    const template = readFileSync(TEMPLATE, "utf8").split("\n");
    const entry = trace.find((t) => t.line === copy);
    expect(template[entry.template_line - 1]).to.equal("    {{loop.row}}-{{component}} = {{hit}}-{{column}}.");
    expect(entry.path).to.equal("/loop/row");
  });

  it("the generated R1b region is exactly what the template renders", async () => {
    const {text} = await render(modelR1(DEMO, "before_mixed"));
    expect(region(readFileSync(DEMO, "utf8"), "before_mixed")).to.equal(text);
  });

  // AFTER is one SELECT in the ABAP. On a system the kernel sends FOR ALL
  // ENTRIES in blocks, and the pinned transpiler does too: 50 driving rows
  // to a statement, each row's condition under OR (it sent one SELECT per
  // row before, ANOMALY-2026-09-30-fae-one-select-per-row, and this test
  // pinned 50 then).
  it("BEFORE asks the database once per row; AFTER asks once per block of driving rows", async () => {
    const db = abap.context.databaseConnections.DEFAULT;
    await db.execute("DELETE FROM zosd_lift_txt");
    for (let i = 0; i < 40; i++) {
      await db.execute(`INSERT INTO zosd_lift_txt (mandt, kind, code, text) VALUES ('${abap.builtin.sy.get().mandt.get()}', 'STAT', 'C${i}', 'text ${i}')`);
    }
    const rows = () => {
      const table = abap.types.TableFactory.construct(new abap.types.Structure({
        kind: new abap.types.Character(4), code: new abap.types.Character(10), text: new abap.types.Character(40),
        visits: new abap.types.Integer(), status: new abap.types.Integer()}),
      {withHeader: false, keyType: "DEFAULT", primaryKey: {name: "primary_key", type: "STANDARD", isUnique: false, keyFields: []}, secondary: []});
      for (let i = 0; i < 50; i++) {
        const row = table.getRowType().clone();
        row.get().kind.set("STAT");
        row.get().code.set(`C${i % 45}`);
        table.append(row);
      }
      return table;
    };
    const counted = async (method) => {
      const original = db.select.bind(db);
      let calls = 0;
      let fetched = 0;
      db.select = async (options) => {
        calls++;
        const answer = await original(options);
        fetched += answer.rows.length;
        return answer;
      };
      const table = rows();
      try {
        await abap.Classes.ZCL_OSD_LIFT_R1_DEMO[method]({ct_rows: table});
      } finally {
        db.select = original;
      }
      return {calls, fetched, texts: table.array().map((r) => r.get().text.get())};
    };
    const before = await counted("before");
    const after = await counted("after");
    const beforeMixed = await counted("before_mixed");
    const afterMixed = await counted("after_mixed");
    expect(after.texts).to.deep.equal(before.texts);
    expect(before.calls).to.equal(50);
    expect(after.calls, "50 driving rows are one block (ANOMALY-2026-09-30-fae-one-select-per-row, fixed in the pin)").to.equal(1);
    expect(afterMixed.texts).to.deep.equal(beforeMixed.texts);
    expect(beforeMixed.calls).to.equal(50);
    expect(afterMixed.calls).to.equal(1);
    const empty = abap.types.TableFactory.construct(rows().getRowType(), {withHeader: false, keyType: "DEFAULT", primaryKey: {name: "primary_key", type: "STANDARD", isUnique: false, keyFields: []}, secondary: []});
    const original = db.select.bind(db);
    let calls = 0;
    db.select = async (options) => { calls++; return original(options); };
    try {
      await abap.Classes.ZCL_OSD_LIFT_R1_DEMO.after({ct_rows: empty});
    } finally {
      db.select = original;
    }
    expect(calls, "no rows, no read: the IS NOT INITIAL guard").to.equal(0);
  });
});
