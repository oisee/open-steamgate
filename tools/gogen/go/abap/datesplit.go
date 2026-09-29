package abap

import (
	"strings"
	"unicode/utf8"
)

// DToI is a d moved into an i, or a d as an operand of arithmetic, measured
// on A4H (2026-09-23): the days since 00010101, which is 0; the Julian
// calendar before 15821015 (15821004 is 577736, 15821015 is 577737), the
// Gregorian one from then on (19700101 is 719164); a date that is not one
// (00000000, 20260230, 'ABC') is 0. The ten days the calendar skipped are
// not measured and dump.
func DToI(v string) int32 {
	if len(v) != 8 {
		return 0
	}
	n := [3]int{}
	for i, w := range [3][2]int{{0, 4}, {4, 6}, {6, 8}} {
		for _, ch := range v[w[0]:w[1]] {
			if ch < '0' || ch > '9' {
				return 0
			}
			n[i] = n[i]*10 + int(ch-'0')
		}
	}
	y, m, d := n[0], n[1], n[2]
	if y < 1 || m < 1 || m > 12 || d < 1 {
		return 0
	}
	key := y*10000 + m*100 + d
	julian := key < 15821015
	if key > 15821004 && julian {
		panic(NotCompiled("d -> i", "a date of the ten days skipped in October 1582 is not measured"))
	}
	leap := y%4 == 0
	if !julian {
		leap = leap && (y%100 != 0 || y%400 == 0)
	}
	days := [13]int{0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
	if leap {
		days[2] = 29
	}
	if d > days[m] {
		return 0
	}
	a := (14 - m) / 12
	yy := y + 4800 - a
	mm := m + 12*a - 3
	jdn := d + (153*mm+2)/5 + 365*yy + yy/4
	if julian {
		jdn -= 32083
	} else {
		jdn += -yy/100 + yy/400 - 32045
	}
	return int32(jdn - 1721424)
}

// SplitN is SPLIT v AT sep INTO n fields, measured on A4H: the pieces at
// each separator, the last field taking the rest after its separator, a
// field without a piece empty.
func SplitN(v, sep string, n int) []string {
	out := make([]string, n)
	if sep == "" {
		panic(NotCompiled("SPLIT", "at an empty separator is not measured"))
	}
	copy(out, strings.SplitN(v, sep, n))
	return out
}

// SplitFit moves a piece into a c field of n characters: cut to fit, and a
// piece that did not fit sets sy-subrc 4 (measured on A4H).
func SplitFit(s *Session, piece string, n int) string {
	if utf8.RuneCountInString(strings.TrimRight(piece, " ")) > n {
		s.Sy.Subrc = 4
	}
	return CFit(piece, n)
}
