// Package intpower evaluates integer exponents with checked integer and decimal multiplication.
package intpower

import (
	"math"
	"math/big"
	"osg/gogen/abaperr"
	"strconv"
)

// Float is used for negative exponents and floating calculation types.
func Float(base float64, exp int32) float64 {
	n := math.Pow(base, float64(exp))
	if math.IsInf(n, 0) || math.IsNaN(n) {
		panic(abaperr.ArithmeticError{Class: "CX_SY_ARITHMETIC_OVERFLOW", Op: "ipow"})
	}
	return n
}

// Integer checks every multiply and does not square after the final bit.
func Integer[T ~int32 | ~int64](base T, exp int32) T {
	if exp < 0 {
		n := math.Round(Float(float64(base), exp))
		v := T(n)
		if float64(v) != n {
			panic(abaperr.ArithmeticError{Class: "CX_SY_ARITHMETIC_OVERFLOW", Op: "ipow"})
		}
		return v
	}
	var result T = 1
	multiply := func(a, b T) T {
		n := new(big.Int).Mul(big.NewInt(int64(a)), big.NewInt(int64(b)))
		v := T(n.Int64())
		if !n.IsInt64() || int64(v) != n.Int64() {
			panic(abaperr.ArithmeticError{Class: "CX_SY_ARITHMETIC_OVERFLOW", Op: "ipow"})
		}
		return v
	}
	for exp > 0 {
		if exp&1 != 0 {
			result = multiply(result, base)
		}
		exp >>= 1
		if exp > 0 {
			base = multiply(base, base)
		}
	}
	return result
}

// Packed uses the host's exact decimal multiplication and intermediate limits.
func Packed(base string, exp int32, multiply func(string, string) string, floatToPacked func(float64) string) string {
	if exp < 0 {
		b, err := strconv.ParseFloat(base, 64)
		if err != nil {
			panic(abaperr.ArithmeticError{Class: "CX_SY_ARITHMETIC_OVERFLOW", Op: "ipow"})
		}
		return floatToPacked(Float(b, exp))
	}
	result := "1"
	for exp > 0 {
		if exp&1 != 0 {
			result = multiply(result, base)
		}
		exp >>= 1
		if exp > 0 {
			base = multiply(base, base)
		}
	}
	return result
}

// Boolx numbers bits from one, most significant bit first.
func Boolx(value string, bit int32) string {
	if value != "X" || bit == 0 {
		return ""
	}
	n := int64(bit)
	if n < 0 {
		n = -n
	}
	if n > 524288 {
		panic(abaperr.NotCompiled("boolx( )", "bit beyond local allocation limit"))
	}
	out := make([]byte, (n+7)/8)
	if bit < 0 {
		for i := range out {
			out[i] = 255
		}
		if n%8 != 0 {
			out[len(out)-1] <<= 8 - n%8
		}
	} else {
		out[(n-1)/8] = 1 << (7 - (n-1)%8)
	}
	return string(out)
}
