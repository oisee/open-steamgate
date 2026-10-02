// Package packedint accelerates integral packed checksum additions.
package packedint

import (
	"math"
	"strconv"
)

// Add tries an exact zero-decimal packed move after adding an integer.
// False asks the caller to use its existing arbitrary-precision arithmetic.
func Add(a string, b int64, digits int) (string, bool) {
	var x int64
	if a != "" {
		var err error
		x, err = strconv.ParseInt(a, 10, 64)
		if err != nil {
			return "", false
		}
	}
	if (b > 0 && x > math.MaxInt64-b) || (b < 0 && x < math.MinInt64-b) {
		return "", false
	}
	v := strconv.FormatInt(x+b, 10)
	n := len(v)
	if v[0] == '-' {
		n--
	}
	if n > digits {
		return "", false
	}
	return v, true
}
