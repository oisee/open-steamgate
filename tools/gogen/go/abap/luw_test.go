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

// Outside a dialog step every statement autocommits, so ROLLBACK WORK
// could undo nothing: it is refused, not answered 0. COMMIT WORK there is
// a no-op. Without a database both answer 0.
func TestLUWOutsideStep(t *testing.T) {
	s := &Session{}
	RollbackWork(s) // no database: nothing written, nothing to undo
	CommitWork(s)
	if err := OpenDB([]byte(`["CREATE TABLE t (id TEXT PRIMARY KEY)"]`)); err != nil {
		t.Fatal(err)
	}
	defer func() { db = nil; tx = nil }()
	CommitWork(s)
	func() {
		defer func() {
			r := recover()
			if e, ok := r.(ArithmeticError); !ok || e.Class != "NOT_COMPILED" {
				t.Fatalf("ROLLBACK WORK outside a step: %v", r)
			}
		}()
		RollbackWork(s)
	}()
}

// A dialog step inside a dialog step fails at once instead of waiting
// forever for the one connection the outer step holds, and the outer step
// is rolled back by its own end, not by the inner one.
func TestLUWNested(t *testing.T) {
	if err := OpenDB([]byte(`["CREATE TABLE t (id TEXT PRIMARY KEY)"]`)); err != nil {
		t.Fatal(err)
	}
	defer func() { db = nil; tx = nil }()
	var inner any
	func() {
		defer func() { inner = recover() }()
		DialogStep(func() {
			if _, err := conn().Exec("INSERT INTO t VALUES ('A')"); err != nil {
				t.Fatal(err)
			}
			DialogStep(func() {})
		})
	}()
	if e, ok := inner.(ArithmeticError); !ok || e.Class != "NOT_COMPILED" {
		t.Fatalf("nested step: %v", inner)
	}
	if tx != nil {
		t.Fatal("the outer step left its transaction open")
	}
	r, _ := conn().Query("SELECT COUNT(*) FROM t")
	n := 0
	r.Next()
	r.Scan(&n)
	r.Close()
	if n != 0 {
		t.Fatalf("the outer step's row survived its dump: %d", n)
	}
}

// When the rollback of a dumped step fails as well, the dump is what goes
// on, not the rollback's error.
func TestLUWDumpSurvivesRollbackError(t *testing.T) {
	if err := OpenDB([]byte(`[]`)); err != nil {
		t.Fatal(err)
	}
	defer func() { db = nil; tx = nil }()
	var got any
	func() {
		defer func() { got = recover() }()
		DialogStep(func() {
			tx.Rollback() // the step's own rollback will now fail
			panic(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
		})
	}()
	if e, ok := got.(ArithmeticError); !ok || e.Class != "CX_SY_ZERODIVIDE" {
		t.Fatalf("the dump was replaced: %v", got)
	}
}

// The statement cache (parity-wave2): a text run twice in a step is
// prepared after it and reused by the steps after; a dumped step still
// takes back what it wrote through a cached statement, and COMMIT WORK in
// the middle of a step keeps it
func TestLUWStatementCache(t *testing.T) {
	if err := OpenDB([]byte(`["CREATE TABLE t (id TEXT PRIMARY KEY)"]`)); err != nil {
		t.Fatal(err)
	}
	defer func() { db = nil; tx = nil }()
	const ins, cnt = "INSERT INTO t VALUES (?)", "SELECT COUNT(*) FROM t"
	count := func() int {
		r, err := conn().Query(cnt)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Close()
		n := 0
		r.Next()
		r.Scan(&n)
		return n
	}
	DialogStep(func() {
		conn().Exec(ins, "A")
		conn().Exec(ins, "B")
		if count()+count() != 4 {
			t.Fatal("first step")
		}
	})
	if stmtCache[ins] == nil || stmtCache[cnt] == nil {
		t.Fatalf("not prepared after the step: %v", stmtCache)
	}
	func() {
		defer func() { recover() }()
		DialogStep(func() {
			if _, err := conn().Exec(ins, "C"); err != nil {
				t.Fatal(err)
			}
			if count() != 3 {
				t.Fatal("the cached insert is not in the step")
			}
			panic(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
		})
	}()
	s := &Session{}
	DialogStep(func() {
		if count() != 2 {
			t.Fatalf("the dumped step's row stayed: %d", count())
		}
		conn().Exec(ins, "D")
		CommitWork(s)
		conn().Exec(ins, "E")
		RollbackWork(s)
	})
	if n := count(); n != 3 {
		t.Fatalf("after COMMIT WORK and ROLLBACK WORK: %d rows, want 3", n)
	}
	if _, err := conn().Exec(ins, "A"); err == nil {
		t.Fatal("a duplicate key through a cached statement is still refused")
	}
}
