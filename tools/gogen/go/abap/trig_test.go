//go:build !libm

package abap

import (
	"encoding/json"
	osexec "os/exec"
	"testing"
)

// The reference is V8: the arguments and their sin/cos come from node's
// Math.sin / Math.cos, so the comparison is Go against the engine the Node
// runtime answers with, never Go against itself. They are generated here
// instead of being checked in: 200 000 rows were a 12 MB fixture.
//
// A fixed xorshift sequence makes the arguments the same on every run: half
// of them up to 5e6 in magnitude, half near the origin, where the reduction
// steps differ. Without node the test fails, because a skipped reference is
// a comparison that never ran.
const trigScript = `
let s = 0x2545f491 >>> 0;
const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const rows = [];
for (let i = 0; i < 200000; i++) {
  const span = i % 2 === 0 ? 5e6 : 8;
  const x = (next() * 2 - 1) * span;
  rows.push([x, Math.sin(x), Math.cos(x)]);
}
process.stdout.write(JSON.stringify(rows));
`

func TestTrigMatchesV8(t *testing.T) {
	raw, err := osexec.Command("node", "-e", trigScript).Output()
	if err != nil {
		t.Fatalf("node is the reference for this test and could not run: %v", err)
	}
	var rows [][3]float64
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 200000 {
		t.Fatalf("expected 200000 reference rows, got %d", len(rows))
	}
	bad, large := 0, 0
	for _, r := range rows {
		if hiWord(r[0])&0x7fffffff > trigLarge {
			large++
			continue
		}
		if Sin(r[0]) != r[1] || Cos(r[0]) != r[2] {
			if bad < 5 {
				t.Errorf("x=%v sin %v/%v cos %v/%v", r[0], Sin(r[0]), r[1], Cos(r[0]), r[2])
			}
			bad++
		}
	}
	if bad > 0 {
		t.Errorf("%d of %d differ", bad, len(rows)-large)
	}
	if len(rows)-large < 100000 {
		t.Errorf("only %d arguments were compared", len(rows)-large)
	}
	t.Logf("%d compared, %d beyond 2^19*pi/2 skipped", len(rows)-large, large)
}
