package abap

import (
	"fmt"
	"strings"
	"testing"
)

type replaceOutcome struct {
	value                string
	subrc                int32
	panicType, panicText string
}

func replaceOutcomeOf(v, p, with string, regex, all, icase bool, off, ln int32, cLen int, fast bool) (out replaceOutcome) {
	defer func() {
		if r := recover(); r != nil {
			out.panicType, out.panicText = fmt.Sprintf("%T", r), fmt.Sprint(r)
		}
	}()
	if fast {
		out.value, out.subrc = ReplaceStmt(v, p, with, regex, all, icase, off, ln, cLen)
	} else {
		out.value, out.subrc = replaceStmt(v, p, with, regex, all, icase, off, ln, cLen, false)
	}
	return
}

func TestReplaceFastSlow(t *testing.T) {
	hi, lo := "\xed\xa0\xbd", "\xed\xb8\x80"
	cases := []struct{ name, v, p, with string }{
		{"absent", "abc abc ", "xyz", "replacement"},
		{"present", "abc abc ", "abc", "X"},
		{"blank", "abc", " ", "X"},
		{"empty_subject", "", "a", "X"},
		{"empty_pattern", "abc", "", "X"},
		{"unicode_absent", "😀é한", "ö", "X"},
		{"unicode_present", "😀é한", "é", "X"},
		{"half_pattern", "😀A", lo, "X"},
		{"high_half_pattern", "😀A", hi, "X"},
		{"half_subject", hi + "A", "z", "X"},
		{"half_present", lo + "A", "A", hi},
		{"split_scalar", hi + lo, "😀", "X"},
		{"fold_ascii", "aBc AbC", "abc", "X"},
		{"fold_kelvin", "KkK", "k", "X"},
		{"fold_long_s", "ſsS", "s", "X"},
		{"fold_sigma", "Σςσ", "σ", "X"},
		{"line_validation", "abc\nxyz", "absent", "X"},
		{"truncate", "abc", "a", "123456789"},
		{"dollars", "abc", "b", "$1\\"},
	}
	sections := []struct {
		name    string
		off, ln int32
	}{
		{"whole", 0, NoLength}, {"explicit", 0, 3},
		{"tail", 1, NoLength}, {"part", 1, 1}, {"zero", 0, 0},
		{"negative_offset", -1, NoLength}, {"past_end", 99, NoLength},
		{"past_length", 0, 99}, {"negative_length", 0, -1},
		{"overflow", 2147483647, 2147483647},
	}
	for _, tc := range cases {
		for _, cLen := range []int{-1, 0, 8} {
			for _, sec := range sections {
				for _, all := range []bool{false, true} {
					for _, icase := range []bool{false, true} {
						name := fmt.Sprintf("%s/c%d/%s/all%t/case%t", tc.name, cLen, sec.name, all, icase)
						t.Run(name, func(t *testing.T) {
							fast := replaceOutcomeOf(tc.v, tc.p, tc.with, false, all, icase, sec.off, sec.ln, cLen, true)
							slow := replaceOutcomeOf(tc.v, tc.p, tc.with, false, all, icase, sec.off, sec.ln, cLen, false)
							if fast != slow {
								t.Fatalf("fast = %#v; slow = %#v", fast, slow)
							}
						})
					}
				}
			}
		}
	}
	for _, p := range []string{"absent", "b*", "", "[", "^a", "$"} {
		t.Run("regex/"+p, func(t *testing.T) {
			fast := replaceOutcomeOf("abc", p, "$1", true, true, false, 0, NoLength, -1, true)
			slow := replaceOutcomeOf("abc", p, "$1", true, true, false, 0, NoLength, -1, false)
			if fast != slow {
				t.Fatalf("fast = %#v; slow = %#v", fast, slow)
			}
		})
	}
}

// Independent expectations ensure the no-match result and subrc are asserted,
// beyond parity with the retained implementation. REPLACEMENT targets are
// rejected by the frontend and are not part of ReplaceStmt's API.
func TestReplaceAbsentFields(t *testing.T) {
	for _, v := range []string{"", "abc  ", "😀é", strings.Repeat("a", 65536)} {
		for _, all := range []bool{false, true} {
			out := replaceOutcomeOf(v, "missing", "X", false, all, false, 0, NoLength, -1, true)
			if out != (replaceOutcome{value: v, subrc: 4}) {
				t.Fatalf("absent result = %#v; want unchanged subject and subrc 4", out)
			}
		}
	}
}

var replaceBenchValue string
var replaceBenchSubrc int32

func BenchmarkReplaceStmt(b *testing.B) {
	for _, size := range []int{1024, 65536} {
		for _, present := range []bool{false, true} {
			// Eight independently allocated subjects exceed the four-entry UTF-16
			// memo, modelling REPLACE on changing runtime values.
			values := make([]string, 8)
			for i := range values {
				values[i] = strings.Repeat("a", size-1) + string(rune('0'+i))
			}
			p := "absent"
			if present {
				p = "aa"
			}
			for _, fast := range []bool{false, true} {
				b.Run(fmt.Sprintf("bytes%d/present%t/fast%t", size, present, fast), func(b *testing.B) {
					b.ReportAllocs()
					for i := 0; i < b.N; i++ {
						replaceBenchValue, replaceBenchSubrc = replaceStmt(values[i%len(values)], p, "x", false, false, false, 0, NoLength, -1, fast)
					}
				})
			}
		}
	}
}
