package packedint

import (
	"osg/gogen/abap"
	"testing"
)

func TestExactAndFallback(t *testing.T) {
	for _, row := range []struct {
		a      string
		b      int64
		digits int
		ok     bool
	}{
		{"", 0, 1, true}, {"12", -20, 3, true}, {"-99", 100, 1, true},
		{"9223372036854775806", 1, 31, true}, {"-9223372036854775808", 1, 31, true},
		{"9223372036854775807", 1, 31, false}, {"-9223372036854775808", -1, 31, false},
		{"123456789012345678901234567890", 1, 31, false},
		{"1.5", 1, 3, false}, {"99", 1, 2, false}, {"-99", -1, 2, false},
	} {
		got, ok := Add(row.a, row.b, row.digits)
		if ok != row.ok {
			t.Fatalf("%+v: %q/%v", row, got, ok)
		}
		if ok {
			want := abap.PFit(abap.AddP(row.a, abap.IToP(row.b)), (row.digits+1)/2, 0, true)
			if got != want {
				t.Fatalf("%+v: %q != %q", row, got, want)
			}
		}
	}
}
