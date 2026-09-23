package abap

import (
	"database/sql"
	"testing"
)

// The semantics the helper promises, on a real SQLite: a CHAR column stored
// padded, as the seed stores it.
func TestRangeSQL(t *testing.T) {
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	d.SetMaxOpenConns(1)
	for _, st := range []string{
		`CREATE TABLE t (id NCHAR(8) COLLATE RTRIM, n INT)`,
		`INSERT INTO t VALUES ('T0001   ', 1), ('T0002   ', 2), ('X_1     ', 3), ('T0003   ', 4)`,
	} {
		if _, err := d.Exec(st); err != nil {
			t.Fatal(err)
		}
	}
	count := func(rows []RangeRow) int {
		w, a := RangeSQL(`"id"`, rows)
		var n int
		if err := d.QueryRow("SELECT count(*) FROM t WHERE "+w, a...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	cases := []struct {
		name string
		rows []RangeRow
		want int
	}{
		{"empty is true", nil, 4},
		{"EQ", []RangeRow{{"I", "EQ", "T0001", ""}}, 1},
		{"two includes OR", []RangeRow{{"I", "EQ", "T0001", ""}, {"I", "EQ", "T0002", ""}}, 2},
		{"exclude only", []RangeRow{{"E", "EQ", "T0001", ""}}, 3},
		{"include and exclude", []RangeRow{{"I", "CP", "T*", ""}, {"E", "EQ", "T0002", ""}}, 2},
		{"BT", []RangeRow{{"I", "BT", "T0001", "T0002"}}, 2},
		{"NB", []RangeRow{{"I", "NB", "T0001", "T0002"}}, 2},
		{"CP without trailing *", []RangeRow{{"I", "CP", "T0001", ""}}, 1},
		{"CP +", []RangeRow{{"I", "CP", "T000+", ""}}, 3},
		{"CP _ is literal", []RangeRow{{"I", "CP", "X_*", ""}}, 1},
		{"CP _ does not match any char", []RangeRow{{"I", "CP", "T_*", ""}}, 0},
		{"NP", []RangeRow{{"I", "NP", "T*", ""}}, 1},
	}
	for _, c := range cases {
		if got := count(c.rows); got != c.want {
			t.Errorf("%s: %d rows, want %d", c.name, got, c.want)
		}
	}
}
