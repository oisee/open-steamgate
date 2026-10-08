package charsection

import "testing"

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
		got, rc := Replace(c.base, c.with, c.off, c.n, c.limit)
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
			Replace("abcd", "X", c[0], c[1], -1)
		}()
	}
}

func TestReplaceUTF16(t *testing.T) {
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
		got, rc := Replace(tc.base, tc.with, tc.off, tc.n, tc.limit)
		if got != tc.want || rc != tc.rc {
			t.Fatalf("%+v: %x %d", tc, got, rc)
		}
	}
}
