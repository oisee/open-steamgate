import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {abapModel, DDIC_PROVIDER as abapProvider, methodTableModel, renderMethodTable, renderConstants} from "../tools/dsl-abap.mjs";
import {DDIC_PROVIDER as modelProvider} from "../tools/dsl-ddic.mjs";
import {DDIC_PROVIDER as liftProvider} from "../tools/lift.mjs";

const SOURCE = `CLASS zcl_dsl_fixture DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    TYPES ty_code TYPE c LENGTH 8.
    DATA mv_name TYPE zosd_test_name.
    METHODS m
      IMPORTING iv_name TYPE zosd_test_name
                iv_missing TYPE zfx_missing
      EXPORTING ev_count TYPE i
      CHANGING cv_code TYPE ty_code
      RETURNING VALUE(rv_text) TYPE string.
ENDCLASS.
CLASS zcl_dsl_fixture IMPLEMENTATION.
  METHOD m.
  ENDMETHOD.
ENDCLASS.
`;

describe("ABAP declaration L1", function () {
  this.timeout(60000);
  let folder, file, model;
  before(() => {
    folder = mkdtempSync(join(tmpdir(), "dsl-abap-"));
    file = join(folder, "zcl_dsl_fixture.clas.abap");
    writeFileSync(file, SOURCE);
    model = abapModel([file], {ddic: ["src"]});
  });
  after(() => rmSync(folder, {recursive: true, force: true}));

  it("shares the exact DDIC provider object with lift", () => {
    expect(modelProvider).to.equal(liftProvider);
    expect(modelProvider).to.equal(abapProvider);
    expect(modelProvider.type).to.be.a("function");
    expect(modelProvider.literalType).to.be.a("function");
  });

  it("reads class, declarations, parameter directions, types and source lines", () => {
    const cls = model.classes[0];
    expect(cls).to.include({"@id": "class/zcl_dsl_fixture", name: "zcl_dsl_fixture", file, line: 1});
    expect(cls.types[0]).to.include({"@id": "class/zcl_dsl_fixture/type/ty_code", file, line: 3});
    expect(cls.types[0]["@type"]).to.include({resolved: true, built_in: "CHAR", length: 8});
    expect(cls.attributes[0]).to.include({"@id": "class/zcl_dsl_fixture/attribute/mv_name", file, line: 4});
    expect(cls.attributes[0]["@type"]).to.include({resolved: true, built_in: "CHAR", length: 40,
      data_element: "zosd_test_name"});
    const method = cls.methods[0];
    expect(method).to.include({"@id": "class/zcl_dsl_fixture/method/m", file, line: 5});
    expect(method.parameters.map((p) => [p.name, p.kind, p.line])).to.deep.equal([
      ["iv_name", "importing", 6], ["iv_missing", "importing", 7],
      ["ev_count", "exporting", 8], ["cv_code", "changing", 9], ["rv_text", "returning", 10],
    ]);
    for (const param of method.parameters) {
      expect(param["@id"]).to.equal(`class/zcl_dsl_fixture/method/m/param/${param.name}`);
      expect(param.file).to.equal(file);
    }
    expect(method.parameters[0]["@type"]).to.include({resolved: true, data_element: "zosd_test_name", length: 40});
    expect(method.parameters[1]["@type"]).to.deep.equal({resolved: false, abap_type: "zfx_missing"});
    expect(method.parameters[2]["@type"]).to.include({resolved: true, built_in: "INT4"});
    expect(method.parameters[3]["@type"]).to.include({resolved: true, abap_type: "zcl_dsl_fixture=>ty_code"});
    expect(method.parameters[4]["@type"]).to.include({resolved: true, built_in: "STRING"});
  });

  // merge critic on #297: a table of an unknown row was reported resolved
  it("does not call a table or structure resolved when a part of it is not", () => {
    const nested = join(folder, "zcl_dsl_nested.clas.abap");
    writeFileSync(nested, `CLASS zcl_dsl_nested DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_half, ok TYPE i, bad TYPE zfx_missing, END OF ty_half.
    DATA mt_rows TYPE STANDARD TABLE OF zfx_missing WITH DEFAULT KEY.
    DATA ms_half TYPE ty_half.
    DATA mt_ints TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
ENDCLASS.
CLASS zcl_dsl_nested IMPLEMENTATION.
ENDCLASS.
`);
    const cls = abapModel([nested], {ddic: ["src"]}).classes[0];
    const byName = Object.fromEntries(cls.attributes.map((a) => [a.name, a["@type"].resolved]));
    expect(byName).to.deep.equal({mt_rows: false, ms_half: false, mt_ints: true});
    expect(cls.types.find((t) => t.name === "ty_half")["@type"].resolved).to.equal(false);
  });

  it("includes superclass and interface declarations with their own source positions", () => {
    const base = join(folder, "zcl_dsl_base.clas.abap");
    const child = join(folder, "zcl_dsl_child.clas.abap");
    const intf = join(folder, "zif_dsl_fixture.intf.abap");
    writeFileSync(base, `CLASS zcl_dsl_base DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS base.
ENDCLASS.
CLASS zcl_dsl_base IMPLEMENTATION.
  METHOD base.
  ENDMETHOD.
ENDCLASS.
`);
    writeFileSync(intf, `INTERFACE zif_dsl_fixture PUBLIC.
  METHODS ping IMPORTING iv_code TYPE i.
ENDINTERFACE.
`);
    writeFileSync(child, `CLASS zcl_dsl_child DEFINITION PUBLIC INHERITING FROM zcl_dsl_base.
  PUBLIC SECTION.
    INTERFACES zif_dsl_fixture.
ENDCLASS.
CLASS zcl_dsl_child IMPLEMENTATION.
  METHOD zif_dsl_fixture~ping.
  ENDMETHOD.
ENDCLASS.
`);
    const other = abapModel([base, child, intf], {ddic: []});
    const subclass = other.classes.find((entry) => entry.name === "zcl_dsl_child");
    expect(subclass.superclass).to.include({"@id": "class/zcl_dsl_child/superclass/zcl_dsl_base", file: child, line: 1});
    expect(subclass.interfaces[0]).to.include({"@id": "class/zcl_dsl_child/interface/zif_dsl_fixture", file: child, line: 3});
    expect(other.interfaces[0].methods[0].parameters[0]).to.include({
      "@id": "interface/zif_dsl_fixture/method/ping/param/iv_code", file: intf, line: 2,
    });
  });

  it("renders the public signature table byte for byte with a node for each line", async () => {
    const result = await renderMethodTable(model, "zcl_dsl_fixture");
    expect(result.text).to.equal(`# zcl_dsl_fixture
| Method | Parameters |
| --- | --- |
| m | importing iv_name: zosd_test_name(40), importing iv_missing: zfx_missing (unresolved), exporting ev_count: INT4, changing cv_code: zcl_dsl_fixture=>ty_code(8), returning rv_text: STRING |
`);
    expect(result.trace).to.have.length(4);
    for (const entry of result.trace) expect(entry.node, `line ${entry.line}`).to.match(/^class\/zcl_dsl_fixture(?:\/method\/m)?$/);
    expect(result.trace.at(-1).node).to.equal("class/zcl_dsl_fixture/method/m");
  });

  it("renders the real template class from ABAP without SEGW", async () => {
    const source = "src/tpl/zcl_osd_tpl.clas.abap";
    const actual = abapModel([source], {ddic: ["src"]});
    const table = methodTableModel(actual, "zcl_osd_tpl");
    expect(table.classes[0].public_methods.map((m) => m.name)).to.deep.equal(["render", "to_string"]);
    const result = await renderMethodTable(actual, "zcl_osd_tpl");
    expect(result.text).to.include("| render | importing iv_template: STRING");
    expect(result.text).to.include("| to_string | importing is_result:");
    expect(result.trace.every((entry) => entry.node?.startsWith("class/zcl_osd_tpl"))).to.equal(true);
  });

  const literalsFile = "test/fixtures/dsl-literals/zcl_dsl_literals.clas.abap";
  const literalDDIC = "test/fixtures/dsl-literals";
  it("writes filter types beside literal values and parameter defaults", () => {
    const cls = abapModel([literalsFile], {ddic: [literalDDIC]}).classes[0];
    const actual = Object.fromEntries(cls.attributes.filter((a) => a["value@type"] !== undefined)
      .map((a) => [a.name, [a.value, a["value@type"]]]));
    expect(actual).to.deep.equal({
      c_char_de: ["Ab", {built_in: "CHAR", length: 4}],
      c_char: ["xyz", {built_in: "CHAR", length: 3}],
      c_numc: ["0042", {built_in: "NUMC", length: 4}],
      c_int1: ["255", {built_in: "INT1"}],
      c_int4: ["00042", {built_in: "INT4"}],
      c_int8: ["9223372036854775807", {built_in: "INT8"}],
      c_dec_de: ["1.50", {built_in: "DEC", length: 15, decimals: 2}],
      c_dec14: ["1.25", {built_in: "DEC", length: 14, decimals: 2}],
      c_dec: ["12.34", {built_in: "DEC", length: 15, decimals: 2}],
      c_string: ["hello", {built_in: "STRG"}],
      c_raw: ["0a1b", {built_in: "RAW", length: 2}],
      c_date: ["20260930", {built_in: "DATS", length: 8}],
      c_time: ["123456", {built_in: "TIMS", length: 6}],
    });
    expect(cls.attributes.find((a) => a.name === "c_ref")).to.include({value_expr: "c_int4"});
    expect(cls.attributes.find((a) => a.name === "c_ref")).not.to.have.property("value@type");
    expect(cls.attributes.find((a) => a.name === "c_xstring")).to.include({value: "00"});
    expect(cls.attributes.find((a) => a.name === "c_xstring").literal_type).to.deep.equal({
      resolved: false, reason: "XSTRING is not accepted by literal",
    });
    expect(cls.attributes.find((a) => a.name === "c_xstring")).not.to.have.property("value@type");
    for (const [name, type] of [["c_float", "FLTP"], ["c_decfloat", "DECFLOAT16"]]) {
      const item = cls.attributes.find((a) => a.name === name);
      expect(item.literal_type).to.deep.equal({resolved: false, reason: `${type} is not accepted by literal`});
      expect(item).not.to.have.property("value@type");
    }
    expect(cls.methods[0].parameters[0]).to.include({default: "A"});
    expect(cls.methods[0].parameters[0]["default@type"]).to.deep.equal({built_in: "CHAR", length: 4});
    expect(cls.attributes.find((a) => a.name === "c_dec")["@type"].length).to.equal(8);
    const intf = abapModel(["test/fixtures/dsl-literals/zif_dsl_literals.intf.abap"], {ddic: []}).interfaces[0];
    expect(intf.attributes[0]).to.include({constant: true, value: "interface"});
    expect(intf.attributes[0]["value@type"]).to.deep.equal({built_in: "STRG"});
  });

  it("round trips every literal constant through the ABAP filter with a line trace", async () => {
    const model = abapModel([literalsFile], {ddic: [literalDDIC]});
    const result = await renderConstants(model, "zcl_dsl_literals");
    expect(result.text).to.equal([
      "CONSTANTS c_char_de TYPE zlit_char VALUE 'Ab'.",
      "CONSTANTS c_char TYPE c LENGTH 3 VALUE 'xyz'.",
      "CONSTANTS c_numc TYPE zlit_numc VALUE '0042'.",
      "CONSTANTS c_int1 TYPE zlit_int1 VALUE 255.",
      "CONSTANTS c_int4 TYPE i VALUE 42.",
      "CONSTANTS c_int8 TYPE int8 VALUE 9223372036854775807.",
      "CONSTANTS c_dec_de TYPE zlit_dec VALUE '1.50'.",
      "CONSTANTS c_dec14 TYPE zlit_dec14 VALUE '1.25'.",
      "CONSTANTS c_dec TYPE p LENGTH 8 DECIMALS 2 VALUE '12.34'.",
      "CONSTANTS c_string TYPE string VALUE `hello`.",
      "CONSTANTS c_raw TYPE x LENGTH 2 VALUE '0A1B'.",
      "CONSTANTS c_date TYPE d VALUE '20260930'.",
      "CONSTANTS c_time TYPE t VALUE '123456'.",
      "",
    ].join("\n"));
    expect(result.trace).to.have.length(13);
    for (const [index, entry] of result.trace.entries()) {
      expect(entry.line).to.equal(index + 1);
      expect(entry.node).to.equal(`class/zcl_dsl_literals/attribute/${model.classes[0].attributes[index].name}`);
    }
  });

  it("refuses an INT1 value outside its range at the template line", async () => {
    const model = abapModel(["test/fixtures/dsl-literals/zcl_dsl_refusal.clas.abap"], {ddic: [literalDDIC]});
    expect(model.classes[0].attributes[0]["value@type"]).to.deep.equal({built_in: "INT1"});
    try {
      await renderConstants(model, "zcl_dsl_refusal");
      expect.fail("expected literal refusal");
    } catch (error) {
      expect(error.message).to.equal("main:1: literal value needs an integer in range");
    }
  });

  it("refuses a CHAR value beyond its declared length", async () => {
    const model = abapModel(["test/fixtures/dsl-literals/zcl_dsl_char_refusal.clas.abap"], {ddic: []});
    expect(model.classes[0].attributes[0]["value@type"]).to.deep.equal({built_in: "CHAR", length: 3});
    try {
      await renderConstants(model, "zcl_dsl_char_refusal");
      expect.fail("expected literal refusal");
    } catch (error) {
      expect(error.message).to.equal("main:1: literal value exceeds length");
    }
  });
});
