package abap

import (
 "errors"
 "testing"

 "osg/gogen/hostclass"
)

func TestGeneratedLUWDatabaseOrder(t *testing.T) {
 if err := OpenDB([]byte(`["CREATE TABLE t (id TEXT)"]`)); err != nil { t.Fatal(err) }
 defer func(){db.Close(); db=nil; tx=nil; hostclass.LUW.Commit=nil; hostclass.LUW.Rollback=nil}()
 s:=&Session{}
 rows:=func()int {r,err:=conn().Query("SELECT COUNT(*) FROM t"); if err!=nil {t.Fatal(err)}; defer r.Close(); r.Next(); var n int; if err:=r.Scan(&n); err!=nil {t.Fatal(err)}; return n}
 DialogStep(func(){
  conn().Exec("INSERT INTO t VALUES ('A')")
  old:=tx
  s.UpdateTask=true
  hostclass.LUW.Commit=func(step any,u bool)error {
   if step!=any(s)||!u||s.UpdateTask||tx==old {t.Fatal("commit hook preceded database commit/reset")}
   RollbackWork(s)
   if rows()!=1 {t.Fatal("row was not committed before hook")}
   return nil
  }
  GeneratedCommitWork(s)
  conn().Exec("INSERT INTO t VALUES ('B')")
  old=tx
  s.UpdateTask=true
  hostclass.LUW.Rollback=func(step any)error {
   if step!=any(s)||s.UpdateTask||tx==old||rows()!=1 {t.Fatal("rollback hook preceded database rollback/reset")}
   return nil
  }
  GeneratedRollbackWork(s)
 })
}

func TestGeneratedLUWStateAndErrors(t *testing.T) {
 defer func(){hostclass.LUW.Commit=nil; hostclass.LUW.Rollback=nil}()
 s:=&Session{}
 boom:=errors.New("host failed")
 for _,finish:=range []func(*Session){GeneratedCommitWork,GeneratedRollbackWork} {
  s.UpdateTask=true
  finish(s)
  if s.UpdateTask {t.Fatal("nil hook left update state")}
  hostclass.LUW.Commit=func(any,bool)error{return boom}
  hostclass.LUW.Rollback=func(any)error{return boom}
  s.UpdateTask=true
  var dump any
  func(){defer func(){dump=recover()}(); finish(s)}()
  if dump!=boom||s.UpdateTask {t.Fatalf("dump=%v state=%v",dump,s.UpdateTask)}
  hostclass.LUW.Commit=nil; hostclass.LUW.Rollback=nil
 }
}
