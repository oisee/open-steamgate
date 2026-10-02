package charsection

import (
	"osg/gogen/bytesection"
	"strings"
)

// Replace validates character bounds before splicing and fitting a c target.
func Replace(s, with string, off, n int32, limit int) (string, int32) {
	if limit >= 0 {
		s += strings.Repeat(" ", max(0, limit-len([]rune(s))))
	}
	r := []rune(s)
	from, to := bytesection.Bounds(len(r), off, n)
	out := append(append(append([]rune{}, r[:from]...), []rune(with)...), r[to:]...)
	if limit < 0 {
		return string(out), 0
	}
	rc := int32(0)
	if len(out) > limit {
		out = out[:limit]
		rc = 2
	}
	return strings.TrimRight(string(out), " "), rc
}
