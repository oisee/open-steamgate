package abap

import (
	"math/big"
	"strconv"
)

// Packed numbers without decimals (p LENGTH n DECIMALS 0): the value is its
// decimal digits with a leading minus, "0" initially. Calculation type p
// carries 31 digits; a result or a move that does not fit its digits
// (2n-1 for a p of length n) raises CX_SY_ARITHMETIC_OVERFLOW. Decimals,
// division and ** are refused by the front end, not approximated here.

func pInt(a string) *big.Int {
	v, ok := new(big.Int).SetString(a, 10)
	if !ok {
		return new(big.Int)
	}
	return v
}

func pOut(v *big.Int, digits int, op string) string {
	if len(new(big.Int).Abs(v).String()) > digits {
		overflow(op)
	}
	return v.String()
}

func AddP(a, b string) string { return pOut(new(big.Int).Add(pInt(a), pInt(b)), 31, "+") }
func SubP(a, b string) string { return pOut(new(big.Int).Sub(pInt(a), pInt(b)), 31, "-") }
func MulP(a, b string) string { return pOut(new(big.Int).Mul(pInt(a), pInt(b)), 31, "*") }

// CmpP compares two packed values: -1, 0 or 1.
func CmpP(a, b string) int { return pInt(a).Cmp(pInt(b)) }

// IToP is an integer as a packed value (i and int8 both reach it widened).
func IToP[T int32 | int64](i T) string { return strconv.FormatInt(int64(i), 10) }

// PFit moves a packed value into a p of length n: an arithmetic result that
// does not fit is CX_SY_ARITHMETIC_OVERFLOW, a plain move
// CX_SY_CONVERSION_OVERFLOW (ABAP documentation; not measured on A4H yet).
func PFit(a string, n int, arith bool) string {
	v := pInt(a)
	if len(new(big.Int).Abs(v).String()) > 2*n-1 {
		if arith {
			overflow("=")
		}
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "p"})
	}
	return v.String()
}
