import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, basename} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {CmpNumericData, cell, TP, TI, TF} from "./js/abap.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("nested string builder loops do not retain deferred buffers", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-builder-loop-"));
  try {
    writeFileSync(join(sourceDir, "zcl_gogen_builder_loop.clas.abap"), `
CLASS zcl_gogen_builder_loop DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_builder_loop IMPLEMENTATION.
  METHOD run.
    DATA lv TYPE string.
    DO 60000 TIMES.
      DO 1 TIMES.
        lv = lv && 'x'.
      ENDDO.
      rv = strlen( lv ).
    ENDDO.
  ENDMETHOD.
ENDCLASS.
`);
    const go = emitGo(compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_BUILDER_LOOP"]}));
    assert.match(go, /strings\.Builder/);
    assert.doesNotMatch(go, /defer func\(\) \{ if active_sb_/);
    assert.doesNotMatch(go, /active_sb_/);
  } finally { rmSync(sourceDir, {recursive: true, force: true}); }
});

test("TRY handlers block builders only for strings they observe", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-builder-try-"));
  try {
    writeFileSync(join(sourceDir, "zcl_gogen_builder_try.clas.abap"), `
CLASS zcl_gogen_builder_try DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_builder_try IMPLEMENTATION.
  METHOD run.
    DATA seen TYPE string.
    DATA free TYPE string.
    DO 3 TIMES.
      seen = seen && 'a'.
      free = free && 'b'.
    ENDDO.
    rv = free.
  ENDMETHOD.
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_BUILDER_TRY"]});
    const method = program.classes[0].methods.find((m) => m.name === "RUN");
    const loop = method.body.find((st) => st.s === "do");
    const readSeen = {s: "assign", target: {e: "var", name: "rv", type: {k: "string"}}, value: {e: "var", name: "seen", type: {k: "string"}}};
    method.body = [{s: "try", body: [loop], catches: [{covers: ["CX_ROOT"], own: [], body: [readSeen]}], cleanup: [readSeen]}, ...method.body.filter((st) => st !== loop)];
    const go = emitGo(program);
    assert.match(go, /sb_free_/);
    assert.doesNotMatch(go, /sb_seen_/);
  } finally { rmSync(sourceDir, {recursive: true, force: true}); }
});

test("numeric generic SUBTRACTSECS reaches its Go native", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-tstmp-native-"));
  const goDir = mkdtempSync(join(here, "go", "cmd", "gogen-tstmp-test-"));
  try {
    writeFileSync(join(sourceDir, "cl_abap_tstmp.clas.abap"), `
CLASS cl_abap_tstmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS subtractsecs IMPORTING tstmp TYPE p secs TYPE numeric RETURNING VALUE(r) TYPE p.
ENDCLASS.
CLASS cl_abap_tstmp IMPLEMENTATION.
  METHOD subtractsecs.
  ENDMETHOD.
ENDCLASS.
`);
    writeFileSync(join(sourceDir, "zcl_gogen_tstmp_native.clas.abap"), `
CLASS zcl_gogen_tstmp_native DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE p.
ENDCLASS.
CLASS zcl_gogen_tstmp_native IMPLEMENTATION.
  METHOD run.
    rv = cl_abap_tstmp=>subtractsecs( tstmp = rv secs = 60 ).
  ENDMETHOD.
ENDCLASS.
`);
    const go = emitGo(compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_TSTMP_NATIVE", "CL_ABAP_TSTMP"]}));
    assert.match(go, /hTstmpsecs\.SubtractSecs/);
    writeFileSync(join(goDir, "zz_generated.go"), go);
    const build = spawnSync("go", ["test", "-vet=off", `./cmd/${basename(goDir)}`], {cwd: join(here, "go"), encoding: "utf8", timeout: 120000});
    assert.equal(build.status, 0, build.stderr || build.stdout);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
    rmSync(goDir, {recursive: true, force: true});
  }
});

test("generic numeric comparison keeps packed decimal boundaries in JS", () => {
  assert.equal(CmpNumericData(cell("1.5", TP(4, 1)), cell("1.4", TP(4, 1))), 1);
  assert.equal(CmpNumericData(cell(1, TI), cell("1.4", TP(4, 1))), -1);
  assert.equal(CmpNumericData(cell(1.5, TF), cell("1.5", TP(4, 1))), 0);
});

test("SELECT clauses come from syntax nodes, not WHERE string literals", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-select-literals-"));
  try {
    const table = readFileSync(join(here, "testdata", "zgogen_t_dbw.tabl.xml"), "utf8")
      .replace("<INTLEN>000020</INTLEN>", "<INTLEN>000160</INTLEN>")
      .replace("<LENG>000010</LENG>", "<LENG>000080</LENG>");
    writeFileSync(join(sourceDir, "zgogen_t_dbw.tabl.xml"), table);
    writeFileSync(join(sourceDir, "zcl_gogen_select_literals.clas.abap"), `
CLASS zcl_gogen_select_literals DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS run RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_select_literals IMPLEMENTATION.
  METHOD run.
    DATA lt TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    SELECT id FROM zgogen_t_dbw INTO TABLE lt WHERE id = 'UP TO 1 ROWS APPENDING TABLE'.
    SELECT id FROM zgogen_t_dbw APPENDING TABLE lt WHERE id = 'UP TO 1 ROWS'.
    SELECT id FROM zgogen_t_dbw INTO TABLE lt UP TO 2 ROWS WHERE id = 'APPENDING TABLE'.
    rv = lines( lt ).
  ENDMETHOD.
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_SELECT_LITERALS"]});
    const method = program.classes.find((c) => c.name === "ZCL_GOGEN_SELECT_LITERALS").methods.find((m) => m.name === "RUN");
    assert.ok(method, JSON.stringify({methods: program.classes[0].methods, skipped: program.skipped, partial: program.partial}));
    const selects = method.body.filter((s) => s.s === "select_table");
    assert.equal(selects.length, 3, JSON.stringify(method.body));
    assert.deepEqual(selects.map((s) => s.appending), [false, true, false]);
    assert.doesNotMatch(selects[0].sql, /LIMIT/i);
    assert.doesNotMatch(selects[1].sql, /LIMIT/i);
    assert.match(selects[2].sql, /LIMIT 2/i);
    assert.doesNotMatch(emitGo(program), /NOT_COMPILED in ZCL_GOGEN_SELECT_LITERALS/);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
  }
});

