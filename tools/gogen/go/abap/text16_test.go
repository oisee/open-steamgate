package abap

import (
	"testing"

	"osg/gogen/charsection"
)

// REPLACE SECTION through charsection with go/abap's UTF-16 runtime:
// offsets in UTF-16 units, a split pair yields a WTF-8 half.
func TestText16CharSectionReplace(t *testing.T) {
	for _, tc := range []struct {
		base, with string
		off, n     int32
		limit      int
		want       string
		rc         int32
	}{
		{"😀A", "B", 2, 1, -1, "😀B", 0},
		{"😀A", "X", 1, 1, -1, "\xed\xa0\xbdXA", 0},
		{"😀A", "😀", 2, 1, 3, "😀\xed\xa0\xbd", 2},
	} {
		got, rc := charsection.Replace(Text16, tc.base, tc.with, tc.off, tc.n, tc.limit)
		if got != tc.want || rc != tc.rc {
			t.Fatalf("%+v: %x %d", tc, got, rc)
		}
	}
}
