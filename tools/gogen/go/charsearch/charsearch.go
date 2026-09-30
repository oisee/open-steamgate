package charsearch

import (
	"strings"
	"unicode/utf16"

	"osg/gogen/abap"
)

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
