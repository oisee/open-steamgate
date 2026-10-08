package charsection

import (
	"osg/gogen/bytesection"
	"strings"
)

// Text supplies the runtime's UTF-16 operations without importing its types.
type Text interface {
	CFit(string, int) string
	PadC(string, int) string
	Strlen(string) int32
	SubS(string, int32, int32) string
	JoinUTF16(...string) string
}

// Replace validates character bounds before splicing and fitting a c target.
func Replace(text Text, s, with string, off, n int32, limit int) (string, int32) {
	if limit >= 0 {
		s = text.PadC(text.CFit(s, limit), limit)
	}
	from, to := bytesection.Bounds(int(text.Strlen(s)), off, n)
	out := text.JoinUTF16(text.SubS(s, 0, int32(from)), with, text.SubS(s, int32(to), -1))
	if limit < 0 {
		return out, 0
	}
	rc := int32(0)
	if int(text.Strlen(out)) > limit {
		out, rc = text.SubS(out, 0, int32(limit)), 2
	}
	return strings.TrimRight(out, " "), rc
}
