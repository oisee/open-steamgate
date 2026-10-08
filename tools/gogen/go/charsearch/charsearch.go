package charsearch

import (
	"strings"

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
	for at := int32(0); at <= abap.Strlen(v); {
		pos := abap.Find(v, sub, at)
		if pos < 0 {
			break
		}
		positions = append(positions, pos)
		at = pos + abap.Strlen(sub)
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
	r := abap.UTF16Units(v)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return abap.UTF16String(r)
}

// WithPos folds case without losing WTF-8 halves and records the position
// in the original subject. Sharp-s expansion is retained for matching only.
func WithPos(s *abap.Session, a, b string) bool {
	upper := func(v string) string { return abap.ToUpper(strings.ReplaceAll(v, "ß", "SS")) }
	left, right := upper(a), upper(b)
	pos := int32(0)
	if b != "" {
		pos = abap.Find(left, right, 0)
	}
	if pos < 0 {
		s.Sy.Fdpos = abap.Strlen(a)
		return false
	}
	if strings.Contains(a, "ß") {
		units := abap.UTF16Units(a)
		folded := int32(0)
		for i, u := range units {
			if folded >= pos {
				pos = int32(i)
				break
			}
			if u == 'ß' {
				folded += 2
			} else {
				folded++
			}
			if folded > pos {
				pos = int32(i)
				break
			}
		}
	}
	s.Sy.Fdpos = pos
	return true
}
