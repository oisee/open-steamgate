package adtlock

import (
	"testing"

	"osg/gogen/enq"
)

func TestLUWStatements(t *testing.T) {
	for _, bound := range []bool{false, true} {
		for _, action := range []string{"commit-update", "commit-no-update", "rollback", "plain-end"} {
			name := action
			if bound {
				name += "-bound"
			} else {
				name += "-holder"
			}
			t.Run(name, func(t *testing.T) {
				host, closeServer := newHost(t)
				defer closeServer()
				step, other := new(struct{ int }), new(struct{ int })
				host.Begin(step)
				host.Begin(other)
				defer host.Finish(step, false)
				defer host.Finish(other, false)
				if bound {
					id := t.Name()
					defer host.kernel.End(id)
					if ok, err := host.bind(step, id, "USER"); !ok || err != nil {
						t.Fatalf("bind: %v %v", ok, err)
					}
				}
				enqueue := func(caller any, value string) {
					r := request(value)
					r.Scope = 2
					if result, err := host.Enqueue(caller, r, nil); err != nil || result.Subrc != 0 {
						t.Fatalf("enqueue: %+v %v", result, err)
					}
				}
				rows := func(value string) int {
					n := 0
					for _, row := range host.server.Read(enq.Filter{Table: "ZOSD_TEST"}) {
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
					if err := host.Commit(step, updated); err != nil {
						t.Fatal(err)
					}
				case "rollback":
					if err := host.Rollback(step); err != nil {
						t.Fatal(err)
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
				host.Finish(step, false)
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

func TestLUWWithoutSession(t *testing.T) {
	host, closeServer := newHost(t)
	defer closeServer()
	step := new(struct{ int })
	for _, updated := range []bool{false, true} {
		if err := host.Commit(step, updated); err != nil {
			t.Fatal(err)
		}
	}
	if err := host.Rollback(step); err != nil {
		t.Fatal(err)
	}
	if !host.Begin(step) {
		t.Fatal("LUW hook created a step/session")
	}
	defer host.Finish(step, false)
	if host.steps[step].sid != 0 {
		t.Fatal("LUW hook opened a holder session")
	}
}
