package charsection

import (
	"osg/gogen/abap"
	"osg/gogen/bytesection"
	"strings"
)

// Replace validates character bounds before splicing and fitting a c target.
func Replace(s, with string, off, n int32, limit int) (string, int32) {
	if limit >= 0 {
		s = abap.PadC(abap.CFit(s, limit), limit)
	}
	from, to := bytesection.Bounds(int(abap.Strlen(s)), off, n)
	out := abap.JoinUTF16(abap.SubS(s, 0, int32(from)), with, abap.SubS(s, int32(to), -1))
	if limit < 0 {
		return out, 0
	}
	rc := int32(0)
	if int(abap.Strlen(out)) > limit {
		out, rc = abap.SubS(out, 0, int32(limit)), 2
	}
	return strings.TrimRight(out, " "), rc
}
