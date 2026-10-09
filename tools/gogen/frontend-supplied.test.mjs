import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";

// #694 critic: IS SUPPLIED expanded from a macro of another include is not
// in the main file's raw text, only in its parsed structure
test("IS SUPPLIED reached through a macro gives the method its SUP_ parameter", () => {
  const dir = mkdtempSync(join(tmpdir(), "gogen-supplied-"));
  try {
    writeFileSync(join(dir, "zcl_probe.clas.macros.abap"), "DEFINE check_arg.\n  IF &1 IS SUPPLIED. rv = 1. ENDIF.\nEND-OF-DEFINITION.\n");
    writeFileSync(join(dir, "zcl_probe.clas.abap"), [
      "CLASS zcl_probe DEFINITION PUBLIC.", "  PUBLIC SECTION.",
      "    CLASS-METHODS run IMPORTING iv TYPE i OPTIONAL RETURNING VALUE(rv) TYPE i.", "ENDCLASS.",
      "CLASS zcl_probe IMPLEMENTATION.", "  METHOD run.", "    check_arg iv.", "  ENDMETHOD.", "ENDCLASS.", ""].join("\n"));
    const program = compileProgram({folders: [dir], objects: ["ZCL_PROBE"], tolerant: true});
    assert.deepEqual([...program.supplied.get("ZCL_PROBE=>RUN") ?? []], ["IV"]);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
