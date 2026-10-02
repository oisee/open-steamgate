package bytesection

import (
	"math"
	"osg/gogen/abaperr"
	"strings"
)

const NoLength = math.MinInt32

// Bounds validates FIND/REPLACE spans without depending on storage.
func Bounds(size int, off, n int32) (int, int) {
	end := int64(size)
	if n != NoLength {
		end = int64(off) + int64(n)
	}
	// Negative REPLACE is not yet measured on A4H (round 3 P2-1).
	if off < 0 || int64(off) > int64(size) || end < 0 || end > int64(size) || (n < 0 && n != NoLength) {
		panic(abaperr.ArithmeticError{Class: "CX_SY_RANGE_OUT_OF_BOUNDS", Op: "byte section offset/length"})
	}
	return int(off), int(end)
}

// Replace splices every replacement byte, changing length (ABAPiti r1-r6).
// Bounds are validated before assignment, so r6 leaves the target unchanged.
func Replace(s, with string, off, n int32) string {
	from, to := Bounds(len(s), off, n)
	return s[:from] + with + s[to:]
}

// Find searches whole bytes within the section (ABAPiti f1-f5).
// The offset counts from s, including the section base (f2).
func Find(s, p string, off, n int32) (int32, bool) {
	from, to := Bounds(len(s), off, n)
	i := strings.Index(s[from:to], p)
	if i < 0 {
		return 0, false
	}
	return off + int32(i), true
}
