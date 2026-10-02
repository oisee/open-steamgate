package abap

import (
	"math"
	"testing"
)

func TestReplaceByteSection(t *testing.T) {
	for _, c := range []struct {
		name, with string
		off, n     int32
		want       string
	}{
		{"same", "XY", 1, 2, "aXYd"}, {"shorter", "X", 1, 2, "aXd"},
		{"longer", "XYZ", 1, 1, "aXYZcd"}, {"start", "X", 0, 1, "Xbcd"},
		{"end", "X", 4, 0, "abcdX"}, {"default", "X", 0, NoLength, "X"},
		{"rest", "X", 2, NoLength, "abX"}, {"empty", "", 1, 2, "ad"},
		{"negative JS overlap", "X", 2, -1, "abXbcd"},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, rc := ReplaceBytes("abcd", c.with, c.off, c.n, -1)
			if got != c.want || rc != 0 {
				t.Fatalf("got %q/%d, want %q/0", got, rc, c.want)
			}
		})
	}
	if got, rc := ReplaceBytes("abcd", "X", 1, 2, 4); got != "aXd\x00" || rc != 0 {
		t.Fatalf("fixed x: %q/%d", got, rc)
	}
}

func TestFindByteSection(t *testing.T) {
	for _, c := range []struct {
		name, s, p   string
		off, n, want int32
		found        bool
	}{
		{"f2 absolute", "\xaa\xbb\xcc\xaa\xbb\xcc", "\xaa\xbb", 1, 5, 3, true},
		{"start", "abcd", "ab", 0, 2, 0, true}, {"end", "abcd", "", 4, 0, 4, true},
		{"end miss", "abcd", "d", 4, 0, 0, false}, {"no crossing", "abcd", "bc", 1, 1, 0, false},
		{"not found", "abcd", "x", 0, NoLength, 0, false},
		{"whole bytes", "\xaa\xbb\xcc", "\xab\xbc", 0, NoLength, 0, false},
		{"rest", "abcd", "cd", 2, NoLength, 2, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, ok := FindBytes(c.s, c.p, c.off, c.n)
			if got != c.want || ok != c.found {
				t.Fatalf("got %d/%v, want %d/%v", got, ok, c.want, c.found)
			}
		})
	}
}

func TestByteSectionRangeLeavesTarget(t *testing.T) {
	for _, c := range []struct{ off, n int32 }{{-1, 1}, {5, 0}, {3, 2}, {1, math.MaxInt32}, {0, -1}} {
		for _, replace := range []bool{false, true} {
			t.Run("range", func(t *testing.T) {
				target := "abcd"
				defer func() {
					err, ok := recover().(ArithmeticError)
					if !ok || err.Class != "CX_SY_RANGE_OUT_OF_BOUNDS" {
						t.Fatalf("expected range exception, got %#v", err)
					}
					if target != "abcd" {
						t.Fatalf("target changed: %q", target)
					}
				}()
				if replace {
					target, _ = ReplaceBytes(target, "X", c.off, c.n, -1)
				} else {
					FindBytes(target, "X", c.off, c.n)
				}
			})
		}
	}
}
