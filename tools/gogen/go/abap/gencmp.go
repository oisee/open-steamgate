package abap

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

// Comparisons of generic values, pairwise.
//
// Equality of two ABAP values depends on both types: the pair decides the
// comparison type and which operand is converted (X'10' <> 10, NUMC '0005'
// = '5'), so no key of one operand can be right. CmpData takes the pair.
// CL_ABAP_UNIT_ASSERT=>ASSERT_EQUALS ends in `act <> exp` with both TYPE
// any, which is where the Go unit runs met it.
//
// The front end compiles a generic comparison to DataChars( a ) op
// DataChars( b ) today; DataChars stays what it was (a c or a string, the
// rule A4H showed in ZCL_GOGEN_T_GENCMP) and dumps on anything else. The
// emitter change that sends such comparisons to CmpData is in the report
// of fix/gogen-assert-compare.

// DataChars is a generic operand of a comparison with a character operand:
// its characters when it holds a c or a string (a c has no trailing blanks
// stored), the rule A4H showed (ZCL_GOGEN_T_GENCMP); any other kind compares
// by rules that need the other operand (CmpData) and dumps.
func DataChars(d Data) string {
	if d.P == nil {
		panic(notAssigned("comparison"))
	}
	switch d.T.Kind {
	case 'g', 'C':
		return *d.P.(*string)
	}
	panic(NotCompiled("comparison", "a generic value of type kind "+string(d.T.Kind)+" with a character operand"))
}

// StrData is a typed character operand as generic data, for CmpData: a c
// is stored without its trailing blanks and compares like a string with
// every generic operand CmpData takes (c with string: the c's trailing
// blanks do not count, A4H ZCL_GOGEN_T_GENCMP).
func StrData(v string) Data { return Data{P: &v, T: TString} }

// DataEq is a = b of two generic values (CmpData).
func DataEq(a, b Data) bool { return CmpData(a, b) == 0 }

