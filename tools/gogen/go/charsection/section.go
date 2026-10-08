package charsection

import (
	"osg/gogen/bytesection"
	"strings"
)

// Text is what Replace needs from a character runtime: lengths and sections
// in its own character units (UTF-16 code units for ABAP), fitting and
// padding a fixed character target, and joining text. go/abap provides it
// (abap.Text16); this package does not import go/abap.
type Text interface {
	Len(s string) int32
	Sub(s string, off, length int32) string
	Fit(s string, n int) string
	Pad(s string, n int) string
	Join(parts ...string) string
}

// Replace validates character bounds before splicing and fitting a c target.
func Replace(t Text, s, with string, off, n int32, limit int) (string, int32) {
	if limit >= 0 {
		s = t.Pad(t.Fit(s, limit), limit)
	}
	from, to := bytesection.Bounds(int(t.Len(s)), off, n)
	out := t.Join(t.Sub(s, 0, int32(from)), with, t.Sub(s, int32(to), -1))
	if limit < 0 {
		return out, 0
	}
	rc := int32(0)
	if int(t.Len(out)) > limit {
		out, rc = t.Sub(out, 0, int32(limit)), 2
	}
	return strings.TrimRight(out, " "), rc
}
