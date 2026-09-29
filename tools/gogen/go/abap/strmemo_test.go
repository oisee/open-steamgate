package abap

import (
	"strings"
	"testing"
)

// Find and SubS over a long string through the memo (strMemo) answer what
// the rune slices answer, ASCII or not.
func TestStrMemoFindSubS(t *testing.T) {
	for _, v := range []string{strings.Repeat("ab<c>", 300), strings.Repeat("aé<€>x", 250) + "tail"} {
		r := []rune(v)
		for off := 0; off <= len(r); off += 7 {
			want := int32(-1)
			if i := strings.Index(string(r[off:]), ">"); i >= 0 {
				want = int32(off + len([]rune(string(r[off:])[:i])))
			}
			if got := Find(v, ">", int32(off)); got != want {
				t.Fatalf("Find off %d: %d, want %d", off, got, want)
			}
			for _, l := range []int{0, 1, 5} {
				if off+l > len(r) {
					continue
				}
				if got := SubS(v, int32(off), int32(l)); got != string(r[off:off+l]) {
					t.Fatalf("SubS %d %d: %q, want %q", off, l, got, string(r[off:off+l]))
				}
			}
			if got := SubS(v, int32(off), -1); got != string(r[off:]) {
				t.Fatalf("SubS %d rest", off)
			}
		}
	}
}
