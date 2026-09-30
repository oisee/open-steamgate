import {expect} from "chai";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {abapModel, DDIC_PROVIDER as abapProvider, methodTableModel, renderMethodTable} from "../tools/dsl-abap.mjs";
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
});
