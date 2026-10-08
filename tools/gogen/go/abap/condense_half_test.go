package abap

import "testing"

func TestCondenseFnHalves(t *testing.T) {
	hi, lo := SubS("😀", 0, 1), SubS("😀", 1, 1)
	for _, tc := range []struct{ v, del, from, to, want string }{
		{hi, " ", " ", " ", hi}, {" " + hi + "  A ", " ", " ", " ", hi + " A"},
		{hi + " " + lo, " ", " ", "", "😀"},
		{"😀A", hi, " ", " ", lo + "A"},
		{"A😀B", "", lo, "X", "A" + hi + "XB"},
		{"A  B", "", " ", hi, "A" + hi + "B"},
	} {
		if got := CondenseFn(tc.v, tc.del, tc.from, tc.to); got != tc.want {
			t.Errorf("condense(%x)=%x want %x", tc.v, got, tc.want)
		}
	}
}
