package subwrite

import (
	"osg/gogen/abap"
	"testing"
)

func TestCharUTF16(t *testing.T) {
	for _, tc := range []struct {
		base   string
		off, n int32
		val    string
		limit  int
		want   string
	}{
		{"😀A", 2, 1, "B", -1, "😀B"},
		{"😀A", 1, 1, "X", -1, "\xed\xa0\xbdXA"},
		{"😀A", 0, 2, "", -1, "  A"},
		{"😀A", 0, 1, "😀", -1, "😀A"},
		{"😀A", 2, 1, "BC", -1, "😀B"},
		{"😀", 2, 1, "X", 4, "😀X"},
		{"😀A", 2, -1, "", -1, "😀 "},
	} {
		if got := Char(tc.base, tc.off, tc.n, tc.val, tc.limit); got != tc.want {
			t.Fatalf("%+v: %x", tc, got)
		}
	}
	defer func() {
		e, ok := recover().(abap.ArithmeticError)
		if !ok || e.Class != "CX_SY_RANGE_OUT_OF_BOUNDS" {
			t.Fatal("bounds")
		}
	}()
	Char("😀A", 2, 2, "x", -1)
}
