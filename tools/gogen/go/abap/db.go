package abap

import (
	"database/sql"
	"encoding/json"
	"fmt"

	_ "modernc.org/sqlite" // pure Go, the product default
)

// The database interface of the kernel: one database per process. The Node
// side runs the same tables on SQLite through the transpiler's
// DatabaseClient; the Go host builds its own from the same inputs (the
// transpiler's CREATE TABLEs for the registry and test/seed.mjs's rows), so
// the two cannot drift.
//
// In-memory SQLite is one database per connection, so the pool keeps one:
// dialog steps run one at a time until statics are per session anyway.
var db *sql.DB

// OpenDB creates the in-memory database and runs the script, a JSON array of
// SQL statements.
func OpenDB(script []byte) error {
	var stmts []string
	if err := json.Unmarshal(script, &stmts); err != nil {
		return err
	}
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return err
	}
	d.SetMaxOpenConns(1)
	for i, st := range stmts {
		if _, err := d.Exec(st); err != nil {
			return fmt.Errorf("statement %d: %w: %.200s", i, err, st)
		}
	}
	db = d
	return nil
}

// DB is the process's database; a SELECT before OpenDB is a host error.
func DB() *sql.DB {
	if db == nil {
		panic(NotCompiled("database", "the host did not open a database"))
	}
	return db
}
