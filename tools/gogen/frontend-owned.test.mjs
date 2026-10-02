import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {compileProgram} from "./frontend.mjs";
import {analyzeOwnership} from "./frontend-owned.mjs";
import {emitGo} from "./emit-go.mjs";

function compile(body, extra = "", definition = "") {
  const dir = mkdtempSync(join(tmpdir(), "gogen-owned-"));
  try {
    writeFileSync(join(dir, "zcl_owned.clas.abap"), `CLASS zcl_owned DEFINITION PUBLIC FINAL CREATE PUBLIC.
PUBLIC SECTION. METHODS run. ${definition}
PRIVATE SECTION. DATA mv_mem TYPE xstring.
ENDCLASS.
CLASS zcl_owned IMPLEMENTATION.
METHOD run. DATA mem TYPE xstring. DATA b TYPE xstring. ${body} ENDMETHOD.
${extra}
ENDCLASS.`);
    return compileProgram({folders: [dir], objects: ["ZCL_OWNED"], tolerant: true});
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
function owns(p, name = "MEM") {
  const cls = p.classes[0], method = cls.methods.find((m) => m.name === "RUN");
  assert.ok(method, JSON.stringify(p.partial));
  const local = method.locals.find((v) => v.name === name);
  return analyzeOwnership(p).declarations.has(local);
}

test("ABAPiti private memory and a local qualify; slices and whole reads are snapshots", () => {
  const p = compile(`mem = '12345678'. b = mem. b = mem+1(2).
    mv_mem = mem. REPLACE SECTION OFFSET 1 LENGTH 2 OF mv_mem WITH b IN BYTE MODE.
    CONCATENATE mv_mem b b INTO mv_mem IN BYTE MODE. CLEAR mem.`);
  assert.deepEqual(p.partial, []);
  assert.equal(owns(p), true);
  assert.ok(analyzeOwnership(p).declarations.has(p.classes[0].attributes.find((a) => a.name === "MV_MEM")));
  const go = emitGo(p);
  assert.match(go, /mv_mem hXbuf.Buffer/);
  assert.match(go, /mem\.Sub\(int32\(1\), int32\(2\)\)/);
  assert.match(go, /mv_mem\.Replace/);
  assert.match(go, /mv_mem\.Append/);
  assert.match(go, /mem\.Clear/);
});

test("ASSIGN, GET REFERENCE, REF #, and dynamic names disqualify", () => {
  for (const statement of [
    "FIELD-SYMBOLS <x> TYPE xstring. ASSIGN mem TO <x>.",
    "DATA r TYPE REF TO xstring. GET REFERENCE OF mem INTO r.",
    "DATA r TYPE REF TO xstring. r = REF #( mem ).",
    "FIELD-SYMBOLS <x> TYPE any. DATA name TYPE string VALUE 'MEM'. ASSIGN (name) TO <x>.",
    "FIELD-SYMBOLS <x> TYPE any. ASSIGN ('MEM') TO <x>.",
    "FIELD-SYMBOLS <x> TYPE any. ASSIGN COMPONENT 1 OF STRUCTURE mem TO <x>.",
  ]) assert.equal(owns(compile(statement)), false, statement);
});

test("call directions preserve normal representation except an explicit VALUE input", () => {
  for (const [signature, actual] of [
    ["CHANGING p TYPE xstring", "CHANGING p = mem"],
    ["EXPORTING p TYPE xstring", "IMPORTING p = mem"],
    ["IMPORTING p TYPE xstring", "EXPORTING p = mem"],
  ]) {
    const p = compile(`other( ${actual} ).`, "METHOD other. ENDMETHOD.", `METHODS other ${signature}.`);
    assert.deepEqual(p.partial, []);
    assert.equal(owns(p), false, signature);
  }
  const p = compile("other( mem ).", "METHOD other. ENDMETHOD.", "METHODS other IMPORTING VALUE(p) TYPE xstring.");
  assert.deepEqual(p.partial, []);
  assert.equal(owns(p), true);
  assert.match(emitGo(p), /OTHER\(s, mem\.Snapshot\(\)\)/);
});

test("components, rows, generic boxing and RETURNING targets retain their ABI", () => {
  const p = compile(`TYPES: BEGIN OF row, bytes TYPE xstring, END OF row.
    DATA r TYPE row. DATA rows TYPE STANDARD TABLE OF xstring WITH DEFAULT KEY.
    r-bytes = mem. APPEND mem TO rows.`);
  assert.deepEqual(p.partial, []);
  const go = emitGo(p);
  assert.match(go, /bytes string/);
  assert.match(go, /rows \[\]string/);
  // Unknown table write contexts conservatively retain the source too.
  assert.equal(owns(p), false);
  const ret = compile("other( RECEIVING p = mem ).", "METHOD other. ENDMETHOD.", "METHODS other RETURNING VALUE(p) TYPE xstring.");
  assert.equal(owns(ret), false);
});

test("an uncompiled method cannot hide an attribute escape", () => {
  const p = compile("mv_mem = '1234'.", "METHOD other. FIELD-SYMBOLS <x> TYPE xstring. ASSIGN mv_mem TO <x>. REPLACE FIRST OCCURRENCE OF mv_mem IN mv_mem WITH mv_mem IN BYTE MODE. ENDMETHOD.", "METHODS other.");
  assert.equal(analyzeOwnership(p).declarations.has(p.classes[0].attributes[0]), false);
  assert.doesNotMatch(emitGo(p), /mv_mem hXbuf.Buffer/);
});

test("local names in separate methods have separate ownership decisions", () => {
  const p = compile("mem = '1234'.", "METHOD other. DATA mem TYPE xstring. helper( CHANGING p = mem ). ENDMETHOD. METHOD helper. ENDMETHOD.", "METHODS other. METHODS helper CHANGING p TYPE xstring.");
  assert.deepEqual(p.partial, []);
  assert.equal(owns(p), true);
  const other = p.classes[0].methods.find((m) => m.name === "OTHER");
  assert.equal(analyzeOwnership(p).declarations.has(other.locals.find((v) => v.name === "MEM")), false);
});

test("boxing a computed length cannot bind the memory slot", () => {
  const p = compile("mem = '1234'.");
  const method = p.classes[0].methods[0];
  const mem = {e: "var", name: "MEM", type: {k: "xstring"}};
  const boxed = {e: "wrap", x: {e: "xstrlen", x: mem, type: {k: "i"}}, type: {k: "data"}};
  method.body.push({s: "call", call: {e: "call", method: "OTHER", static: true,
    args: [{dir: "importing", byValue: false, type: {k: "data"}, value: boxed}], type: {k: "void"}}});
  assert.equal(owns(p), true);
  assert.match(emitGo(p), /mem\.Len\(\)/);
  boxed.x = mem;
  assert.equal(owns(p), false);
});

test("constructor local ownership survives the emitter's constructor wrapper", () => {
  const p = compile("", "METHOD constructor. DATA memory TYPE xstring. memory = '1234'. CLEAR memory. ENDMETHOD.", "METHODS constructor.");
  assert.deepEqual(p.partial, []);
  const go = emitGo(p);
  assert.match(go, /memory hXbuf.Buffer/);
  assert.match(go, /memory\.Set\(/);
  assert.match(go, /memory\.Clear\(/);
});
