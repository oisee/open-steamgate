// Package intarith implements checked ABAP int8 arithmetic without allocations.
package intarith

import (
	"math"
	"math/bits"
	"osg/gogen/abaperr"
)

func overflow(op string) { panic(abaperr.ArithmeticError{Class: "CX_SY_ARITHMETIC_OVERFLOW", Op: op}) }
func Add(a, b int64) int64 {
	r := a + b
	if ((a ^ r) & (b ^ r)) < 0 {
		overflow("+")
	}
	return r
}
func Sub(a, b int64) int64 {
	r := a - b
	if ((a ^ b) & (a ^ r)) < 0 {
		overflow("-")
	}
	return r
}
func magnitude(v int64) uint64 {
	if v < 0 {
		return uint64(-(v + 1)) + 1
	}
	return uint64(v)
}
func Mul(a, b int64) int64 {
	hi, lo := bits.Mul64(magnitude(a), magnitude(b))
	negative := (a < 0) != (b < 0)
	limit := uint64(math.MaxInt64)
	if negative {
		limit++
	}
	if hi != 0 || lo > limit {
		overflow("*")
	}
	if negative {
		return -int64(lo)
	}
	return int64(lo)
}
func zero(a, b int64, op string) bool {
	if b != 0 {
		return false
	}
	if a != 0 {
		panic(abaperr.ArithmeticError{Class: "CX_SY_ZERODIVIDE", Op: op})
	}
	return true
}
func quotient(a, b int64, op string) int64 {
	if a == math.MinInt64 && b == -1 {
		overflow(op)
	}
	return a / b
}

// Div rounds half away from zero. Unsigned magnitudes cover MIN and avoid
// overflow when doubling a remainder near the int64 limit.
func Div(a, b int64) int64 {
	if zero(a, b, "/") {
		return 0
	}
	q := quotient(a, b, "/")
	r, divisor := magnitude(a%b), magnitude(b)
	if r >= divisor/2+divisor%2 {
		if (a < 0) != (b < 0) {
			q--
		} else {
			q++
		}
	}
	return q
}

// Quot and Mod are Euclidean: a = b*q + r, 0 <= r < |b|, even for b < 0.
func Quot(a, b int64) int64 {
	if zero(a, b, "DIV") {
		return 0
	}
	q := quotient(a, b, "DIV")
	if a%b < 0 {
		if b > 0 {
			q--
		} else {
			q++
		}
	}
	return q
}
func Mod(a, b int64) int64 {
	if zero(a, b, "MOD") {
		return 0
	}
	r := a % b
	if r < 0 {
		return int64(uint64(r) + magnitude(b))
	}
	return r
}

// Packed tries an integral calculation in int64. Only arithmetic overflow
// retries with the original packed expression; other exceptions propagate.
// The emitter admits only pure operands, so retry cannot repeat side effects.
func Packed(fast, slow func() int64) (r int64) {
	defer func() {
		if x := recover(); x != nil {
			if e, ok := x.(abaperr.ArithmeticError); ok && e.Class == "CX_SY_ARITHMETIC_OVERFLOW" {
				r = slow()
			} else {
				panic(x)
			}
		}
	}()
	return fast()
}
