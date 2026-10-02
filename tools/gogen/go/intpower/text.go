package intpower

import "strconv"

func I8ToString(v int64) string {
	s := strconv.FormatInt(v, 10)
	if v < 0 {
		return s[1:] + "-"
	}
	return s + " "
}

// FToString is assignment formatting, distinct from positional templates.
func FToString(v float64) string { return strconv.FormatFloat(v, 'E', 16, 64) }