test("FOR ALL ENTRIES with APPENDING, UP TO or ORDER BY is refused, not run without the clause", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-select-fae-"));
  try {
    copyFileSync(join(here, "testdata", "zgogen_t_dbw.tabl.xml"), join(sourceDir, "zgogen_t_dbw.tabl.xml"));
    const method = (name, statement) => `  METHOD ${name}.
    TYPES: BEGIN OF ty_key, id TYPE c LENGTH 10, END OF ty_key.
    DATA lt TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lt_keys TYPE STANDARD TABLE OF ty_key WITH DEFAULT KEY.
    ${statement}
    rv = lines( lt ).
  ENDMETHOD.`;
    const fae = "FOR ALL ENTRIES IN lt_keys WHERE id = lt_keys-id";
    writeFileSync(join(sourceDir, "zcl_gogen_select_fae.clas.abap"), `
CLASS zcl_gogen_select_fae DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS plain RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS appending RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS upto RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS ordered RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_select_fae IMPLEMENTATION.
${method("plain", `SELECT id FROM zgogen_t_dbw INTO TABLE lt ${fae}.`)}
${method("appending", `SELECT id FROM zgogen_t_dbw APPENDING TABLE lt ${fae}.`)}
${method("upto", `SELECT id FROM zgogen_t_dbw INTO TABLE lt UP TO 3 ROWS ${fae}.`)}
${method("ordered", `SELECT id FROM zgogen_t_dbw INTO TABLE lt ${fae} ORDER BY id.`)}
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_SELECT_FAE"]});
    const generated = emitGo(program);
    const cls = program.classes.find((c) => c.name === "ZCL_GOGEN_SELECT_FAE");
    const compiled = (name) => cls.methods.some((m) => m.name === name && m.body.some((st) => st.s === "select_table" && st.fae));
    assert.ok(compiled("PLAIN"), "a plain FOR ALL ENTRIES still compiles");
    for (const [name, clause] of [["APPENDING", "APPENDING"], ["UPTO", "UP TO"], ["ORDERED", "ORDER BY"]]) {
      assert.ok(!compiled(name), `${name} must not compile`);
      assert.match(generated, new RegExp(`ZCL_GOGEN_SELECT_FAE=>${name}[^\n]*(FOR ALL ENTRIES with ${clause}|${clause})`), `${name} is refused, and the reason names ${clause}`);
    }
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
  }
});

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
    // osgo.mjs and osabap.mjs both use the default emitter mode.
    assert.doesNotMatch(generated, /session\.Register\(/);
    assert.doesNotMatch(generated, /"osg\/gogen\/session"/);
    assert.match(emitGo(program, "main", null, true), /session\.Register\(/);
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

test("an inline SELECT table name in one method does not hide a local of another method", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-inline-source-"));
  const goDir = mkdtempSync(join(here, "go", "cmd", "gogen-inline-test-"));
  try {
    copyFileSync(join(here, "apps", "notes", "znotes.tabl.xml"), join(sourceDir, "znotes.tabl.xml"));
    writeFileSync(join(sourceDir, "zcl_gogen_inline_scope.clas.abap"), `
CLASS zcl_gogen_inline_scope DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS rows RETURNING VALUE(rv) TYPE i.
    CLASS-METHODS number RETURNING VALUE(rv) TYPE i.
ENDCLASS.
CLASS zcl_gogen_inline_scope IMPLEMENTATION.
  METHOD rows.
    SELECT id FROM znotes INTO TABLE @DATA(lt).
    rv = lines( lt ).
  ENDMETHOD.
  METHOD number.
    DATA(lt) = 3.
    rv = lt.
  ENDMETHOD.
ENDCLASS.
`);
    const program = compileProgram({folders: [sourceDir], objects: ["ZCL_GOGEN_INLINE_SCOPE"]});
    const generated = emitGo(program);
    assert.doesNotMatch(generated, /NOT_COMPILED in ZCL_GOGEN_INLINE_SCOPE/);
    writeFileSync(join(goDir, "zz_generated.go"), generated);
    const build = spawnSync("go", ["test", `./cmd/${basename(goDir)}`], {
      cwd: join(here, "go"), encoding: "utf8", timeout: 120000,
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
    rmSync(goDir, {recursive: true, force: true});
  }
});
