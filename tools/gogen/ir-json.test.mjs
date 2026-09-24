// node --test tools/gogen/ir-json.test.mjs
//
// The IR as JSON documents (ir-json.mjs) over a small clean-room program:
// an interface, a class that implements it, a class that calls that one,
// and a class that touches neither. What each class contributes to the
// shared document is recorded (ir-contrib.mjs, from compileProgram), what it
// read comes from abaplint's scopes, and a change to the interface makes
// the implementer and its caller stale and nothing else.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {toDocuments, fromDocuments, staleAfter, text} from "./ir-json.mjs";

const SOURCES = {
  "zif_ir_shape.intf.abap": `INTERFACE zif_ir_shape PUBLIC.
  METHODS area RETURNING VALUE(rv) TYPE i.
ENDINTERFACE.`,
  "zcl_ir_square.clas.abap": `CLASS zcl_ir_square DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_ir_shape.
    METHODS constructor IMPORTING iv_side TYPE i.
  PRIVATE SECTION.
    DATA mv_side TYPE i.
ENDCLASS.
CLASS zcl_ir_square IMPLEMENTATION.
  METHOD constructor.
    mv_side = iv_side.
  ENDMETHOD.
  METHOD zif_ir_shape~area.
    rv = mv_side * mv_side.
  ENDMETHOD.
ENDCLASS.`,
  "zcl_ir_caller.clas.abap": `CLASS zcl_ir_caller DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_ir_caller IMPLEMENTATION.
  METHOD run.
    DATA lo TYPE REF TO zcl_ir_square.
    DATA lt TYPE STANDARD TABLE OF i WITH DEFAULT KEY.
    DATA lv TYPE i.
    CREATE OBJECT lo EXPORTING iv_side = 3.
    APPEND 1 TO lt.
    APPEND 2 TO lt.
    LOOP AT lt INTO lv.
      IF lv = 1.
        DELETE lt.
      ENDIF.
    ENDLOOP.
    rv = lo->zif_ir_shape~area( ).
  ENDMETHOD.
ENDCLASS.`,
  "zcl_ir_alone.clas.abap": `CLASS zcl_ir_alone DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS one RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_ir_alone IMPLEMENTATION.
  METHOD one.
    rv = 1.
  ENDMETHOD.
ENDCLASS.`,
};

function compile() {
  const dir = mkdtempSync(join(tmpdir(), "ir-json-"));
  for (const [name, text] of Object.entries(SOURCES)) writeFileSync(join(dir, name), text);
  try {
    return compileProgram({folders: [dir], objects: ["zif_ir_shape", "zcl_ir_square", "zcl_ir_caller", "zcl_ir_alone"]});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const program = compile();
const docs = toDocuments(program);
const byName = new Map(docs.objects.map((d) => [d.object, d]));

test("each class document records what the class added to the shared document", () => {
  assert.ok(byName.get("ZCL_IR_SQUARE").contributes, "the implementer contributed");
  assert.ok(Object.keys(byName.get("ZCL_IR_SQUARE").contributes).length > 0);
  // compileProgram keeps them on the program, the shared document does not
  assert.equal("contributions" in JSON.parse(text(docs.program)).program, false);
});

test("each class document names what its compile read, and a change travels to its readers", () => {
  const caller = byName.get("ZCL_IR_CALLER").inputs;
  assert.ok(Object.keys(caller.reads).includes("CLAS ZCL_IR_SQUARE"), JSON.stringify(caller.reads));
  const stale = staleAfter(docs.objects, ["INTF ZIF_IR_SHAPE"]).map((d) => d.object).sort();
  assert.deepEqual(stale, ["ZCL_IR_CALLER", "ZCL_IR_SQUARE"]);
  assert.deepEqual(staleAfter(docs.objects, ["CLAS ZCL_IR_ALONE"]).map((d) => d.object), ["ZCL_IR_ALONE"]);
});

test("the documents read back to the same Go, the whole set or a subset on request", () => {
  const texts = {program: text(docs.program), objects: docs.objects.map(text)};
  const back = fromDocuments({program: JSON.parse(texts.program), objects: texts.objects.map((t) => JSON.parse(t))});
  assert.equal(emitGo(back), emitGo(compile()));
  const one = docs.objects.filter((d) => d.object === "ZCL_IR_ALONE").map((d) => JSON.parse(text(d)));
  assert.throws(() => fromDocuments({program: JSON.parse(texts.program), objects: one}), /has no document/);
  assert.equal(fromDocuments({program: JSON.parse(texts.program), objects: one}, {partial: true}).classes.length, 1);
});

test("a reader refuses documents another front end wrote", () => {
  const other = JSON.parse(text(docs.program));
  assert.throws(() => fromDocuments({program: other, objects: []}, {source: "0000000000000000"}), /front-end sources/);
});

test("shared nodes, Maps and Sets come back as one object; what does not travel is refused", () => {
  const shared = new Map([["k", {v: 1}]]);
  const loop = {s: "loop"};
  loop.body = [{s: "delete", loop}];
  const p = {classes: [{name: "A", a: shared, b: shared, m: [loop, loop]}]};
  const b = fromDocuments(JSON.parse(JSON.stringify(toDocuments(p))));
  assert.equal(b.classes[0].a, b.classes[0].b);
  assert.equal(b.classes[0].m[0].body[0].loop, b.classes[0].m[0]);
  assert.throws(() => toDocuments({classes: [{name: "A"}, {name: "A"}]}), /two classes named A/);
  assert.throws(() => toDocuments({classes: [{name: "A", z: -0}]}), /-0/);
  assert.throws(() => toDocuments({classes: [{name: "A", h: [1, , 2]}]}), /hole/);
  assert.throws(() => toDocuments({classes: [{name: "A", d: new Date(0)}]}), /Date is not IR data/);
});
