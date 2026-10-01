package enq

import "testing"

func lockOn(k1 string, mode string, scope int) Request {
	return Request{Client: "001", Table: "T", Object: "ET", Mode: mode, Scope: scope,
		Fields: []Field{{Value: k1, Length: 10}, {Value: "K", Length: 10}}}
}

// After COMMIT with an update, the ended owner's half belongs to the update
// task: the session's own new lock is a second row, a DEQUEUE releases the
// new one (not stopping at the row it cannot release), and the end of the
// session leaves the update task's half until UpdateDone.
func TestEndedUpdateOwner(t *testing.T) {
	srv := New("i")
	defer srv.Close()
	a := srv.Open("U")
	if res := srv.Enqueue(a, lockOn("A", "S", 2), false); res.Subrc != 0 {
		t.Fatal(res)
	}
	ended := srv.Commit(a, true)
	if res := srv.Enqueue(a, lockOn("A", "S", 2), false); res.Subrc != 0 {
		t.Fatalf("shared lock next to the update task's: %+v", res)
	}
	if n := len(srv.Read(Filter{})); n != 2 {
		t.Fatalf("%d rows", n)
	}
	srv.Dequeue(a, lockOn("A", "S", 2))
	rows := srv.Read(Filter{})
	if len(rows) != 1 || rows[0].Update != ended {
		t.Fatalf("dequeue released the wrong row: %+v", rows)
	}
	// an exclusive lock of its own is refused while the update task holds S
	if res := srv.Enqueue(a, lockOn("A", "E", 2), false); res.Subrc != 1 || res.Msgno != "601" {
		t.Fatalf("E against the update task's S: %+v", res)
	}
	srv.End(a)
	if n := len(srv.Read(Filter{})); n != 1 {
		t.Fatalf("End released the update task's half: %d rows", n)
	}
	srv.UpdateDone(a, ended)
	if n := len(srv.Read(Filter{})); n != 0 {
		t.Fatalf("UpdateDone left %d rows", n)
	}
}

// A lock is the table, the argument and the mode: another lock object on
// the same table stacks on the same row and DEQUEUE through either releases.
func TestObjectIsNotTheKey(t *testing.T) {
	srv := New("i")
	defer srv.Close()
	a := srv.Open("U")
	r1, r2 := lockOn("A", "E", 2), lockOn("A", "E", 2)
	r2.Object = "ET2"
	srv.Enqueue(a, r1, false)
	srv.Enqueue(a, r2, false)
	rows := srv.Read(Filter{})
	if len(rows) != 1 || rows[0].Updates != 2 {
		t.Fatalf("%+v", rows)
	}
	srv.Dequeue(a, r2)
	srv.Dequeue(a, r1)
	if n := len(srv.Read(Filter{})); n != 0 {
		t.Fatalf("%d rows", n)
	}
}

// Arguments are compared position by position: a shorter argument is
// blank where the longer goes on, U+FFFF matches anything.
func TestCollide(t *testing.T) {
	g := garg("001", []Field{{Value: "A", Length: 3}, {Generic: true, Length: 3}})
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{g, garg("001", []Field{{Value: "A", Length: 3}, {Value: "B", Length: 3}}), true},
		{g, garg("001", []Field{{Value: "B", Length: 3}, {Value: "B", Length: 3}}), false},
		{garg("001", []Field{{Value: "A", Length: 3}}), garg("001", []Field{{Value: "B", Length: 3}, {Value: "X", Length: 3}}), false},
		{garg("001", []Field{{Value: "A", Length: 3}}), garg("001", []Field{{Value: "A", Length: 3}, {Value: "X", Length: 3}}), false},
		{garg("001", []Field{{Value: "A", Length: 3}}), garg("001", []Field{{Value: "A", Length: 3}, {Value: "", Length: 3}}), true},
	} {
		if got := collide(c.a, c.b); got != c.want {
			t.Errorf("collide(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestCloseTwiceAndAfter(t *testing.T) {
	srv := New("i")
	a := srv.Open("U")
	srv.Close()
	srv.Close()
	if res := srv.Enqueue(a, lockOn("A", "E", 2), false); res.Subrc == 0 {
		t.Fatalf("a closed server granted %+v", res)
	}
	srv.End(a)
}

// A _SCOPE 3 row whose update half a COMMIT ended is still the session's by
// its dialog half; a DEQUEUE of _SCOPE 2 passes it and releases the next
// row, the one of the current update owner.
func TestDequeuePassesARowItCannotRelease(t *testing.T) {
	srv := New("i")
	defer srv.Close()
	a := srv.Open("U")
	srv.Enqueue(a, lockOn("A", "S", 3), false)
	ended := srv.Commit(a, true)
	srv.Enqueue(a, lockOn("A", "S", 2), false)
	srv.Dequeue(a, lockOn("A", "S", 2))
	rows := srv.Read(Filter{})
	if len(rows) != 1 || rows[0].Dialogs != 1 || rows[0].Update != ended {
		t.Fatalf("%+v", rows)
	}
}

// The update task's half refuses the session alike on a _SCOPE 2 row and on
// a _SCOPE 3 row whose dialog half is the session's own.
func TestUpdateTaskHalfIsForeignOnEveryRow(t *testing.T) {
	for _, scope := range []int{2, 3} {
		srv := New("i")
		a := srv.Open("U")
		srv.Enqueue(a, lockOn("A", "S", scope), false)
		srv.Commit(a, true)
		if res := srv.Enqueue(a, lockOn("A", "E", 2), false); res.Subrc != 1 || res.Msgno != "601" {
			t.Errorf("scope %d: E next to the update task's S: %+v", scope, res)
		}
		srv.Close()
	}
}
