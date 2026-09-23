package abap

import "testing"

// The rows written stand in for what an INSERT of ABAP would write; the
// statements are raw here because the test is about the LUW, not the SQL.
func TestLUW(t *testing.T) {
	if err := OpenDB([]byte(`["CREATE TABLE t (id TEXT PRIMARY KEY)"]`)); err != nil {
		t.Fatal(err)
	}
	defer func() { db = nil; tx = nil }()
	put := func(id string) {
		if _, err := conn().Exec("INSERT INTO t VALUES (?)", id); err != nil {
			t.Fatal(err)
		}
	}
	rows := func() int {
		r, err := conn().Query("SELECT COUNT(*) FROM t")
		if err != nil {
			t.Fatal(err)
		}
		defer r.Close()
		n := 0
		r.Next()
		if err := r.Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	s := &Session{}
	// A4H: INSERT; ROLLBACK WORK -> 0 rows; INSERT; COMMIT WORK; ROLLBACK
	// WORK -> 1 row; sy-subrc 0 after each (set to 7 before)
	DialogStep(func() {
		put("A")
		s.Sy.Subrc = 7
		RollbackWork(s)
		if s.Sy.Subrc != 0 || rows() != 0 {
			t.Fatalf("rollback: subrc %d rows %d", s.Sy.Subrc, rows())
		}
		put("A")
		s.Sy.Subrc = 7
		CommitWork(s)
		if s.Sy.Subrc != 0 {
			t.Fatalf("commit: subrc %d", s.Sy.Subrc)
		}
		RollbackWork(s)
		if rows() != 1 {
			t.Fatalf("after commit and rollback: %d rows", rows())
		}
		put("B")
	})
	if rows() != 2 {
		t.Fatalf("a step that ends normally commits: %d rows", rows())
	}
	// a step that dumps leaves nothing behind, and the dump goes on
	func() {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("the dump did not go on")
			}
		}()
		DialogStep(func() {
			put("C")
			panic(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
		})
	}()
	if tx != nil || rows() != 2 {
		t.Fatalf("a step that dumps rolls back: tx %v rows %d", tx != nil, rows())
	}
}
