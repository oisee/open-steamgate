package main

import (
	"testing"

	"osg/gogen/abap"
	"osg/gogen/enq"
	"osg/gogen/hostclass"
)

func TestOsgoLUWStatements(t *testing.T) {
	for _, bound := range []bool{false, true} {
		for _, action := range []string{"commit-update", "commit-no-update", "rollback", "plain-end"} {
			name := action
			if bound {
				name += "-bound"
			} else {
				name += "-holder"
			}
			t.Run(name, func(t *testing.T) {
				host := adtHost
				step, other := &abap.Session{}, &abap.Session{}
				host.Begin(step)
				host.Begin(other)
				defer host.Finish(step, false)
				defer host.Finish(other, false)
				if bound {
					id := t.Name()
					defer adtKernel.End(id)
					if ok, err := hostclass.ZCL_OSD_ENQ_KERNEL.Bind(step, id, "USER"); !ok || err != nil {
						t.Fatalf("bind: %v %v", ok, err)
					}
				}
				enqueue := func(caller any, value string) {
					r := lockRequest(value)
					r.Scope = 2
					if result, err := host.Enqueue(caller, r, nil); err != nil || result.Subrc != 0 {
						t.Fatalf("enqueue: %+v %v", result, err)
					}
				}
				rows := func(value string) int {
					n := 0
					for _, row := range adtLocks.Read(enq.Filter{Table: "ZOSD_CMD"}) {
						if row.Arg == value {
							n++
						}
					}
					return n
				}
				enqueue(step, "BEFORE")
				enqueue(other, "OTHER")
				switch action {
				case "commit-update", "commit-no-update":
					updated := action == "commit-update"
					step.UpdateTask = updated
					abap.GeneratedCommitWork(step)
					if step.UpdateTask {
						t.Fatal("commit did not clear update flag")
					}
				case "rollback":
					step.UpdateTask = true
					abap.GeneratedRollbackWork(step)
					if step.UpdateTask {
						t.Fatal("rollback did not clear update flag")
					}
				}
				want := 1
				if action == "commit-update" || action == "rollback" {
					want = 0
				}
				if got := rows("BEFORE"); got != want {
					t.Fatalf("after %s: locks %d want %d", action, got, want)
				}
				if rows("OTHER") != 1 {
					t.Fatal("statement touched another step's session")
				}
				enqueue(step, "AFTER")
				runDialogStep(step, func() {}, false)
				if bound {
					if rows("BEFORE") != want || rows("AFTER") != 1 {
						t.Fatal("step end performed an extra LUW operation")
					}
				} else if rows("BEFORE") != 0 || rows("AFTER") != 0 {
					t.Fatal("holder survived step end")
				}
			})
		}
	}
}

func TestOsgoLUWWithoutSession(t *testing.T) {
	host := adtHost
	step := &abap.Session{}
	for _, updated := range []bool{false, true} {
		step.UpdateTask = updated
		abap.GeneratedCommitWork(step)
	}
	abap.GeneratedRollbackWork(step)
	if !host.Begin(step) {
		t.Fatal("LUW hook created a step/session")
	}
	defer host.Finish(step, false)
}
