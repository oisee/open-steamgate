// Package nodeutf8 decodes bytes as UTF-8 exactly as Node does.
package nodeutf8

import (
	"strings"
	"unicode/utf8"
)

// Decode reads bytes as UTF-8 the way Node's decoder does (WHATWG): each
// maximal subpart of an ill-formed sequence becomes one U+FFFD.
func Decode(b string) string {
	var out strings.Builder
	for i := 0; i < len(b); {
		if r, n := utf8.DecodeRuneInString(b[i:]); r != utf8.RuneError || n > 1 {
			out.WriteString(b[i : i+n])
			i += n
			continue
		}
		n, lo, hi := 0, byte(0x80), byte(0xBF)
		switch c := b[i]; {
		case c >= 0xC2 && c <= 0xDF:
			n = 1
		case c >= 0xE0 && c <= 0xEF:
			n = 2
			if c == 0xE0 {
				lo = 0xA0
			} else if c == 0xED {
				hi = 0x9F
			}
		case c >= 0xF0 && c <= 0xF4:
			n = 3
			if c == 0xF0 {
				lo = 0x90
			} else if c == 0xF4 {
				hi = 0x8F
			}
		}
		j := i + 1
		for k := 0; k < n && j < len(b) && b[j] >= lo && b[j] <= hi; k++ {
			j++
			lo, hi = 0x80, 0xBF
		}
		out.WriteString("\uFFFD")
		i = j
	}
	return out.String()
}
