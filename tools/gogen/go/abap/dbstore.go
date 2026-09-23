package abap

import (
	"database/sql"
	"fmt"
	"regexp"
	"strings"
)

// The store as HANA keeps it, which is what the relational IR's renderings
// assume (tools/ir-ranges.mjs, tools/ir-writes.mjs):
//   - LIKE is case-sensitive (SQLite's is not for ASCII unless the
//     connection says so; the connection is kept for the process, db.go);
//   - a CHAR column holds its value right-trimmed. The seed pads CHAR to its
//     DDIC length (test/seed.mjs, for the transpiler's runtime), and a CP
//     pattern without a trailing * does not match a padded value through
//     LIKE, where it does on A4H. The columns COLLATE RTRIM compare equal
//     either way; the trim is for LIKE, and for writes, which bind CHAR
//     right-trimmed.
var charColumn = regexp.MustCompile(`'([^']+)' NCHAR\(\d+\) COLLATE RTRIM`)

func prepareStore(d *sql.DB) error {
	if _, err := d.Exec(`PRAGMA case_sensitive_like = ON`); err != nil {
		return err
	}
	rows, err := d.Query(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL`)
	if err != nil {
		return err
	}
	var updates []string
	for rows.Next() {
		var name, text string
		if err := rows.Scan(&name, &text); err != nil {
			rows.Close()
			return err
		}
		var set []string
		for _, m := range charColumn.FindAllStringSubmatch(text, -1) {
			set = append(set, fmt.Sprintf(`%s = rtrim(%s, ' ')`, quote(m[1]), quote(m[1])))
		}
		if len(set) > 0 {
			updates = append(updates, fmt.Sprintf(`UPDATE %s SET %s`, quote(name), strings.Join(set, ", ")))
		}
	}
	rows.Close()
	for _, u := range updates {
		if _, err := d.Exec(u); err != nil {
			return fmt.Errorf("%w: %s", err, u)
		}
	}
	return nil
}
