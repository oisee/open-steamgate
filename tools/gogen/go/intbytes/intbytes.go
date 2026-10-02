// Package intbytes implements ABAP integer/byte assignments.
package intbytes

import "osg/gogen/abaperr"

// ToX writes exactly width big-endian two's-complement bytes, right-aligned
// in n bytes. Wider targets have zero padding, including for negative v.
func ToX(v int64, width, n int) string {
	out := make([]byte, n)
	bits := uint64(v)
	for i := 0; i < width && i < n; i++ {
		out[n-1-i] = byte(bits)
		bits >>= 8
	}
	return string(out)
}

// FromX ignores leading bytes beyond width, zero-extends short inputs, then
// reads a signed width-byte value. Empty xstrings give zero.
func FromX(v string, width int) int64 {
	if len(v) > width {
		v = v[len(v)-width:]
	}
	var bits uint64
	for i := 0; i < len(v); i++ {
		bits = bits<<8 | uint64(v[i])
	}
	if width == 4 {
		return int64(int32(bits))
	}
	return int64(bits)
}

// ToString removes leading zeros for nonzero positive integers. The SAP
// table lists 1-4 or 8 bytes for int8; 5-7 bytes and zero await an oracle.
func ToString(v int64, width int) string {
	out := ToX(v, width, width)
	for len(out) > 0 && out[0] == 0 {
		out = out[1:]
	}
	if len(out) == 0 || (width == 8 && len(out) > 4 && len(out) < 8) {
		panic(abaperr.NotCompiled("integer -> xstring", "zero or 5-7 significant bytes needs an oracle row"))
	}
	return out
}
