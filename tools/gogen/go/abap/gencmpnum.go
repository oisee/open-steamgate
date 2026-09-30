package abap

import "strconv"

// A numeric operand (i, int8, p, f) compared with a value of another kind:
// that value is converted to the numeric operand's type, then the two are
// compared in it (A4H 2026-09-30, ZCL_OSD_T_CMP, generic operands).

// toNumber: the kinds converted to the type of a numeric operand
func toNumber(k byte) bool {
	return k == 'C' || k == 'g' || k == 'N' || isByte(k) || k == 'D' || k == 'T'
}

// cmpAsNumber compares the numeric n with o converted to n's type: a c,
// string or n by its text (i5 = s'4.9', rounded; i0 = c”), an x by its
// bytes as an integer, a d as its days since 00010101 (d'20260101' =
// i739618), a t as its seconds (t'000010' = i10).
func cmpAsNumber(n, o Data) int {
	var p string // o as an exact number, before it is fitted to n's type
	switch o.T.Kind {
	case 'C', 'g', 'N':
		p = charNumber(*o.P.(*string))
	case 'X', 'y':
		p = strconv.FormatInt(bytesInt(*o.P.(*string), n.T.Kind), 10)
	case 'D':
		p = strconv.Itoa(int(DToI(textOf(o))))
	case 'T':
		p = strconv.Itoa(tSeconds(textOf(o)))
	}
	switch n.T.Kind {
	case 'I':
		x, y := *n.P.(*int32), PToI(p, false)
		return sign3(x < y, x > y)
	case '8':
		x, y := *n.P.(*int64), PToI8(p, false)
		return sign3(x < y, x > y)
	case 'P':
		return CmpP(*n.P.(*string), PFit(p, n.T.Len/100, n.T.Len%100, false))
	}
	x, y := *n.P.(*float64), PToF(p)
	return sign3(x < y, x > y)
}

// CompareNoNumber is the runtime error of text that is no number compared
// with a number: uncatchable on A4H ("abc cannot be interpreted as a
// number"; CATCH cx_root around the IF did not take it, and it ended the
// ABAP Unit run of the class). Its class is not a CX_, so no CATCH takes
// it here either (ClassBased).
const CompareNoNumber = "CONVT_NO_NUMBER"

// charNumber is the text of a c, string or n compared with a number, as
// an exact number
func charNumber(v string) (p string) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(ArithmeticError); ok && e.Class == "CX_SY_CONVERSION_NO_NUMBER" {
				panic(ArithmeticError{CompareNoNumber, strconv.Quote(v) + " cannot be interpreted as a number (comparison)"})
			}
			panic(r)
		}
	}()
	return CToP(v)
}

// bytesInt: an x or xstring converted to an integer type, its bytes read
// as a signed binary integer: for an int8 the last eight bytes (A4H:
// x(8)'0100000000000010' > int8 16), otherwise the last four (typed code's
// measured x -> i, x'0100000002' = 2); a p or f takes the i value
// (x'0010' = p16 = f16; x fields longer than four bytes against a p or an
// f are not measured)
func bytesInt(b string, to byte) int64 {
	n := 4
	if to == '8' {
		n = 8
	}
	if len(b) > n {
		b = b[len(b)-n:]
	}
	var u uint64
	for i := 0; i < len(b); i++ {
		u = u<<8 | uint64(b[i])
	}
	if n == 8 {
		return int64(u)
	}
	return int64(int32(uint32(u)))
}

// tSeconds: a t as its seconds since midnight (A4H t'000010' = i10); a t
// that is not six digits is 0 (not measured)
func tSeconds(v string) int {
	if len(v) != 6 {
		return 0
	}
	n := 0
	for _, ch := range v {
		if ch < '0' || ch > '9' {
			return 0
		}
		n = n*10 + int(ch-'0')
	}
	return n/10000*3600 + n/100%100*60 + n%100
}
