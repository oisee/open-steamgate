package byteops

import (
	"reflect"
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
		{"ab", "", [][]int32{{0, 0}, {1, 0}, {2, 0}}},
	} {
		if got := All(c.s, c.p); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("All(%x,%x) = %v, want %v", c.s, c.p, got, c.want)
		}
	}
}
