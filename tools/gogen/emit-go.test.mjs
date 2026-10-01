import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, basename} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("a source literal naming datearith does not add an unused Go import", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-import-source-"));
  const goDir = mkdtempSync(join(here, "go", "cmd", "gogen-import-test-"));
  try {
    writeFileSync(join(sourceDir, "zcl_gogen_import_test.clas.abap"), `
CLASS zcl_gogen_import_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_import_test IMPLEMENTATION.
  METHOD run.
    rv = 'datearith.'.
  ENDMETHOD.
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_IMPORT_TEST"]});
    const generated = emitGo(program);
    assert.match(generated, /"datearith\."/);
    assert.doesNotMatch(generated, /"osg\/gogen\/datearith"/);
    writeFileSync(join(goDir, "zz_generated.go"), generated);
    const build = spawnSync("go", ["test", `./cmd/${basename(goDir)}`], {
      cwd: join(here, "go"), encoding: "utf8", timeout: 120000,
    });
    assert.equal(build.error, undefined, build.stderr);
    assert.equal(build.status, 0, build.stderr || build.stdout);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
    rmSync(goDir, {recursive: true, force: true});
  }
});

test("an ABAP parameter named like a helper package does not shadow it", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-shadow-source-"));
  const goDir = mkdtempSync(join(here, "go", "cmd", "gogen-shadow-test-"));
  try {
    // `charsearch` is both the parameter and the package CS compiles to;
    // without an alias the parameter hides the package (stoker's tstmp case)
    writeFileSync(join(sourceDir, "zcl_gogen_shadow_test.clas.abap"), `
CLASS zcl_gogen_shadow_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run IMPORTING charsearch TYPE string RETURNING VALUE(rv) TYPE abap_bool.
ENDCLASS.
CLASS zcl_gogen_shadow_test IMPLEMENTATION.
  METHOD run.
    IF charsearch CS 'b'.
      rv = abap_true.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_SHADOW_TEST"]});
    const generated = emitGo(program);
    assert.match(generated, /hCharsearch "osg\/gogen\/charsearch"/);
    writeFileSync(join(goDir, "zz_generated.go"), generated);
    const build = spawnSync("go", ["vet", `./cmd/${basename(goDir)}`], {
      cwd: join(here, "go"), encoding: "utf8", timeout: 120000,
    });
    assert.equal(build.error, undefined, build.stderr);
    assert.equal(build.status, 0, build.stderr || build.stdout);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
    rmSync(goDir, {recursive: true, force: true});
  }
});

test("another class's public static attribute is read in expressions after its constructor", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-static-source-"));
  const goDir = mkdtempSync(join(here, "go", "cmd", "gogen-static-test-"));
  try {
    writeFileSync(join(sourceDir, "zcl_gogen_static_owner.clas.abap"), `
CLASS zcl_gogen_static_owner DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-DATA gv_y TYPE i.
    CLASS-METHODS class_constructor.
ENDCLASS.
CLASS zcl_gogen_static_owner IMPLEMENTATION.
  METHOD class_constructor.
    gv_y = 7.
  ENDMETHOD.
ENDCLASS.
`);
    writeFileSync(join(sourceDir, "zcl_gogen_static_reader.clas.abap"), `
CLASS zcl_gogen_static_reader DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_static_reader IMPLEMENTATION.
  METHOD run.
    rv = zcl_gogen_static_owner=>gv_y + 1.
    IF zcl_gogen_static_owner=>gv_y = 7.
      rv = rv + 1.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_STATIC_READER"]});
    const generated = emitGo(program);
    assert.doesNotMatch(generated, /NOT_COMPILED in ZCL_GOGEN_STATIC_READER=>RUN/);
    writeFileSync(join(goDir, "zz_generated.go"), generated);
    writeFileSync(join(goDir, "zz_generated_test.go"), `package main\nimport ("testing"; "osg/gogen/abap")\nfunc TestRead(t *testing.T) { if got := ZCL_GOGEN_STATIC_READER_RUN(&abap.Session{}); got != 9 { t.Fatalf("got %d", got) } }\n`);
    const run = spawnSync("go", ["test", `./cmd/${basename(goDir)}`], {cwd: join(here, "go"), encoding: "utf8", timeout: 120000});
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
    rmSync(goDir, {recursive: true, force: true});
  }
});
