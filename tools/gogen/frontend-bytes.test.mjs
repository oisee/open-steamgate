import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";

function compile(statement, declarations = "DATA xs TYPE xstring. DATA p TYPE xstring. DATA m TYPE i. DATA ml TYPE i.") {
  const dir = mkdtempSync(join(tmpdir(), "gogen-byte-frontend-"));
  try {
    writeFileSync(join(dir, "zcl_byte_frontend.clas.abap"), `CLASS zcl_byte_frontend DEFINITION PUBLIC FINAL CREATE PUBLIC.
PUBLIC SECTION. CLASS-METHODS run.
ENDCLASS.
CLASS zcl_byte_frontend IMPLEMENTATION.
METHOD run. ${declarations} ${statement} ENDMETHOD.
ENDCLASS.`);
    return compileProgram({folders: [dir], objects: ["ZCL_BYTE_FRONTEND"], tolerant: true});
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

test("byte FIND LENGTH is the section bound and offset/length targets are separate", () => {
  for (const section of ["OFFSET 1 LENGTH 5", "LENGTH 5", "OFFSET 1"]) {
    const p = compile(`FIND p IN SECTION ${section} OF xs IN BYTE MODE MATCH OFFSET m MATCH LENGTH ml.`);
    assert.deepEqual(p.partial, []);
    const st = p.classes[0].methods[0].body[0];
    assert.equal(st.s, "find_bytes");
    assert.equal(st.subject.name, "XS");
    assert.equal(st.off.name, "M");
    assert.equal(st.len.name, "ML");
    assert.equal(!!st.secLen, section.includes("LENGTH"));
    assert.match(emitGo(p), /abap.FindBytes/);
  }
});

test("byte REPLACE accepts either default and fixed or variable byte targets", () => {
  for (const section of ["OFFSET 1 LENGTH 2", "LENGTH 2", "OFFSET 1"]) {
    for (const type of ["xstring", "x LENGTH 4"]) {
      const p = compile(`REPLACE SECTION ${section} OF xs WITH p IN BYTE MODE.`, `DATA xs TYPE ${type}. DATA p TYPE xstring.`);
      assert.deepEqual(p.partial, []);
      assert.equal(p.classes[0].methods[0].body[0].s, "replace_bytes");
      assert.match(emitGo(p), /abap.ReplaceBytes/);
    }
  }
});

test("other byte FIND and REPLACE forms keep their refusals", () => {
  for (const statement of [
    "REPLACE FIRST OCCURRENCE OF p IN xs WITH p IN BYTE MODE.",
    "FIND REGEX p IN xs IN BYTE MODE MATCH OFFSET m.",
    "FIND ALL OCCURRENCES OF p IN xs IN BYTE MODE MATCH COUNT m.",
  ]) {
    const p = compile(statement);
    assert.equal(p.partial.length, 1);
    assert.match(p.partial[0], /(?:REPLACE|FIND) form:/);
  }
  const p = compile("REPLACE SECTION OFFSET 1 LENGTH 2 OF xs WITH p.", "DATA xs TYPE string. DATA p TYPE string.");
  assert.match(p.partial[0], /REPLACE SECTION form:/);
});
