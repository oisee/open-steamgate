import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";
import {libraryPath} from "../osd-lib-path.mjs";
import {home} from "./home.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const core = libraryPath(home, "open-abap-core");

test("KERNEL_LOCK hooks receive SAP-shaped requests and map results", {timeout: 120000}, () => {
  const goDir = mkdtempSync(join(here, "go", "cmd", `gogen-enqseam-test-${process.pid}-`));
  try {
    const program = compileProgram({folders: [core, join(here, "testdata-enq-seam")], objects: ["ZCL_GOGEN_ENQ_SEAM"]});
    writeFileSync(join(goDir, "zz_generated.go"), emitGo(program));
    writeFileSync(join(goDir, "seam_test.go"), String.raw`
package main

import (
 "errors"
 "fmt"
 "testing"
 "time"

 "osg/gogen/abap"
 "osg/gogen/enq"
 "osg/gogen/hostclass"
)

func TestKernelLockSeam(t *testing.T) {
 s := &abap.Session{}
 h := &hostclass.KERNEL_LOCK
 defer func() { h.Enqueue, h.Dequeue, h.DequeueAll = nil, nil, nil }()
 ZCL_GOGEN_ENQ_SEAM_ALL_KEYS(s)
 req := requests[len(requests)-1]
 want := enq.Request{Client: "100", Table: "ZGOGEN_ENQ_TAB", Object: "EZGOGEN_ENQ", Mode: "X", Scope: 3,
 Fields: []enq.Field{{Value: "OBJ", Length: 10}, {Value: "0017", Length: 4}}}
 if fmt.Sprint(req) != fmt.Sprint(want) || waits != 1 { t.Fatalf("all keys: %#v waits %d", req, waits) }
 ZCL_GOGEN_ENQ_SEAM_GENERIC_KEYS(s)
 req = requests[len(requests)-1]
 want = enq.Request{Client: "123", Table: "ZGOGEN_ENQ_TAB", Object: "EZGOGEN_ENQ", Mode: "E", Scope: 2,
  Fields: []enq.Field{{Generic: true, Length: 10}, {Value: "0000", Generic: true, Length: 4}}}
 if fmt.Sprint(req) != fmt.Sprint(want) { t.Fatalf("generic: %#v", req) }
 if nilSleeps != 1 { t.Fatalf("sleep is not nil without _WAIT: %d", nilSleeps) }
 ZCL_GOGEN_ENQ_SEAM_LITERAL_AND_NUMC_ZERO(s)
 req = requests[len(requests)-1]
 if req.Fields[0].Generic || req.Fields[0].Value != "" || !req.Fields[1].Generic || req.Fields[1].Value != "0000" { t.Fatalf("literal/zero: %#v", req) }
 ZCL_GOGEN_ENQ_SEAM_DEFAULTS(s)
 req = requests[len(requests)-1]
 if req.Mode != "E" || req.Scope != 2 || !req.Fields[1].Generic || req.Fields[1].Value != "" { t.Fatalf("defaults: %#v", req) }

 // the step is the caller's own Session, before and after a yield sleep
 var before, after any
 h.Enqueue = func(step any, r enq.Request, sleep func(time.Duration)) (enq.Result, error) {
  before = step
  if sleep != nil { sleep(time.Millisecond) }
  after = step
  return enq.Result{}, nil
 }
 ZCL_GOGEN_ENQ_SEAM_ALL_KEYS(s)
 if before != any(s) || after != any(s) { t.Fatal("the lock hook did not get the calling step's Session") }
 h.Enqueue = func(any, enq.Request, func(time.Duration)) (enq.Result, error) { return enq.Result{Subrc: 1, Msgno: "601", Holder: "OTHER"}, nil }
 ZCL_GOGEN_ENQ_SEAM_FOREIGN_LOCK(s)
 if s.Sy.Subrc != 1 || s.Sy.Msgid != "MC" || s.Sy.Msgty != "E" || s.Sy.Msgno != "601" || s.Sy.Msgv1 != "OTHER" { t.Fatalf("foreign: %#v", s.Sy) }
 h.Enqueue = func(any, enq.Request, func(time.Duration)) (enq.Result, error) { return enq.Result{Subrc: 9}, nil }
 ZCL_GOGEN_ENQ_SEAM_SYSTEM_FAILURE(s)
 if s.Sy.Subrc != 2 { t.Fatalf("system failure: %d", s.Sy.Subrc) }
 h.Enqueue = func(any, enq.Request, func(time.Duration)) (enq.Result, error) { return enq.Result{}, errors.New("host down") }
 var dumped any
 func() { defer func() { dumped = recover() }(); ZCL_GOGEN_ENQ_SEAM_DEFAULTS(s) }()
 if dumped == nil { t.Fatal("error was swallowed") }
 hookCalls = 0
 h.Enqueue = func(any, enq.Request, func(time.Duration)) (enq.Result, error) { hookCalls++; return enq.Result{}, nil }
 ZCL_GOGEN_ENQ_SEAM_COLLECT(s)
 if s.Sy.Subrc != 2 || hookCalls != 0 { t.Fatalf("collect: rc %d calls %d", s.Sy.Subrc, hookCalls) }
 hostclass.KERNEL_LOCK.Enqueue = nil
 var nilHook any
 func() { defer func() { nilHook = recover() }(); ZCL_GOGEN_ENQ_SEAM_DEFAULTS(s) }()
 if nilHook == nil { t.Fatal("nil Enqueue hook changed the refusal") }

 hostclass.KERNEL_LOCK.Dequeue = func(_ any, r enq.Request) error { requests = append(requests, r); return nil }
 ZCL_GOGEN_ENQ_SEAM_DEQUEUE(s)
 req = requests[len(requests)-1]
 if req.Mode != "E" || req.Scope != 2 || req.Client != "100" { t.Fatalf("dequeue count %d: %#v", len(requests), req) }
 var nilDequeue any
 h.Dequeue = nil
 func() { defer func() { nilDequeue = recover() }(); ZCL_GOGEN_ENQ_SEAM_DEQUEUE(s) }()
 if nilDequeue == nil { t.Fatal("nil Dequeue hook changed the refusal") }

 h.DequeueAll = func(any) error { return nil }
 ZCL_GOGEN_ENQ_SEAM_DEQUEUE_ALL(s)
 if s.Sy.Subrc != 0 { t.Fatalf("dequeue all: %d", s.Sy.Subrc) }
 var nilAll any
 h.DequeueAll = nil
 func() { defer func() { nilAll = recover() }(); ZCL_GOGEN_ENQ_SEAM_DEQUEUE_ALL(s) }()
 if nilAll == nil { t.Fatal("nil DequeueAll hook changed the refusal") }
}

var requests []enq.Request
var waits, hookCalls, nilSleeps int

func init() {
 hostclass.KERNEL_LOCK.Enqueue = func(step any, r enq.Request, sleep func(time.Duration)) (enq.Result, error) {
 hookCalls++
 requests = append(requests, r)
 if sleep == nil { waits--; nilSleeps++ } else { waits++ }
 return enq.Result{}, nil
 }
 hostclass.KERNEL_LOCK.Dequeue = func(step any, r enq.Request) error { requests = append(requests, r); return nil }
}
`);
    const run = spawnSync("go", ["test", "-vet=off", "-timeout=10s", `./cmd/${basename(goDir)}`], {
      cwd: join(here, "go"), encoding: "utf8", timeout: 110000,
      env: {...process.env, GOFLAGS: "-buildvcs=false", GOCACHE: process.env.GOCACHE ?? join(home, ".local/enqseam/go-cache")},
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    rmSync(goDir, {recursive: true, force: true});
  }
});
