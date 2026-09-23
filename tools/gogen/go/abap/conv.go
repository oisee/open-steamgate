package abap

import (
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Character-like values are Go strings. A c field is stored without its
// trailing blanks, which is how ABAP compares and concatenates it; its
// length is a property of the type and is applied when a value is moved in.

// CFit moves a character value into a c field of length n: cut at n
// characters, trailing blanks dropped.
func CFit(v string, n int) string {
	if utf8.RuneCountInString(v) > n {
		r := []rune(v)
		v = string(r[:n])
	}
	return strings.TrimRight(v, " ")
}

// FmtI formats an i the way a string template does: a leading minus, no
// blanks.
func FmtI(v int32) string { return strconv.FormatInt(int64(v), 10) }

// FmtI8 is FmtI for int8.
func FmtI8(v int64) string { return strconv.FormatInt(v, 10) }

// IToX moves an i into an x field of n bytes: the big-endian two's
// complement of the four bytes of i, the rightmost n of them.
func IToX(v int32, n int) string {
	b := []byte{byte(uint32(v) >> 24), byte(uint32(v) >> 16), byte(uint32(v) >> 8), byte(uint32(v))}
	if n <= 4 {
		return string(b[4-n:])
	}
	pad := byte(0)
	if v < 0 {
		pad = 0xFF
	}
	out := make([]byte, n)
	for i := range out[:n-4] {
		out[i] = pad
	}
	copy(out[n-4:], b)
	return string(out)
}

// XToHex is an x field as text: two upper-case hex digits per byte.
func XToHex(v string) string { return strings.ToUpper(hex.EncodeToString([]byte(v))) }

// ParseF converts a character value to f: blanks are 0, a trailing minus
// is a sign, anything else that is not a number raises.
func ParseF(v string) float64 {
	t := strings.TrimSpace(v)
	if t == "" {
		return 0
	}
	neg := false
	if strings.HasSuffix(t, "-") {
		neg = true
		t = strings.TrimSpace(t[:len(t)-1])
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->f"})
	}
	if neg {
		f = -f
	}
	return f
}

// ParseI converts a character value to i, rounding a fraction half away
// from zero.
func ParseI(v string) int32 { return F2I(ParseF(v)) }

// I8ToI and F2I8: int8 into i with an overflow check, f into int8 rounded.
func I8ToI(v int64) int32 { return check(v, "int8->i") }

func F2I8(f float64) int64 {
	r := math.Round(f)
	if math.IsNaN(r) || r >= 9.223372036854775807e18 || r < -9.223372036854775808e18 {
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "f->int8"})
	}
	return int64(r)
}

// int8 arithmetic, overflow checked.
func AddI8(a, b int64) int64 {
	r := a + b
	if (a > 0 && b > 0 && r < 0) || (a < 0 && b < 0 && r >= 0) {
		overflow("+")
	}
	return r
}
func SubI8(a, b int64) int64 {
	r := a - b
	if (a >= 0 && b < 0 && r < 0) || (a < 0 && b > 0 && r >= 0) {
		overflow("-")
	}
	return r
}
func MulI8(a, b int64) int64 {
	if a != 0 && b != 0 {
		r := a * b
		if r/b != a || (a == -1 && b == math.MinInt64) || (b == -1 && a == math.MinInt64) {
			overflow("*")
		}
		return r
	}
	return 0
}
func DivI8(a, b int64) int64 {
	if b == 0 {
		if a == 0 {
			return 0
		}
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
	}
	q := a / b
	r := a % b
	if r != 0 && 2*absI64(r) >= absI64(b) {
		if (a < 0) != (b < 0) {
			q--
		} else {
			q++
		}
	}
	return q
}
func DivIntI8(a, b int64) int64 {
	if b == 0 {
		if a == 0 {
			return 0
		}
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", "DIV"})
	}
	r := a % b
	q := a / b
	if r < 0 {
		if b > 0 {
			q--
		} else {
			q++
		}
	}
	return q
}
func ModI8(a, b int64) int64 {
	if b == 0 {
		if a == 0 {
			return 0
		}
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", "MOD"})
	}
	r := a % b
	if r < 0 {
		r += absI64(b)
	}
	return r
}
func absI64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// Built-in numeric functions with ABAP's domain checks.
func SqrtF(v float64) float64 {
	if v < 0 {
		panic(ArithmeticError{"CX_SY_ARG_OUT_OF_DOMAIN", "sqrt"})
	}
	return math.Sqrt(v)
}
func LogF(v float64) float64 {
	if v <= 0 {
		panic(ArithmeticError{"CX_SY_ARG_OUT_OF_DOMAIN", "log"})
	}
	return math.Log(v)
}

// FracF is the fractional part with the sign of the argument, frac( -2.5 ) = -0.5.
func FracF(v float64) float64 { return v - math.Trunc(v) }

func SignI(v int32) int32 {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}
func SignF(v float64) float64 {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

func MaxI(vs ...int32) int32 {
	m := vs[0]
	for _, v := range vs[1:] {
		if v > m {
			m = v
		}
	}
	return m
}
func MinI(vs ...int32) int32 {
	m := vs[0]
	for _, v := range vs[1:] {
		if v < m {
			m = v
		}
	}
	return m
}
func MaxF(vs ...float64) float64 {
	m := vs[0]
	for _, v := range vs[1:] {
		if v > m {
			m = v
		}
	}
	return m
}
func MinF(vs ...float64) float64 {
	m := vs[0]
	for _, v := range vs[1:] {
		if v < m {
			m = v
		}
	}
	return m
}

func ToUpper(v string) string { return strings.ToUpper(v) }
func ToLower(v string) string { return strings.ToLower(v) }
func Strlen(v string) int32   { return int32(utf8.RuneCountInString(v)) }
