package abap

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// the pairs osg-i7's modules write, at the root of the checkout
func pairsFile(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "test", "fixtures", "ir-pairs", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// normal is a value as JSON has it, so a Go rendering and a pair compare
// by their JSON and not by Go's types (int64 3 and float64 3 are both 3)
func normal(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

type lowered struct {
	SQL    string  `json:"sql"`
	Params []Param `json:"params"`
}

// every case of ranges.json: the same SQLite text and parameters, or the
// same outcome (a dump or a data error by the ABAP name, a refusal by reason)
func TestRangesPairs(t *testing.T) {
	var file struct {
		Pairs []struct {
			Name    string             `json:"name"`
			Column  string             `json:"column"`
			Type    *IRType            `json:"type"`
			Kind    string             `json:"kind"`
			LowLen  int                `json:"lowLen"`
			Rows    []map[string]any   `json:"rows"`
			Lowered map[string]lowered `json:"lowered"`
			Outcome map[string]string  `json:"outcome"`
		} `json:"pairs"`
	}
	if err := json.Unmarshal(pairsFile(t, "ranges.json"), &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Pairs) == 0 {
		t.Fatal("no pairs")
	}
	same, raised := 0, 0
	for _, c := range file.Pairs {
		rows := make([]RangeRow, len(c.Rows))
		for i, r := range c.Rows {
			up := map[string]any{}
			for k, v := range r {
				up[strings.ToUpper(k)] = v
			}
			sign, _ := up["SIGN"].(string)
			option, _ := up["OPTION"].(string)
			rows[i] = RangeRow{Sign: sign, Option: option, Low: up["LOW"], High: up["HIGH"]}
		}
		pred, err := RangesPredicate(c.Column, c.Type, rows, c.Kind, c.LowLen)
		var text string
		var params []Param
		if err == nil {
			text, params, err = LowerPredicate(pred)
		}
		if c.Outcome != nil {
			var got map[string]string
			switch x := err.(type) {
			case RangesDump:
				got = map[string]string{"error": "RangesDump", "abap": x.Abap}
			case RangesDataError:
				got = map[string]string{"error": "RangesDataError", "abap": x.Abap}
			case RangesRefused:
				got = map[string]string{"error": "Refused", "reason": x.Reason}
			default:
				t.Errorf("%s: %v, want %v", c.Name, err, c.Outcome)
				continue
			}
			if !reflect.DeepEqual(got, c.Outcome) {
				t.Errorf("%s: %v, want %v", c.Name, got, c.Outcome)
			}
			raised++
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		want := c.Lowered["sqlite"]
		if text != want.SQL {
			t.Errorf("%s:\n got  %s\n want %s", c.Name, text, want.SQL)
		}
		if params == nil {
			params = []Param{}
		}
		if !reflect.DeepEqual(normal(t, params), normal(t, want.Params)) {
			t.Errorf("%s: params %v, want %v", c.Name, params, want.Params)
		}
		same++
	}
	t.Logf("%d pairs: %d rendered byte for byte, %d outcomes the same", len(file.Pairs), same, raised)
}

// A4H's measurement (a throwaway table of 31 rows, 80 cases) replayed on a
// real SQLite through the same predicate and the same splice a SELECT uses:
// every case selects exactly A4H's rows, raises what A4H raised, or is
// refused by name. The table holds CHAR right-trimmed, as HANA does.
func TestRangesA4H(t *testing.T) {
	var file struct {
		Rows []struct {
			K, N, C string
			I       int64
		} `json:"rows"`
		Cases []struct {
			Name    string           `json:"name"`
			Column  string           `json:"column"`
			Rows    []map[string]any `json:"rows"`
			LowLen  int              `json:"lowLen"`
			Matched []string         `json:"matched"`
			Subrc   int              `json:"subrc"`
			Error   string           `json:"error"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(pairsFile(t, "a4h-ranges.json"), &file); err != nil {
		t.Fatal(err)
	}
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	d.SetMaxOpenConns(1)
	for _, st := range []string{`PRAGMA case_sensitive_like = ON`, `CREATE TABLE "R" ("K" VARCHAR, "N" VARCHAR, "I" INTEGER, "C" VARCHAR)`} {
		if _, err := d.Exec(st); err != nil {
			t.Fatal(err)
		}
	}
	for _, r := range file.Rows {
		if _, err := d.Exec(`INSERT INTO "R" VALUES (?, ?, ?, ?)`, r.K, r.N, r.I, r.C); err != nil {
			t.Fatal(err)
		}
	}
	types := map[string]*IRType{"C": TChar(10), "N": TChar(4), "I": TInt}
	refusals := map[string]bool{"special padding form": true, "plus alone": true}
	same, raised, refused := 0, 0, 0
	for _, c := range file.Cases {
		rows := make([]RangeRow, len(c.Rows))
		for i, r := range c.Rows {
			sign, _ := r["sign"].(string)
			option, _ := r["option"].(string)
			rows[i] = RangeRow{Sign: sign, Option: option, Low: r["low"], High: r["high"]}
		}
		kind := ""
		if c.Column == "N" {
			kind = "NUMC"
		}
		text := `SELECT "K" AS "K" FROM "R" WHERE /*@range:0*/`
		var got []string
		func() {
			defer func() {
				if r := recover(); r != nil {
					e, ok := r.(ArithmeticError)
					switch {
					case ok && c.Error != "" && e.Class == c.Error:
						raised++
					case ok && e.Class == "NOT_COMPILED" && c.Error == "" && refusedBy(e.Op, refusals):
						refused++
					default:
						t.Errorf("%s: %v, A4H: error %q rows %v", c.Name, r, c.Error, c.Matched)
					}
					got = nil
				}
			}()
			q, args := SpliceRanges(text, nil, []HostPred{{ID: "0", Column: c.Column, Type: types[c.Column], Kind: kind, LowLen: c.LowLen, Rows: rows}})
			res, err := d.Query(q, args...)
			if err != nil {
				t.Fatalf("%s: %v\n%s", c.Name, err, q)
			}
			defer res.Close()
			got = []string{}
			for res.Next() {
				var k string
				if err := res.Scan(&k); err != nil {
					t.Fatal(err)
				}
				got = append(got, k)
			}
			if c.Error != "" {
				t.Errorf("%s: rows %v, A4H raised %s", c.Name, got, c.Error)
				return
			}
			sort.Strings(got)
			want := append([]string{}, c.Matched...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s: rows %v\n A4H %v", c.Name, got, want)
				return
			}
			same++
		}()
	}
	t.Logf("%d cases: %d the same rows as A4H, %d raised as A4H did, %d refused by name", len(file.Cases), same, raised, refused)
	if same+raised+refused != len(file.Cases) {
		t.Errorf("%d cases accounted for, %d in the file", same+raised+refused, len(file.Cases))
	}
}

func refusedBy(msg string, reasons map[string]bool) bool {
	for r := range reasons {
		if strings.Contains(msg, map[string]string{"special padding form": "blanks that meet the padding", "plus alone": `pattern "+"`}[r]) {
			return true
		}
	}
	return false
}

var _ = errors.New
