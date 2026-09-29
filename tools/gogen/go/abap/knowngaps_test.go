package abap

import (
	"fmt"
	"sort"
	"testing"
)

// knownGaps: the pairs in test/fixtures/ir-pairs that main's Node IR learned
// after this Go runtime was branched off, and that the runtime does not do
// yet (ANORMALIES, gogen-ir-pairs-behind-main). Strict in both directions: a
// listed pair must still fail, and any other failure is an ordinary failure.
// A pair that starts to pass fails the test until it is removed from here,
// so the list cannot outlive the gap.
var knownGaps = map[string]map[string]string{
	"osql-where.json": {
		"a decimal against a packed column":                "packed literals in WHERE (main #47, #55)",
		"a packed literal rounds to the column's decimals": "packed literals in WHERE (main #47, #55)",
		"a packed literal is bound as a decimal string":    "packed literals in WHERE (main #47, #55)",
		"the largest packed value that fits":               "packed literals in WHERE (main #47, #55)",
		"a RAW against its 2n upper-case hex digits":       "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW compared by its bytes":                      "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW compared with <>":                           "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW compared with >":                            "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW data error left of an unknown column: the first error from the left (not measured)": "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal in lower case is CX_SY_OPEN_SQL_DATA_ERROR":                                 "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal past F is CX_SY_OPEN_SQL_DATA_ERROR":                                        "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal that is empty is CX_SY_OPEN_SQL_DATA_ERROR":                                 "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal too long is CX_SY_OPEN_SQL_DATA_ERROR":                                      "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal too short is CX_SY_OPEN_SQL_DATA_ERROR":                                     "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal with a blank after it is CX_SY_OPEN_SQL_DATA_ERROR":                         "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"a RAW literal with a blank before it is CX_SY_OPEN_SQL_DATA_ERROR":                        "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"an unquoted number against a RAW is CX_SY_OPEN_SQL_DATA_ERROR":                            "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
		"an unquoted number of 2n digits against a RAW is CX_SY_OPEN_SQL_DATA_ERROR too":           "RAW columns in WHERE: data errors as outcomes, the PostgreSQL bytea parameter (main #66)",
	},
	"writes.json": {
		"UPSERT ... SELECT: the keys the query brings updated, the others inserted":          "UPSERT ... SELECT (main #64)",
		"UPSERT ... SELECT naming the key only: TXT kept on an update, initial on an insert": "UPSERT ... SELECT (main #64)",
	},
}

// gaps reports a pair's failure through errorf: a listed pair's failure is
// recorded, anything else is t.Errorf. done checks the list is exact.
type gaps struct {
	t      *testing.T
	known  map[string]string
	failed map[string]bool
}

func newGaps(t *testing.T, file string) *gaps {
	return &gaps{t: t, known: knownGaps[file], failed: map[string]bool{}}
}

func (g *gaps) errorf(name, format string, args ...any) {
	g.t.Helper()
	if _, ok := g.known[name]; ok {
		g.failed[name] = true
		g.t.Logf("known gap: "+format, args...)
		return
	}
	g.t.Errorf(format, args...)
}

// guard runs one pair and turns a panic into that pair's failure
func (g *gaps) guard(name string, run func()) {
	g.t.Helper()
	defer func() {
		if r := recover(); r != nil {
			g.errorf(name, "%s: panic %v", name, r)
		}
	}()
	run()
}

func (g *gaps) done() {
	g.t.Helper()
	var passing []string
	for name := range g.known {
		if !g.failed[name] {
			passing = append(passing, name)
		}
	}
	sort.Strings(passing)
	for _, name := range passing {
		g.t.Errorf("%q is listed as a known gap and did not fail: remove it from knownGaps", name)
	}
	g.t.Log(fmt.Sprintf("%d known gaps failed as listed", len(g.failed)))
}
