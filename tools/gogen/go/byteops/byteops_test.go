package byteops

import (
	"osg/gogen/abaperr"
	"reflect"
	"strings"
	"testing"
)

func TestAllByteMatches(t *testing.T) {
	for _, c := range []struct {
		s, p string
		want [][]int32
	}{
		{"\xc3\xa3\xc3", "\xc3", [][]int32{{0, 1}, {2, 1}}},
		{"aaaaa", "aa", [][]int32{{0, 2}, {2, 2}}},
		{"\xc3\xa3\xc3", "\x3c", nil},
	} {
		if got := All(c.s, c.p); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("All(%x,%x) = %v, want %v", c.s, c.p, got, c.want)
		}
	}
}

func TestAllEmptyPatternRefused(t *testing.T) {
	for _, subject := range []string{"", "\xaa\xbb"} {
		t.Run(subject, func(t *testing.T) {
			defer func() {
				err, ok := recover().(abaperr.ArithmeticError)
				if !ok || err.Class != "NOT_COMPILED" || !strings.Contains(err.Op, "an empty pattern is not measured") {
					t.Fatalf("expected empty pattern refusal, got %#v", err)
				}
			}()
			All(subject, "")
		})
	}
}