// CmpData compares two generic values by ABAP's comparison rules: -1, 0, 1.
//
//   - tables: number of rows, then row by row; structures: component by
//     component (same number of components); object and data references:
//     the same target or not (0 or 1, only = and <> mean anything);
//   - numeric (i, int8, p, f) with numeric: f when either is an f (so an
//     int8 or p beyond 2^53 is rounded to f first), else exact;
//   - numeric with c, string, n, x, xstring, d or t: the other operand
//     converted to the numeric operand's type, then compared in it
//     (gencmpnum.go: i5 = s'4.9', d as days, t as seconds, x by its bytes;
//     text that is no number is the uncatchable CONVT_NO_NUMBER);
//   - n with c, string or n: as numbers;
//   - x with x: the shorter padded with 00 on the right; xstring with
//     xstring or x: the bytes, a prefix is smaller;
//   - x or xstring with c or string: its hex digits in upper case, then
//     characters; with n: its last four bytes as a signed i;
//   - c, string, d, t with each other: the characters (a c without its
//     trailing blanks, a d or t never set as its zeros).
//
// The rules with numbers and with n were measured on A4H on 2026-09-30
// (ZCL_OSD_T_CMP). Pairs outside them (a structure with an elementary
// value, ...) dump NOT_COMPILED.
func CmpData(a, b Data) int {
	if a.P == nil || b.P == nil {
		panic(notAssigned("comparison"))
	}
	ka, kb := a.T.Kind, b.T.Kind
	switch {
	case ka == 'h' && kb == 'h':
		na, nb := a.T.Lines(a.P), b.T.Lines(b.P)
		if na != nb {
			return sign3(na < nb, na > nb)
		}
		for i := 0; i < na; i++ {
			if c := CmpData(Row(a, i), Row(b, i)); c != 0 {
				return c
			}
		}
		return 0
	case isStruct(ka) && isStruct(kb):
		if len(a.T.Comps) != len(b.T.Comps) {
			break
		}
		for i := range a.T.Comps {
			ca, cb := a.T.Comps[i], b.T.Comps[i]
			if c := CmpData(Data{P: ca.Get(a.P), T: ca.T}, Data{P: cb.Get(b.P), T: cb.T}); c != 0 {
				return c
			}
		}
		return 0
	case ka == 'r' && kb == 'r':
		if RefEq(derefAny(a.P), derefAny(b.P)) {
			return 0
		}
		return 1
	case ka == 'l' && kb == 'l':
		if refID(a.P.(*Data).P) == refID(b.P.(*Data).P) {
			return 0
		}
		return 1
	case isByte(ka) && isByte(kb):
		x, y := *a.P.(*string), *b.P.(*string)
		if ka == 'X' && kb == 'X' {
			if n := len(y) - len(x); n > 0 {
				x += strings.Repeat("\x00", n)
			} else if n < 0 {
				y += strings.Repeat("\x00", -n)
			}
		}
		return strings.Compare(x, y)
	case isByte(ka) && (kb == 'C' || kb == 'g'):
		return strings.Compare(XToHex(*a.P.(*string)), *b.P.(*string))
	case isByte(kb) && (ka == 'C' || ka == 'g'):
		return strings.Compare(*a.P.(*string), XToHex(*b.P.(*string)))
	case isByte(ka) && kb == 'N', isByte(kb) && ka == 'N':
		return CmpP(byteOrN(a), byteOrN(b))
	case isNum(ka) && isNum(kb):
		if ka == 'F' || kb == 'F' {
			x, y := dataF(a), dataF(b)
			return sign3(x < y, x > y)
		}
		return CmpP(DataP(a), DataP(b))
	case isNum(ka) && toNumber(kb):
		return cmpAsNumber(a, b)
	case isNum(kb) && toNumber(ka):
		return -cmpAsNumber(b, a)
	case ka == 'N' && (kb == 'N' || kb == 'C' || kb == 'g'), kb == 'N' && (ka == 'C' || ka == 'g'):
		return CmpP(DataP(a), DataP(b))
	case isText(ka) && isText(kb):
		return strings.Compare(textOf(a), textOf(b))
	}
	panic(NotCompiled("comparison", "a generic value of type kind "+string(ka)+" with one of type kind "+string(kb)))
}

func isStruct(k byte) bool { return k == 'u' || k == 'v' }
func isNum(k byte) bool    { return k == 'I' || k == '8' || k == 'P' || k == 'F' }
func isByte(k byte) bool   { return k == 'X' || k == 'y' }
func isText(k byte) bool   { return k == 'C' || k == 'g' || k == 'D' || k == 'T' }

// textOf: a d or t never set (a structure field, "") as its zeros
func textOf(d Data) string {
	v := *d.P.(*string)
	if v == "" {
		switch d.T.Kind {
		case 'D':
			return "00000000"
		case 'T':
			return "000000"
		}
	}
	return v
}

// byteOrN: of an x or xstring against an n, the x's last four bytes as a
// signed i, and the n's digits as an exact number, however many (A4H:
// n(20)'99999999999999999999' > x'00', n'00016' = x'0010')
func byteOrN(d Data) string {
	if isByte(d.T.Kind) {
		return strconv.FormatInt(bytesInt(*d.P.(*string), 'I'), 10)
	}
	return DataP(d)
}

func dataF(d Data) float64 {
	switch d.T.Kind {
	case 'F':
		return *d.P.(*float64)
	case 'I':
		return float64(*d.P.(*int32))
	case '8':
		return float64(*d.P.(*int64))
	}
	return PToF(DataP(d))
}

// refID names what a data reference points to; every initial one is ""
func refID(x any) string {
	if refNil(x) {
		return ""
	}
	v := reflect.ValueOf(x)
	if v.Kind() == reflect.Pointer {
		return fmt.Sprintf("%T@%x", x, v.Pointer())
	}
	return fmt.Sprintf("%v", x)
}

func sign3(lt, gt bool) int {
	switch {
	case lt:
		return -1
	case gt:
		return 1
	}
	return 0
}
