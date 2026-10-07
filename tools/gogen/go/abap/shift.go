package abap

import "strings"

// ShiftRightTrailing is SHIFT s RIGHT DELETING TRAILING mask on a string
// (A4H 2026-09-23, ZCL_GOGEN_T_SHIFT): every trailing character that is in
// the mask is removed and a blank comes in on the left for each, so the
// length is kept; "ab\n\n" is "  ab", "ab \n" is " ab ". Measured with a
// mask of one character; a longer mask (a set of characters in the ABAP
// documentation, a suffix in the transpiler's runtime) is refused.
func ShiftRightTrailing(s, mask string) string {
	if int(Strlen(mask)) != 1 {
		panic(NotCompiled("SHIFT RIGHT DELETING TRAILING", "a mask of other than one character"))
	}
	r := UTF16Units(s)
	n := len(r)
	for n > 0 && r[n-1] == UTF16Units(mask)[0] {
		n--
	}
	return strings.Repeat(" ", len(r)-n) + UTF16String(r[:n])
}

// ShiftPlaces is statement SHIFT [BY n PLACES] [LEFT|RIGHT] [CIRCULAR].
// A string shrinks on a plain left shift; right shifts and c fields keep
// their length by inserting blanks. Circular counts wrap modulo length.
func ShiftPlaces(v string, left, circular bool, n int32, cLen int) string {
	if cLen >= 0 {
		v = PadC(CFit(v, cLen), cLen)
	}
	l := Strlen(v)
	count := int64(n)
	if count < 0 {
		left, count = !left, -count
	}
	if !circular && !left && cLen < 0 {
		return strings.Repeat(" ", int(count)) + v
	}
	if l == 0 {
		return v
	}
	if circular {
		n = int32(count % int64(l))
	} else {
		n = int32(min(count, int64(l)))
	}
	var out string
	if circular {
		if left {
			out = JoinUTF16(SubS(v, n, -1), SubS(v, 0, n))
		} else {
			out = JoinUTF16(SubS(v, l-n, -1), SubS(v, 0, l-n))
		}
	} else if left {
		out = SubS(v, n, -1)
		if cLen >= 0 {
			out += strings.Repeat(" ", int(n))
		}
	} else {
		out = strings.Repeat(" ", int(n)) + SubS(v, 0, l-n)
	}
	if cLen >= 0 {
		return CFit(out, cLen)
	}
	return out
}
