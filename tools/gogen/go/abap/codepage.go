package abap

import (
	"unicode/utf16"
	"unicode/utf8"
)

// EncodeText is cl_abap_conv_out_ce->convert: the characters of a string as
// the bytes of an encoding. open-abap's create( ) sets the encoding to
// "utf8" (UTF-8 or none) or "utf16le" (code page 4103); any other name is
// refused there already.
func EncodeText(encoding, text string) string {
	switch encoding {
	case "utf8":
		return text
	case "utf16le", "utf-16le":
		u := utf16.Encode([]rune(text))
		b := make([]byte, 0, 2*len(u))
		for _, c := range u {
			b = append(b, byte(c), byte(c>>8))
		}
		return string(b)
	}
	panic(NotCompiled("CL_ABAP_CONV_OUT_CE=>CONVERT", "encoding "+encoding))
}

// DecodeText is cl_abap_conv_in_ce->convert: bytes read as text. A byte
// sequence that is not valid in the encoding raises
// CX_SY_CONVERSION_CODEPAGE in open-abap unless IGNORE_CERR was set; that
// class is not raised from the host, so both cases are refused rather than
// answered with replacement characters.
func DecodeText(encoding string, ignoreErrors bool, data string) string {
	_ = ignoreErrors // either way refused, see above
	switch encoding {
	case "utf8":
		if !utf8.ValidString(data) {
			panic(NotCompiled("CL_ABAP_CONV_IN_CE=>CONVERT", "bytes that are not UTF-8"))
		}
		return data
	case "utf16le", "utf-16le":
		if len(data)%2 != 0 {
			panic(NotCompiled("CL_ABAP_CONV_IN_CE=>CONVERT", "an odd number of UTF-16 bytes"))
		}
		u := make([]uint16, len(data)/2)
		for i := range u {
			u[i] = uint16(data[2*i]) | uint16(data[2*i+1])<<8
		}
		for i := 0; i < len(u); i++ {
			if utf16.IsSurrogate(rune(u[i])) {
				if i+1 < len(u) && u[i] >= 0xD800 && u[i] < 0xDC00 && u[i+1] >= 0xDC00 && u[i+1] < 0xE000 {
					i++
					continue
				}
				panic(NotCompiled("CL_ABAP_CONV_IN_CE=>CONVERT", "an unpaired UTF-16 surrogate"))
			}
		}
		return string(utf16.Decode(u))
	}
	panic(NotCompiled("CL_ABAP_CONV_IN_CE=>CONVERT", "encoding "+encoding))
}
