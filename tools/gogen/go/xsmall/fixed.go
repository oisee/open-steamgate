// Package xsmall operates on inline, unescaped fixed ABAP byte fields.
package xsmall

// Set fits on the right with zero bytes, just like an ordinary fixed-x move.
func Set(dst []byte, src string) { n := copy(dst, src); clear(dst[n:]) }

// FromInt sign extends i before retaining its rightmost bytes.
func FromInt(dst []byte, value int32) {
	v := int64(value)
	for i := len(dst) - 1; i >= 0; i-- {
		dst[i] = byte(v)
		v >>= 8
	}
}

// Int retains the last four bytes as a signed i, with zero extension.
func Int(src []byte) int32 {
	var result int32
	for _, b := range src {
		result = result<<8 | int32(b)
	}
	return result
}

// Byte wraps integer constants as well as variables into one byte.
func Byte(value int32) byte { return byte(value) }
