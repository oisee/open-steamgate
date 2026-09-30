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
// so the list cannot outlive the gap. Empty since the packed, RAW and
// UPSERT ... SELECT ports; kept for the next time main's pairs run ahead.
var knownGaps = map[string]map[string]string{}

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
