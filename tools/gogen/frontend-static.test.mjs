import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitSectionStatement} from "./emit-js-section.mjs";
import * as abap from "./js/abap.mjs";
import {emitJs} from "./emit-js.mjs";
import {analyzeOwnership} from "./frontend-owned.mjs";

const fixtures = new URL("./testdata/", import.meta.url).pathname;
const objects = ["staticstate", "staticwrite", "staticoracle", "staticrec", "chunkstate", "chunk_a", "chunk_b"].map((s) => `ZCL_GOGEN_T_${s.toUpperCase()}`);

test("static writes, constructor ordering, and depth 2000 mutual interface calls in JS", async () => {
  const program = compileProgram({folders: [fixtures], objects});
  assert.deepEqual(program.skipped, []);
  const ownership = analyzeOwnership(program);
  const state = program.classes.find((c) => c.name === "ZCL_GOGEN_T_STATICSTATE");
  assert.equal(ownership.declarations.has(state.attributes.find((a) => a.name === "GV_MEM")), false);
  const dir = mkdtempSync(join(tmpdir(), "gogen-static-"));
  try {
    const file = join(dir, "generated.mjs");
    writeFileSync(file, emitJs(program, new URL("./js/abap.mjs", import.meta.url).href));
    const m = await import(pathToFileURL(file).href);
    const session = {sy: {index: 0, tabix: 0, subrc: 0, dbcnt: 0}};
    assert.equal(m.ZCL_GOGEN_T_STATICWRITE.RUN(session), "1/00ABCD00/4/00EE/aXYd!/0000EE00/7/19/0/9000000000/2/7");
    assert.equal(m.ZCL_GOGEN_T_STATICREC.RUN(session), "2001");
    const oracle = m.ZCL_GOGEN_T_STATICORACLE;
    for (const [method, expected] of [["W_ASSIGN", 6], ["W_INT8", 9000000000n], ["W_REPLACE", "00ABCD00"], ["W_CONCAT", "11EE"], ["R_OFFSET", 127], ["W_CLEAR", 0]]) {
      const got = oracle[method](session);
      assert.equal(typeof expected === "string" ? Buffer.from(got, "latin1").toString("hex").toUpperCase() : got, expected, method);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("external READ-ONLY writes and output actuals are refused before emission", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-static-readonly-"));
  try {
    for (const statement of ["zcl_gogen_t_staticstate=>gv_init = 9.", "CLEAR zcl_gogen_t_staticstate=>gv_init.", "change( CHANGING cv = zcl_gogen_t_staticstate=>gv_init ).", "output( IMPORTING ev = zcl_gogen_t_staticstate=>gv_init )."]) {
      writeFileSync(join(dir, "zcl_static_bad.clas.abap"), `CLASS zcl_static_bad DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS run.
 CLASS-METHODS change CHANGING cv TYPE i.
 CLASS-METHODS output EXPORTING ev TYPE i.
ENDCLASS.
CLASS zcl_static_bad IMPLEMENTATION.
 METHOD run.
 ${statement}
 ENDMETHOD.
 METHOD change.
 ENDMETHOD.
 METHOD output.
 ENDMETHOD.
ENDCLASS.`);
      const program = compileProgram({folders: [dir, fixtures], objects: ["ZCL_STATIC_BAD", "ZCL_GOGEN_T_STATICSTATE"], tolerant: true});
      assert.match([...program.skipped, ...program.partial, ...program.diagnostics.map((d) => d.message)].join("\n"), /READ.?ONLY/i, statement);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test("JS section replacement validates bounds and fits fixed byte and character targets", () => {
  for (const [bytes, base, withValue, off, len, limit, expected, rc] of [
    [true, "abcd", "XYZ", 1, 1, 4, "aXYZ", 2],
    [true, "abcd", "X", 1, 2, 4, "aXd\0", 0],
    [true, "abcd", "", 1, 2, -1, "ad", 0],
    [false, "a界cd", "🙂", 1, 1, -1, "a🙂cd", 0],
    [false, "a", "X", 2, 1, 4, "a X", 0],
    [false, "abcd", "X", 1, abap.NoLength, -1, "aX", 0],
  ]) {
    const type = {k: bytes ? limit < 0 ? "xstring" : "x" : limit < 0 ? "string" : "c", len: limit};
    const st = {s: bytes ? "replace_bytes" : "replace_chars", target: {type}, with: withValue, off, len};
    const code = emitSectionStatement(st, {}, "", {place: () => "target", expr: JSON.stringify}).join("\n");
    const run = new Function("abap", "s", "target", `${code}; return [target, s.sy.subrc];`);
    assert.deepEqual(run(abap, {sy: {}}, base), [expected, rc]);
    for (const [badOff, badLen] of [[-1, 1], [5, 0], [1, 5], [1, -1]]) {
      const bad = emitSectionStatement({...st, off: badOff, len: badLen}, {}, "", {place: () => "s.target", expr: JSON.stringify}).join("\n");
      const session = {sy: {}, target: base};
      assert.throws(() => new Function("abap", "s", bad)(abap, session), /CX_SY_RANGE_OUT_OF_BOUNDS/);
      assert.equal(session.target, base);
    }
  }
});
