// Package intbytes implements ABAP integer/byte assignments.
package intbytes

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

// ToString drops leading zeros but keeps at least the last byte (00 for zero).
// Supplied ABAPiti oracle rows confirm 5/6-byte int8 results; see NOTES.md.
func ToString(v int64, width int) string {
	out := ToX(v, width, width)
	for len(out) > 1 && out[0] == 0 {
		out = out[1:]
	}
	return out
}
