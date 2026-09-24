//go:build !wasm

package abap

import (
	"database/sql"

	_ "modernc.org/sqlite" // pure Go, the product default
)

// openSQL opens the process's database. The driver is the one part of the
// database layer that is not portable: database/sql is the standard
// library and compiles for every target, modernc.org/sqlite carries
// modernc.org/libc, which has no wasm files (db_wasm.go is the other side).
func openSQL(dsn string) (*sql.DB, error) { return sql.Open("sqlite", dsn) }
