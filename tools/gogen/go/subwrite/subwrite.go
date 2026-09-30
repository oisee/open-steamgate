package subwrite

import "osg/gogen/abap"

// X writes an offset/length target of a fixed-length hex field. SubX checks
// the ABAP byte bounds; XFit gives the assigned fragment its target length.
func X(base string, off, length int32, value string) string {
	_ = abap.SubX(base, off, length)
	return base[:off] + abap.XFit(value, int(length)) + base[off+length:]
}
