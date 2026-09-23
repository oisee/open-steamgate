package abap

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
)

// OpenDBFile is OpenDB on an SQLite file in WAL mode, for a host that keeps
// its rows between runs (osgo --db). The script (tables, views, seed rows)
// runs once, in one transaction, when the file has no tables yet; a file
// that has them is taken as it is.
func OpenDBFile(path string, script []byte) (seeded bool, err error) {
	var stmts []string
	if err := json.Unmarshal(script, &stmts); err != nil {
		return false, err
	}
	if _, err := os.Stat(path); err != nil && !os.IsNotExist(err) {
		return false, err
	}
	d, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return false, err
	}
	d.SetMaxOpenConns(1)
	var tables int
	if err := d.QueryRow("SELECT count(*) FROM sqlite_master").Scan(&tables); err != nil {
		d.Close()
		return false, err
	}
	if tables == 0 {
		tx, err := d.Begin()
		if err != nil {
			d.Close()
			return false, err
		}
		for i, st := range stmts {
			if _, err := tx.Exec(st); err != nil {
				tx.Rollback()
				d.Close()
				return false, fmt.Errorf("statement %d: %w: %.200s", i, err, st)
			}
		}
		if err := tx.Commit(); err != nil {
			d.Close()
			return false, err
		}
		seeded = true
	}
	db = d
	return seeded, nil
}
