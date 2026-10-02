// Package xbuf stores one statically unescaped ABAP xstring in owned bytes.
// Buffer must never be copied or bound to ABAP references. The emitter proves
// this per variable; every whole-value read is a string snapshot, and every
// whole-value write copies in. Escaped xstrings retain the ordinary string ABI.
package xbuf

import "osg/gogen/bytesection"

type Buffer struct{ bytes []byte }

func (b *Buffer) Snapshot() string { return string(b.bytes) }
func (b *Buffer) Len() int32       { return int32(len(b.bytes)) }
func (b *Buffer) Clear()           { b.bytes = nil }
func (b *Buffer) Set(value string) {
	if len(value) < cap(b.bytes)/4 {
		b.bytes = nil
	}
	b.bytes = append(b.bytes[:0], value...)
}

// Sub copies only the requested span, never the entire linear memory.
func (b *Buffer) Sub(off, n int32) string {
	if n < 0 {
		n = bytesection.NoLength
	}
	from, to := bytesection.Bounds(len(b.bytes), off, n)
	return string(b.bytes[from:to])
}

// Replace shares the ordinary byte-section bounds contract. No mutation takes
// place before validation. Equal lengths do not allocate; other lengths splice.
func (b *Buffer) Replace(with string, off, n int32) int32 {
	from, to := bytesection.Bounds(len(b.bytes), off, n)
	if len(with) == to-from {
		copy(b.bytes[from:to], with)
	} else {
		tail := append([]byte(nil), b.bytes[to:]...)
		b.bytes = append(b.bytes[:from], with...)
		b.bytes = append(b.bytes, tail...)
	}
	return 0
}

// Append's arguments are snapshots evaluated before any writes, including
// self/overlapping operands. Go's slice growth amortises repeated self-appends.
func (b *Buffer) Append(parts ...string) {
	for _, part := range parts {
		b.bytes = append(b.bytes, part...)
	}
}

// ReadInto checks the span before copying and zero-padding a fixed-x target.
func (b *Buffer) ReadInto(dst []byte, off, n int32) {
	from, to := bytesection.Bounds(len(b.bytes), off, n)
	copied := copy(dst, b.bytes[from:to])
	clear(dst[copied:])
}

// StoreFrom validates an equal-length span; a single byte needs one store.
func (b *Buffer) StoreFrom(src []byte, off int32) int32 {
	from, to := bytesection.Bounds(len(b.bytes), off, int32(len(src)))
	if len(src) == 1 {
		b.bytes[from] = src[0]
	} else {
		copy(b.bytes[from:to], src)
	}
	return 0
}

// Byte and StoreByte avoid string conversions and general copy loops for W1.
func (b *Buffer) Byte(off int32) byte {
	from, _ := bytesection.Bounds(len(b.bytes), off, 1)
	return b.bytes[from]
}
func (b *Buffer) StoreByte(value byte, off int32) int32 {
	from, _ := bytesection.Bounds(len(b.bytes), off, 1)
	b.bytes[from] = value
	return 0
}
