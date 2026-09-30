package charsearch

import (
	"strings"
	"unicode/utf16"

	"osg/gogen/abap"
)

// FindOcc returns the character position of the requested occurrence.
// A negative occurrence counts from the end, as FIND( OCC = -2 ) does.
func FindOcc(v, sub string, occ int32) int32 {
	if sub == "" {
		return abap.Find(v, sub, 0) // raises CX_SY_STRG_PAR_VAL
	}
	if occ == 0 {
		panic(abap.NotCompiled("find( )", "OCC = 0 was not measured"))
	}
	positions := []int32{}
	for at := 0; at <= len(v); {
		i := strings.Index(v[at:], sub)
		if i < 0 {
			break
		}
		at += i
		positions = append(positions, int32(len([]rune(v[:at]))))
		at += len(sub)
	}
	index := int(occ) - 1
	if occ < 0 {
		index = len(positions) + int(occ)
	}
	if index < 0 || index >= len(positions) {
		return -1
	}
	return positions[index]
}

func Reverse(v string) string {
	r := []rune(v)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}

// WithPos records the uppercased UTF-16 position, including a miss.
func WithPos(s *abap.Session, a, b string) bool {
	upper := func(v string) string { return strings.ToUpper(strings.ReplaceAll(v, "ß", "SS")) }
	left, right := upper(a), upper(b)
	pos := strings.Index(left, right)
	if pos < 0 {
		s.Sy.Fdpos = int32(len(utf16.Encode([]rune(left))))
		return false
	}
	s.Sy.Fdpos = int32(len(utf16.Encode([]rune(left[:pos]))))
	return true
}
