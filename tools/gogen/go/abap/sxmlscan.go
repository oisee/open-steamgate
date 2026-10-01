package abap

import (
	"strings"
	"unicode/utf8"
)

// SxmlNameEnd is ZCL_OSD_SXML_PULL=>NAME_END: from offset from in buf, the
// offset of the first byte that ends a name (blank / > = ? LF tab CR), or
// len(buf).
func SxmlNameEnd(s *Session, buf string, from int32) int32 {
	for i := int(from); i < len(buf); i++ {
		switch buf[i] {
		case ' ', '/', '>', '=', '?', '\n', '\t', '\r':
			return int32(i)
		}
	}
	return int32(len(buf))
}

// SxmlSpaceEnd is ZCL_OSD_SXML_PULL=>SPACE_END: from offset from in buf, the
// offset of the first byte that is not a blank, tab, LF or CR, or len(buf).
func SxmlSpaceEnd(s *Session, buf string, from int32) int32 {
	for i := int(from); i < len(buf); i++ {
		switch buf[i] {
		case ' ', '\t', '\n', '\r':
		default:
			return int32(i)
		}
	}
	return int32(len(buf))
}

// SxmlUtf8Text is ZCL_OSD_SXML_PULL=>UTF8_TEXT: valid UTF-8 is its own text.
// A leading byte order mark is left to the ABAP, which decides what the
// code page conversion makes of it, as is everything that is not UTF-8.
func SxmlUtf8Text(s *Session, part string, text *string, ok *int32) {
	*text, *ok = "", 0
	if utf8.ValidString(part) && !strings.HasPrefix(part, "\xEF\xBB\xBF") {
		*text, *ok = part, 1
	}
}
