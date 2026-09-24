package abap

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"
)

var osqlDialects = []string{"sqlite", "duckdb", "postgres", "hana"}

// every pair of osql-where.json (open-steamgate #47, the parser's own
// module wrote it): the same SQL and parameters in each of the four
// dialects, or the same outcome -- the class for what A4H raised, the
// reason for a refusal -- and the reasons list the same closed list
func TestOsqlWherePairs(t *testing.T) {
	var file struct {
		Reasons []string `json:"reasons"`
		Columns map[string]struct {
			Type *IRType `json:"type"`
			Kind string  `json:"kind"`
		} `json:"columns"`
		Pairs []struct {
			Name    string             `json:"name"`
			Where   string             `json:"where"`
			Outcome map[string]any     `json:"outcome"`
			Lowered map[string]lowered `json:"lowered"`
		} `json:"pairs"`
	}
	if err := json.Unmarshal(pairsFile(t, "osql-where.json"), &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Pairs) == 0 {
		t.Fatal("no pairs")
	}
	if !reflect.DeepEqual(file.Reasons, OsqlWhereReasons) {
		t.Errorf("reasons %v, want %v", OsqlWhereReasons, file.Reasons)
	}
	names := make([]string, 0, len(file.Columns))
	for n := range file.Columns {
		names = append(names, n)
	}
	sort.Strings(names)
	var cols []OsqlColumn
	for _, n := range names {
		c := file.Columns[n]
		cols = append(cols, OsqlColumn{Name: n, Type: c.Type, Kind: c.Kind})
	}
	perDialect := map[string]int{}
	outcomes := 0
	for _, c := range file.Pairs {
		pred, err := OsqlWherePredicate(c.Where, cols)
		if c.Outcome != nil {
			var got map[string]any
			switch {
			case err != nil:
				got = map[string]any{}
				for k, v := range OsqlWhereOutcome(err) {
					got[k] = v
				}
			case pred == nil:
				got = map[string]any{"every": true}
			default:
				got = map[string]any{"predicate": true}
			}
			if !reflect.DeepEqual(got, c.Outcome) {
				t.Errorf("%s: %v (%v), want %v", c.Name, got, err, c.Outcome)
				continue
			}
			outcomes++
			continue
		}
		if err != nil || pred == nil {
			t.Errorf("%s: %v, want a predicate", c.Name, err)
			continue
		}
		for _, d := range osqlDialects {
			want, ok := c.Lowered[d]
			if !ok {
				t.Errorf("%s: no %s pair", c.Name, d)
				continue
			}
			text, params, err := LowerPredicateIn(pred, d)
			if err != nil {
				t.Errorf("%s (%s): %v", c.Name, d, err)
				continue
			}
			if params == nil {
				params = []Param{}
			}
			if text != want.SQL {
				t.Errorf("%s (%s):\n got  %s\n want %s", c.Name, d, text, want.SQL)
				continue
			}
			if !reflect.DeepEqual(normal(t, params), normal(t, want.Params)) {
				t.Errorf("%s (%s): params %v, want %v", c.Name, d, params, want.Params)
				continue
			}
			perDialect[d]++
		}
	}
	t.Logf("%d pairs: %d outcomes the same; rendered byte for byte: sqlite %d, duckdb %d, postgres %d, hana %d",
		len(file.Pairs), outcomes, perDialect["sqlite"], perDialect["duckdb"], perDialect["postgres"], perDialect["hana"])
}

// the limits hold at their edges: 256 levels and 2000 comparisons answer,
// one more is refused as too deep
func TestOsqlWhereLimits(t *testing.T) {
	cols := []OsqlColumn{{Name: "CARRID", Type: TChar(3)}}
	nest := func(n int) string {
		s := "carrid = 'LH'"
		for i := 0; i < n; i++ {
			s = "( " + s + " )"
		}
		return s
	}
	chain := func(n int) string {
		s := "carrid = 'LH'"
		for i := 1; i < n; i++ {
			s += " OR carrid = 'LH'"
		}
		return s
	}
	nots := func(n int) string {
		s := "carrid = 'LH'"
		for i := 0; i < n; i++ {
			s = "NOT " + s
		}
		return s
	}
	for _, c := range []struct {
		where string
		ok    bool
	}{{nest(256), true}, {nest(257), false}, {nots(256), true}, {nots(257), false}, {chain(2000), true}, {chain(2001), false}} {
		_, err := OsqlWherePredicate(c.where, cols)
		if c.ok && err != nil {
			t.Errorf("%d bytes: %v", len(c.where), err)
		}
		if !c.ok {
			if r, is := err.(OsqlWhereRefused); !is || r.Reason != "too deep" {
				t.Errorf("%d bytes: %v, want too deep", len(c.where), err)
			}
		}
	}
	// an IN list of 3000 values is one comparison
	in := "carrid IN ('A'"
	for i := 0; i < 3000; i++ {
		in += ",'B'"
	}
	if _, err := OsqlWherePredicate(in+")", cols); err != nil {
		t.Errorf("IN of 3001 values: %v", err)
	}
}

// the edges the critic on #47 named: the tokenizer runs first, a tab in a
// number is a format, a sign on zero is dropped, NUMC of an empty literal is refused
func TestOsqlWhereEdges(t *testing.T) {
	cols := []OsqlColumn{{Name: "CARRID", Type: TChar(3)}, {Name: "SEATSMAX", Type: TInt},
		{Name: "CONNID", Type: TChar(4), Kind: "NUMC"}, {Name: "PRICE", Type: &IRType{Abap: "P", Len: 8, Dec: 2}}}
	for _, c := range []struct{ where, want string }{
		{"nosuch = 'x' AND carrid = 'LH", "Refused/malformed"},
		{"seatsmax = '\t5'", "Refused/number format"},
		{"connid = ''", "Refused/numc"},
		{"carrid = 'A\U0001F600'", "Refused/non-BMP"},
		{"carrid = 'LH'", "Refused/malformed"},
		{"seatsmax = '-0'", "sql:(\"SEATSMAX\" = 0)"},
		{"seatsmax = '-0.4'", "sql:(\"SEATSMAX\" = 0)"},
		{"price = '-0.001'", "param:0.00"},
		{"seatsmax = '2147483647'", "sql:(\"SEATSMAX\" = 2147483647)"},
		{"seatsmax = '2147483648'", "OsqlWhereDump"},
		{"seatsmax = '-2147483648'", "sql:(\"SEATSMAX\" = -2147483648)"},
		{"seatsmax = '-2147483649'", "OsqlWhereDump"},
	} {
		pred, err := OsqlWherePredicate(c.where, cols)
		var got string
		switch x := err.(type) {
		case nil:
			sql, params, _ := LowerPredicate(pred)
			got = "sql:" + sql
			if len(params) > 0 {
				got = "param:" + params[0].Value.(string)
			}
		case OsqlWhereRefused:
			got = "Refused/" + x.Reason
		default:
			got = OsqlWhereOutcome(err)["error"]
		}
		if got != c.want {
			t.Errorf("%q: %s, want %s", c.where, got, c.want)
		}
	}
}
