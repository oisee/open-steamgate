package abap

import (
	"sync"
	"unsafe"
)

// AppendBytes is CONCATENATE x y INTO x IN BYTE MODE. A Go string cannot
// grow, so x + y copies x, and an inflater appending a byte at a time to a
// 64 KiB history copied the history for every byte. A long result is built
// in a buffer with room to spare; appending to the string that is that
// buffer's whole length writes into the room and returns a longer view of
// the same bytes. The bytes a string shows are never written again: a
// shorter view (a copy taken before an append) is not the buffer's whole
// length and is joined by copying, as before. The price is memory: a view
// keeps a buffer of up to twice its length alive, and the four slots keep
// their buffers until they are reused, so a 64 MiB result holds 128 MiB.
func AppendBytes(a, b string) string {
	if len(b) == 0 {
		return a
	}
	if len(a) == 0 {
		return b
	}
	appendMu.Lock()
	defer appendMu.Unlock()
	p := unsafe.StringData(a)
	for i := range appendBufs {
		buf := appendBufs[i]
		if len(buf) == len(a) && unsafe.SliceData(buf) == p && cap(buf)-len(buf) >= len(b) {
			buf = append(buf, b...)
			appendBufs[i] = buf
			return unsafe.String(unsafe.SliceData(buf), len(buf))
		}
	}
	n := len(a) + len(b)
	if n < 4096 {
		return a + b
	}
	buf := make([]byte, n, 2*n)
	copy(buf, a)
	copy(buf[len(a):], b)
	// the buffer a was the whole of, if any, gives its slot up to the new one
	slot := int(appendNext % uint32(len(appendBufs)))
	for i := range appendBufs {
		if len(appendBufs[i]) == len(a) && unsafe.SliceData(appendBufs[i]) == p {
			slot = i
			break
		}
	}
	if slot == int(appendNext%uint32(len(appendBufs))) {
		appendNext++
	}
	appendBufs[slot] = buf
	return unsafe.String(unsafe.SliceData(buf), len(buf))
}

var (
	appendMu   sync.Mutex
	appendBufs [4][]byte
	appendNext uint32
)
