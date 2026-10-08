import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileProgram} from "./frontend.mjs";
import {emitGo} from "./emit-go.mjs";

const here = dirname(fileURLToPath(import.meta.url));
test("generated LUW statements notify the host with session-local update state", {timeout: 120000}, () => {
  const dir = mkdtempSync(join(here, "go/cmd/gogen-luw-seam-"));
  try {
    const program = compileProgram({folders: [join(here, "testdata-luw-seam")], objects: ["ZCL_GOGEN_LUW_SEAM"]});
    assert.deepEqual(program.skipped, []);
    writeFileSync(join(dir, "zz_generated.go"), emitGo(program));
    writeFileSync(join(dir, "seam_test.go"), String.raw`
package main
import ("testing"; "errors"; "time"; "osg/gogen/abap"; "osg/gogen/hostclass"; "osg/gogen/enqseam")
func TestLUWSeam(t *testing.T) {
 s, other := &abap.Session{}, &abap.Session{}
 h := &hostclass.LUW
 defer func(){h.Commit=nil; h.Rollback=nil; hostclass.KERNEL_LOCK.DequeueAll=nil}()
 var flags []bool
 var steps []any
 rollbacks:=0
 h.Commit=func(step any, updated bool) error {steps=append(steps,step); flags=append(flags,updated); return nil}
 h.Rollback=func(step any) error {if step!=any(s){t.Fatal("rollback session")}; rollbacks++; return nil}
 ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 ZCL_GOGEN_LUW_SEAM_COMMIT_WAIT(s)
 ZCL_GOGEN_LUW_SEAM_UPDATE(s)
 ZCL_GOGEN_LUW_SEAM_COMMIT(other)
 ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 ZCL_GOGEN_LUW_SEAM_ORDINARY(s)
 ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 ZCL_GOGEN_LUW_SEAM_UPDATE(s)
 ZCL_GOGEN_LUW_SEAM_ROLLBACK(s)
 ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 ZCL_GOGEN_LUW_SEAM_RAISING(s)
 if s.Sy.Subrc!=1 {t.Fatal("fixture did not raise")}
 ZCL_GOGEN_LUW_SEAM_COMMIT_WAIT(s)
 want:=[]bool{false,false,false,true,false,false,false,true}
 if len(flags)!=len(want){t.Fatalf("Commit calls: %v, want %v",flags,want)}
 for i,v:=range want {if flags[i]!=v {t.Fatalf("flags: %v, want %v",flags,want)}; expected:=any(s); if i==2 {expected=other}; if steps[i]!=expected {t.Fatal("commit session")}}
 if rollbacks!=1 {t.Fatalf("rollback calls: %d",rollbacks)}
 var lockStep any
 hostclass.KERNEL_LOCK.DequeueAll=func(step any) error {lockStep=step; return nil}
 enqseam.DequeueAll(s, hostclass.KERNEL_LOCK.DequeueAll)
 if lockStep!=steps[0] {t.Fatal("LUW and ENQ session differ")}
 ZCL_GOGEN_LUW_SEAM_UPDATE(s)
 ZCL_GOGEN_LUW_SEAM_WAIT(s)
 s.YieldSleep(time.Nanosecond)
 abap.DialogStep(func(){abap.CommitWork(s); abap.RollbackWork(s)})
 abap.WorkProcess.Lock()
 abap.DialogStepIn(s,func(){s.YieldSleep(time.Nanosecond)})
 abap.WorkProcess.Unlock()
 if len(flags)!=len(want)||rollbacks!=1 {t.Fatal("yield or step end notified LUW")}
 ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 if !flags[len(flags)-1] {t.Fatal("yield cleared update state")}
 for _,finish:=range []func(*abap.Session){ZCL_GOGEN_LUW_SEAM_COMMIT,ZCL_GOGEN_LUW_SEAM_ROLLBACK} {
  h.Commit=nil; h.Rollback=nil
  ZCL_GOGEN_LUW_SEAM_UPDATE(s); finish(s)
  h.Commit=func(_ any,u bool)error{if u {t.Fatal("nil hook did not clear flag")}; return nil}
  ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 }
 boom:=errors.New("host down")
 for _,finish:=range []func(*abap.Session){ZCL_GOGEN_LUW_SEAM_COMMIT,ZCL_GOGEN_LUW_SEAM_ROLLBACK} {
  h.Commit=func(any,bool)error{return boom}; h.Rollback=func(any)error{return boom}
  ZCL_GOGEN_LUW_SEAM_UPDATE(s)
  var dump any
  func(){defer func(){dump=recover()}(); finish(s)}()
  if dump!=boom {t.Fatalf("hook error swallowed: %v",dump)}
  h.Commit=func(_ any,u bool)error{if u {t.Fatal("dump did not clear flag")}; return nil}
  ZCL_GOGEN_LUW_SEAM_COMMIT(s)
 }
}
`);
    const run = spawnSync("go", ["test", "-timeout=20s", `./cmd/${basename(dir)}`], {
      cwd: join(here, "go"), encoding: "utf8", timeout: 110000,
      env: {...process.env, GOFLAGS: "-buildvcs=false", GOCACHE: join(here, ".out/go-cache")},
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
