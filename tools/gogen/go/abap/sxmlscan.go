package abap

import "osg/gogen/sxmlscan"

func SxmlNameEnd(s *Session, buf string, from int32) int32  { return sxmlscan.NameEnd(buf, from) }
func SxmlSpaceEnd(s *Session, buf string, from int32) int32 { return sxmlscan.SpaceEnd(buf, from) }
func SxmlUtf8Text(s *Session, part string, text *string, ok *int32) {
	*text, *ok = "", 0
	if v, valid := sxmlscan.Utf8Text(part); valid {
		*text, *ok = v, 1
	}
}
