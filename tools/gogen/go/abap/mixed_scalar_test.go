package abap

import "testing"

func TestToMixedScalar(t *testing.T) {
	hi, lo := SubS("😀", 0, 1), SubS("😀", 1, 1)
	for _, tc := range []struct {
		v, want string
		hasCase bool
		cs      string
		min     int32
	}{
		{"a𐐀", "a𐐨", false, "", 1}, {"a_𐐨", "a𐐀", false, "", 1},
		{"𐐨_a", "𐐀A", true, "A", 2}, {"𐐀_A", "𐐨A", true, "a", 2},
		{hi + "_A", hi + "A", false, "", 1}, {"a" + lo, "a" + lo, false, "", 1},
	} {
		if got := ToMixed(tc.v, "_", tc.hasCase, tc.cs, tc.min); got != tc.want {
			t.Errorf("ToMixed(%x)=%x want %x", tc.v, got, tc.want)
		}
	}
	// Other folding helpers must fold scalars while preserving lone halves.
	if got := ToUpper(hi + "𐐨가"); got != hi+"𐐀가" {
		t.Errorf("upper=%x", got)
	}
	if got := ToLower(lo + "𐐀가"); got != lo+"𐐨가" {
		t.Errorf("lower=%x", got)
	}
}
