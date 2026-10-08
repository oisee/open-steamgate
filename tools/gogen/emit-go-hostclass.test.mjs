import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {libraryPath} from "../osd-lib-path.mjs";
import {home} from "./home.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const core = libraryPath(home, "open-abap-core");

test("host-replaced kernel hooks preserve ABAP values and exceptions", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-hostclass-"));
  const goDir = mkdtempSync(join(here, "go", "cmd", "gogen-hostclass-test-"));
  try {
    for (const name of ["zcl_osd_enq_kernel.clas.abap", "zcx_osd_adt.clas.abap"]) {
      writeFileSync(join(sourceDir, name), readFileSync(join(here, "../../src/adt", name)));
    }
    writeFileSync(join(sourceDir, "zcl_gogen_host_caller.clas.abap"), `
CLASS zcl_gogen_host_caller DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS bind_catch RETURNING VALUE(rv) TYPE string.
 CLASS-METHODS end_catch_text RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_gogen_host_caller IMPLEMENTATION.
 METHOD bind_catch.
 DATA lx TYPE REF TO zcx_osd_adt.
 TRY.
 zcl_osd_enq_kernel=>bind( iv_id = 'id' iv_user = 'user' ).
 CATCH zcx_osd_adt INTO lx.
 rv = 'caught'.
 ENDTRY.
 ENDMETHOD.
 METHOD end_catch_text.
 DATA lx TYPE REF TO zcx_osd_adt.
 TRY.
 zcl_osd_enq_kernel=>end( iv_id = 'id' ).
 CATCH zcx_osd_adt INTO lx.
 rv = lx->if_message~get_text( ).
 ENDTRY.
 ENDMETHOD.
ENDCLASS.
`);
    writeFileSync(join(sourceDir, "zcl_gogen_host_compare.clas.abap"), `
CLASS zcl_gogen_host_compare DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 CLASS-METHODS stub.
ENDCLASS.
CLASS zcl_gogen_host_compare IMPLEMENTATION.
 METHOD stub.
 DATA lx TYPE REF TO zcx_osd_adt.
 lx = zcx_osd_adt=>system_not_supported( ).
 RAISE EXCEPTION lx.
 ENDMETHOD.
ENDCLASS.
`);
    const generated = emitGo(compileProgram({folders: [sourceDir, core, join(home, "src/adt")], objects: [
      "CX_ROOT", "CX_STATIC_CHECK", "ZCL_OSD_ENQ_KERNEL", "ZCX_OSD_ADT", "ZCL_GOGEN_HOST_CALLER", "ZCL_GOGEN_HOST_COMPARE",
    ]}));
    assert.match(generated, /hHostclass\.ZCL_OSD_ENQ_KERNEL\.Bind/);
    mkdirSync(goDir, {recursive: true});
    writeFileSync(join(goDir, "zz_generated.go"), generated);
    writeFileSync(join(goDir, "zz_generated_test.go"), `package main
import (
 "errors"
 "fmt"
 "testing"
 "osg/gogen/abap"
 "osg/gogen/hostclass"
)

func TestHooks(t *testing.T) {
 h := &hostclass.ZCL_OSD_ENQ_KERNEL
 if got := ZCL_GOGEN_HOST_CALLER_BIND_CATCH(&abap.Session{}); got != "caught" { t.Fatal("nil Bind hook changed the fallback") }
 var nilEnd any
 func() { defer func() { nilEnd = recover() }(); ZCL_OSD_ENQ_KERNEL_END(&abap.Session{}, "id") }()
 var fallback any
 func() { defer func() { fallback = recover() }(); ZCL_GOGEN_HOST_COMPARE_STUB(&abap.Session{}) }()
 if fmt.Sprint(nilEnd) != fmt.Sprint(fallback) { t.Fatalf("nil End hook differs from ABAP fallback: %#v vs %#v", nilEnd, fallback) }
 h.Bind = func(id, user string) (bool, error) { return id == "id" && user == "user", nil }
 h.ContextAlive = func(string) (bool, error) { return false, nil }
 h.Owns = func(string) (bool, error) { return true, nil }
 h.SessionID = func(string) (string, error) { return "session-id", nil }
 defer func() { h.Bind, h.End, h.Revive, h.ContextAlive, h.Owns, h.SessionID = nil, nil, nil, nil, nil, nil }()
 if got := ZCL_OSD_ENQ_KERNEL_BIND(&abap.Session{}, "id", "user"); got != "X" { t.Fatal(got) }
 if got := ZCL_OSD_ENQ_KERNEL_CONTEXT_ALIVE(&abap.Session{}, "id"); got != " " { t.Fatal(got) }
 if got := ZCL_OSD_ENQ_KERNEL_OWNS(&abap.Session{}, "id"); got != "X" { t.Fatal(got) }
 if got := ZCL_OSD_ENQ_KERNEL_SESSION_ID(&abap.Session{}, "id"); got != "session-id" { t.Fatal(got) }
 h.Bind = func(string, string) (bool, error) { return false, &hostclass.Raise{Class: "ZCX_OSD_ADT", Factory: "SYSTEM_NOT_SUPPORTED"} }
 if got := ZCL_GOGEN_HOST_CALLER_BIND_CATCH(&abap.Session{}); got != "caught" { t.Fatal(got) }
 h.End = func(string) error { return &hostclass.Raise{Class: "ZCX_OSD_ADT", Text: "host refused"} }
 if got := ZCL_GOGEN_HOST_CALLER_END_CATCH_TEXT(&abap.Session{}); got != "host refused" { t.Fatal(got) }
 h.End = func(string) error { return &hostclass.Raise{Class: "ZCX_OSD_ADT", Factory: "SYSTEM_NOT_SUPPORTED"} }
 var hook any
 func() { defer func() { hook = recover() }(); ZCL_OSD_ENQ_KERNEL_END(&abap.Session{}, "id") }()
 var stub any
 func() { defer func() { stub = recover() }(); ZCL_GOGEN_HOST_COMPARE_STUB(&abap.Session{}) }()
 if fmt.Sprint(hook) != fmt.Sprint(stub) { t.Fatalf("undeclared Raise differs: %#v vs %#v", hook, stub) }
 h.End = func(string) error { return errors.New("host down") }
 var plain any
 func() { defer func() { plain = recover() }(); ZCL_OSD_ENQ_KERNEL_END(&abap.Session{}, "id") }()
 if plain == nil { t.Fatal("ordinary host error was swallowed") }
}
`);
    const run = spawnSync("go", ["test", "-vet=off", `./cmd/${basename(goDir)}`], {cwd: join(here, "go"), encoding: "utf8", timeout: 120000, env: {...process.env, GOFLAGS: "-buildvcs=false", GOCACHE: "/tmp/hostcls-go-cache"}});
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    rmSync(sourceDir, {recursive: true, force: true});
    rmSync(goDir, {recursive: true, force: true});
  }
});

test("host-replaced signatures are refused with the offending parameter", () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "gogen-hostclass-bad-"));
  try {
    const source = readFileSync(join(here, "../../src/adt/zcl_osd_enq_kernel.clas.abap"), "utf8")
      .replace("iv_id TYPE string", "iv_id TYPE f");
    writeFileSync(join(sourceDir, "zcl_osd_enq_kernel.clas.abap"), source);
    writeFileSync(join(sourceDir, "zcx_osd_adt.clas.abap"), readFileSync(join(here, "../../src/adt/zcx_osd_adt.clas.abap")));
    assert.throws(() => compileProgram({folders: [core, join(home, "src/adt"), sourceDir], objects: ["ZCL_OSD_ENQ_KERNEL", "ZCX_OSD_ADT"]}),
      /ZCL_OSD_ENQ_KERNEL=>BIND IV_ID: a host-replaced method may use only string, c LENGTH 1, i, or int8/);
  } finally { rmSync(sourceDir, {recursive: true, force: true}); }
});
