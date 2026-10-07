package subwrite

import "osg/gogen/abap"

// X writes an offset/length target of a fixed-length hex field. SubX checks
// the ABAP byte bounds; XFit gives the assigned fragment its target length.
func X(base string, off, length int32, value string) string {
	_ = abap.SubX(base, off, length)
	return base[:off] + abap.XFit(value, int(length)) + base[off+length:]
}

// Char assigns a fixed-width character section; shorter values are padded,
// longer ones are cut in UTF-16 units. Validation precedes any assignment.
func Char(base string, off, length int32, value string, limit int) string {
	if limit >= 0 {
		base = abap.PadC(abap.CFit(base, limit), limit)
	}
	if length < 0 {
		length = abap.Strlen(base) - off
	}
	_ = abap.SubS(base, off, length)
	value = abap.PadC(abap.SubS(value, 0, min(length, abap.Strlen(value))), int(length))
	out := abap.JoinUTF16(abap.SubS(base, 0, off), value, abap.SubS(base, off+length, -1))
	if limit >= 0 {
		return abap.CFit(out, limit)
	}
	return out
}
