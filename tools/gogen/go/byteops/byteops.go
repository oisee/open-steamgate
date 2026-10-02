package byteops

import (
	"osg/gogen/bytesection"
	"strings"
)

// Replace fits the splice to x(n); A4H P1 x4 longer gives rc2 on truncation.
func Replace(s, with string, off, n int32, xLen int) (string, int32) {
	out := bytesection.Replace(s, with, off, n)
	if xLen < 0 {
		return out, 0
	}
	if len(out) > xLen {
		return out[:xLen], 2
	}
	return out + strings.Repeat("\x00", xLen-len(out)), 0
}

// All returns non-overlapping absolute byte offsets (A4H oracle P2 ALL C3).
// Empty patterns match each boundary, with forward progress between matches.
func All(s, p string) [][]int32 {
	var out [][]int32
	for off := 0; off <= len(s); {
		i := strings.Index(s[off:], p)
		if i < 0 {
			break
		}
		at := off + i
		out = append(out, []int32{int32(at), int32(len(p))})
		off = at + len(p)
		if len(p) == 0 {
			off++
		}
	}
	return out
}
