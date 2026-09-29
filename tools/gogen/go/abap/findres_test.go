package abap

import (
	"fmt"
	"strings"
	"testing"
)

func fmtRes(ms [][]int32) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d[", len(ms))
	for _, m := range ms {
		fmt.Fprintf(&b, "%d,%d", m[0], m[1])
		for g := 2; g+1 < len(m); g += 2 {
			fmt.Fprintf(&b, "(%d,%d)", m[g], m[g+1])
		}
		b.WriteString(";")
	}
	return b.String() + "]"
}

// A4H 2026-09-25, ZCL_GOGEN_T_FINDRES / _FINDPCRE
func TestFindResults(t *testing.T) {
	for _, c := range []struct {
		s, p       string
		kind       byte
		icase, all bool
		want       string
	}{
		{"xabab", "a|ab", 'R', false, true, "2[1,2;3,2;]"},
		{"xb", "(a)|(b)", 'R', false, false, "1[1,1(-1,0)(1,1);]"},
		{"abab", "((a)(b))", 'R', false, true, "2[0,2(0,2)(0,1)(1,1);2,2(2,2)(2,1)(3,1);]"},
		{"ab cab ab", `\bab\b`, 'R', false, true, "2[0,2;7,2;]"},
		{"aaaaa", "aa", 0, false, true, "2[0,2;2,2;]"},
		{"xAbab", "AB", 'R', true, true, "2[1,2;3,2;]"},
		{"aébé", "b", 0, false, true, "1[2,1;]"},
		{"abd", "b(c)?", 'R', false, false, "1[1,1(-1,0);]"},
		{"aab", "a(b)?", 'R', false, true, "2[0,1(-1,0);1,2(2,1);]"},
		{"abc", "zz", 0, false, true, "0[]"},
		{"abc", "x*", 'R', false, true, "4[0,0;1,0;2,0;3,0;]"},
		{"abbc", "b*", 'R', false, true, "4[0,0;1,2;3,0;4,0;]"},
		{"one two", `(\w+)`, 'R', false, true, "2[0,3(0,3);4,3(4,3);]"},
		{"abcd", "(a|ab)(c|bcd)", 'R', false, true, "1[0,4(0,1)(1,3);]"},
		{"xabab", "a|ab", 'P', false, true, "2[1,1;3,1;]"},
		{"abcd", "(a|ab)(c|bcd)", 'P', false, true, "1[0,4(0,1)(1,3);]"},
		{"abbc", "b*", 'P', false, true, "4[0,0;1,2;3,0;4,0;]"},
		{"ab cab ab", `\bab\b`, 'P', false, true, "2[0,2;7,2;]"},
		{"ab", "(x)?b", 'P', false, true, "1[1,1(-1,0);]"},
		{"aaa", "a+?", 'P', false, true, "3[0,1;1,1;2,1;]"},
		{"xAbab", "AB", 'P', true, true, "2[1,2;3,2;]"},
	} {
		if got := fmtRes(FindResults(c.s, c.p, c.kind, c.icase, c.all)); got != c.want {
			t.Errorf("%q in %q (%c): %s, A4H %s", c.p, c.s, c.kind, got, c.want)
		}
	}
	for _, p := range []string{"(?=a)", "(?<=a)b", `(a)\1`, "a++", "(?>a)"} {
		func() {
			defer func() {
				if e, ok := recover().(ArithmeticError); !ok || e.Class != "NOT_COMPILED" {
					t.Errorf("%s: not refused by name: %v", p, e)
				}
			}()
			FindResults("aab", p, 'P', false, true)
		}()
	}
}
