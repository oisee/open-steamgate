package abap

import "strings"

// ShiftRightTrailing is SHIFT s RIGHT DELETING TRAILING mask on a string
// (A4H 2026-09-23, ZCL_GOGEN_T_SHIFT): every trailing character that is in
// the mask is removed and a blank comes in on the left for each, so the
// length is kept; "ab\n\n" is "  ab", "ab \n" is " ab ". Measured with a
// mask of one character; a longer mask (a set of characters in the ABAP
// documentation, a suffix in the transpiler's runtime) is refused.
func ShiftRightTrailing(s, mask string) string {
	if len([]rune(mask)) != 1 {
		panic(NotCompiled("SHIFT RIGHT DELETING TRAILING", "a mask of other than one character"))
	}
	r := []rune(s)
	n := len(r)
	for n > 0 && strings.ContainsRune(mask, r[n-1]) {
		n--
	}
	return strings.Repeat(" ", len(r)-n) + string(r[:n])
}
