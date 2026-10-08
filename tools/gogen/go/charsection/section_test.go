package charsection

import (
	"strings"
	"testing"
)

// runes is a Text over Go runes: enough to test the splice and the fitting
// here; go/abap's UTF-16 implementation is tested in go/abap.
type runes struct{}

func (runes) Len(s string) int32 { return int32(len([]rune(s))) }
func (runes) Sub(s string, off, length int32) string {
	r := []rune(s)
	if length < 0 {
		return string(r[off:])
	}
	return string(r[off : off+length])
}
func (runes) Fit(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}
func (t runes) Pad(s string, n int) string {
	return s + strings.Repeat(" ", max(0, n-int(t.Len(s))))
}
func (runes) Join(parts ...string) string { return strings.Join(parts, "") }

func TestReplace(t *testing.T) {
	for _, c := range []struct {
		base, with string
		off, n     int32
		limit      int
		want       string
		rc         int32
	}{
		{"abcd", "XY", 1, 2, -1, "aXYd", 0},
		{"a界cd", "🙂", 1, 1, -1, "a🙂cd", 0},
		{"abcd", "XYZ", 1, 1, 4, "aXYZ", 2},
		{"a", "X", 2, 1, 4, "a X", 0},
		{"abcd", "", 1, 2, -1, "ad", 0},
		{"abcd", "X", 1, -2147483648, -1, "aX", 0},
	} {
		got, rc := Replace(runes{}, c.base, c.with, c.off, c.n, c.limit)
		if got != c.want || rc != c.rc {
			t.Fatalf("%+v: got %q, %d", c, got, rc)
		}
	}
}

func TestBoundsBeforeSplice(t *testing.T) {
	for _, c := range [][2]int32{{-1, 1}, {5, 0}, {1, 4}, {1, -1}} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("no bounds error for %v", c)
				}
			}()
			Replace(runes{}, "abcd", "X", c[0], c[1], -1)
		}()
	}
}
