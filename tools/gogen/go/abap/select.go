package abap

import (
	"database/sql"
	"strings"
)

// Mandt is the logon client, the transpiler runtime's constant (ANORMALIES:
// sy-mandt = 123), so both hosts read the same rows.
const Mandt = "123"

// DBString and DBInt are what a column is scanned into.
type (
	DBString = sql.NullString
	DBInt    = sql.NullInt64
)

// Slot is a place in the lowered SQL where a range predicate arrives at run
// time: the Index-th ? of the statement stands for col IN rows.
type Slot struct {
	Index int
	Col   string
	Rows  []RangeRow
}

// Select runs a lowered SELECT: the SQL and its static arguments from the
// build, the range slots expanded now, each row handed to row with a scan
// function. It returns the number of rows.
func Select(s *Session, text string, args []any, slots []Slot, row func(scan func(dest ...any) error)) int {
	bySlot := map[int]Slot{}
	for _, sl := range slots {
		bySlot[sl.Index] = sl
	}
	var b strings.Builder
	var bound []any
	k := 0
	for _, part := range strings.SplitAfter(text, "?") {
		if !strings.HasSuffix(part, "?") {
			b.WriteString(part)
			continue
		}
		b.WriteString(part[:len(part)-1])
		if sl, ok := bySlot[k]; ok {
			frag, fa := RangeSQL(sl.Col, sl.Rows)
			b.WriteString("(" + frag + ")")
			bound = append(bound, fa...)
		} else {
			b.WriteByte('?')
			bound = append(bound, args[k])
		}
		k++
	}
	rows, err := conn().Query(b.String(), bound...)
	if err != nil {
		panic(ArithmeticError{"CX_SY_OPEN_SQL_DB", err.Error()})
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		row(rows.Scan)
		n++
	}
	if err := rows.Err(); err != nil {
		panic(ArithmeticError{"CX_SY_OPEN_SQL_DB", err.Error()})
	}
	return n
}

// DBChar is a CHAR column read into ABAP: stored padded, carried without
// trailing blanks like every c here.
func DBChar(v DBString) string { return strings.TrimRight(v.String, " ") }

// DBStr is a STRING column: as stored.
func DBStr(v DBString) string { return v.String }

// DBI is an INT column.
func DBI(v DBInt) int32 { return int32(v.Int64) }

// Must turns a scan error into a database dump.
func Must(err error) {
	if err != nil {
		panic(ArithmeticError{"CX_SY_OPEN_SQL_DB", err.Error()})
	}
}
