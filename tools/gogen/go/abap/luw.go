package abap

import "database/sql"

// The database LUW of the kernel. A dialog step opens one database
// transaction; COMMIT WORK and ROLLBACK WORK end it and open the next; the
// step's end commits when the work ended normally and rolls back when it
// dumped. That last half is the kernel's job, not the application's: on a
// system an exception nobody caught is a short dump, and a dump ends the
// LUW, so a half-write never waits on the connection for the next step's
// COMMIT WORK to adopt it (docs/luw-buffer.md, tools/osd-dialog-step.mjs,
// which is the same rule for the three Node hosts). It lives here so that
// every Go host gets it by calling DialogStep rather than by copying it.
//
// Measured on A4H (2026-09-23): COMMIT WORK, COMMIT WORK AND WAIT and
// ROLLBACK WORK set sy-subrc to 0 and leave sy-dbcnt as it was; ROLLBACK
// WORK undoes what the LUW wrote, a COMMIT WORK before it keeps its rows.
// Neither PERFORM ... ON COMMIT nor CALL FUNCTION ... IN UPDATE TASK
// compiles in this subset, so there is nothing else for a COMMIT to run.

var tx *sql.Tx

// querier is what a statement runs on: the step's transaction when one is
// open, the database otherwise (a host that runs no step, or a tool).
type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
	Exec(query string, args ...any) (sql.Result, error)
}

func conn() querier {
	if tx != nil {
		return tx
	}
	return DB()
}

func begin() {
	if db == nil {
		return
	}
	// one connection in the pool (db.go): a second Begin would wait for the
	// first forever rather than fail
	if tx != nil {
		panic(NotCompiled("dialog step", "a dialog step is already open"))
	}
	t, err := db.Begin()
	if err != nil {
		panic(ArithmeticError{"CX_SY_OPEN_SQL_DB", err.Error()})
	}
	tx = t
}

func end(commit bool) {
	if tx == nil {
		return
	}
	t := tx
	tx = nil
	var err error
	if commit {
		err = t.Commit()
	} else {
		err = t.Rollback()
	}
	if err != nil {
		panic(ArithmeticError{"CX_SY_OPEN_SQL_DB", err.Error()})
	}
}

// DialogStep runs one step of work in a database LUW of its own: committed
// when work returns, rolled back when it panics (the panic goes on).
func DialogStep(work func()) {
	begin()
	ok := false
	defer func() {
		if ok {
			return
		}
		// the dump is what gets reported: a rollback that fails too must
		// not replace it
		dump := recover()
		func() {
			defer func() { recover() }()
			end(false)
		}()
		if dump != nil { // nil: runtime.Goexit, which goes on by itself
			panic(dump)
		}
	}()
	work()
	ok = true
	end(true)
}

// CommitWork is COMMIT WORK [AND WAIT]. Outside a dialog step it has
// nothing to do: autocommit already made every write durable.
func CommitWork(s *Session) {
	if tx != nil {
		end(true)
		begin()
	}
	s.Sy.Subrc = 0
}

// RollbackWork is ROLLBACK WORK. With a database open and no dialog step
// running every statement ran in autocommit, so there is nothing a rollback
// could undo: refused rather than answered 0 as if it had undone it. Without
// a database (a harness that runs no SQL) there is nothing written either.
func RollbackWork(s *Session) {
	if tx == nil && db != nil {
		panic(NotCompiled("ROLLBACK WORK", "outside a dialog step, where every statement already committed"))
	}
	if tx != nil {
		end(false)
		begin()
	}
	s.Sy.Subrc = 0
}
