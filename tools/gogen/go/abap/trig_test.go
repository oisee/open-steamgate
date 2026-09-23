//go:build !libm

package abap

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// Sin/Cos bit for bit against V8 (testdata_trig.json: 200 000 arguments up
// to 5e6, written by node's Math.sin / Math.cos).
func TestTrigMatchesV8(t *testing.T) {
	raw, err := os.ReadFile("testdata_trig.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows [][3]float64
	json.Unmarshal(raw, &rows)
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
	t.Logf("%d compared, %d beyond 2^19*pi/2 skipped", len(rows)-large, large)
	_ = math.Pi
}
