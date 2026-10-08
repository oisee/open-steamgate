package abap

import (
	"osg/gogen/timestamp"
	"strings"
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

// TToI is a time operand's seconds since midnight.
func TToI(v string) int32 {
	if len(v) != 6 {
		return 0
	}
	n := int32(0)
	for i, factor := range []int32{3600, 60, 1} {
		a, b := v[2*i], v[2*i+1]
		if a < '0' || a > '9' || b < '0' || b > '9' {
			return 0
		}
		n += (int32(a-'0')*10 + int32(b-'0')) * factor
	}
	return n
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
	if int(Strlen(strings.TrimRight(piece, " "))) > n {
		s.Sy.Subrc = 4
	}
	return CFit(piece, n)
}

// Host statement adapters use ordinary native IR so both emitters can
// compile the surrounding class, even when a host lacks this operation.
func ConvertTimestampInto(s *Session, stamp, zone string, date, clock Data) {
	d, tm, rc, ok, err := timestamp.ToDateTime(stamp, zone)
	if err != nil {
		panic(NotCompiled("CONVERT TIME STAMP", err.Error()))
	}
	s.Sy.Subrc = rc
	if !ok {
		return
	}
	if date.P != nil {
		MoveData(date, Data{P: &d, T: TString})
	}
	if clock.P != nil {
		MoveData(clock, Data{P: &tm, T: TString})
	}
}

func ConvertDateTimeInto(s *Session, date, clock, zone string, stamp Data) {
	ts, rc, ok, err := timestamp.FromDateTime(date, clock, zone)
	if err != nil {
		panic(NotCompiled("CONVERT TIME STAMP", err.Error()))
	}
	s.Sy.Subrc = rc
	if ok {
		MoveData(stamp, Data{P: &ts, T: TString})
	}
}
