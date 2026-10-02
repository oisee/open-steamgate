package intpower

import "strconv"

// IToString retains the supplied IPOW oracle's leading sign at the i minimum.
// Ordinary integers use the measured ABAP assignment trailing sign.
func IToString(v int32) string {
	if v == -2147483648 {
		return "-2147483648"
	}
	return I8ToString(int64(v))
}

func I8ToString(v int64) string {
	s := strconv.FormatInt(v, 10)
	if v < 0 {
		return s[1:] + "-"
	}
	return s + " "
}

// FToString is assignment formatting, distinct from positional templates.
func FToString(v float64) string { return strconv.FormatFloat(v, 'E', 16, 64) }
