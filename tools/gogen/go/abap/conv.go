package abap

import (
	"encoding/base64"
	"encoding/hex"
	"math"
	"net/url"
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

// FmtF formats an f the way a string template does, as measured on A4H
// 2026-09-23: seventeen significant digits, always positional (1E20 is
// 100000000000000000000, 1E-7 is 0.000000099999999999999995), trailing
// zeros of the fraction dropped (1.5, 0.001, 2).
func FmtF(v float64) string {
	if v == 0 {
		return "0"
	}
	e := strconv.FormatFloat(v, 'e', 16, 64) // [-]d.dddddddddddddddde±XX
	neg := e[0] == '-'
	if neg {
		e = e[1:]
	}
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	x, _ := strconv.Atoi(exp)
	// the decimal point sits after digit number x+1
	point := x + 1
	var intPart, frac string
	switch {
	case point <= 0:
		intPart, frac = "0", strings.Repeat("0", -point)+digits
	case point >= len(digits):
		intPart, frac = digits+strings.Repeat("0", point-len(digits)), ""
	default:
		intPart, frac = digits[:point], digits[point:]
	}
	frac = strings.TrimRight(frac, "0")
	out := intPart
	if frac != "" {
		out += "." + frac
	}
	if neg {
		out = "-" + out
	}
	return out
}

// Idx turns a 1-based table index into a slice index, raising what a table
// expression raises for a missing row.
func Idx(n int, i int32) int {
	if i < 1 || int(i) > n {
		panic(ArithmeticError{"CX_SY_ITAB_LINE_NOT_FOUND", "table expression"})
	}
	return int(i) - 1
}

// InsertAt is INSERT ... INDEX i for a checked 1-based index.
func InsertAt[T any](s []T, i int32, v T) []T {
	var zero T
	s = append(s, zero)
	copy(s[i:], s[i-1:])
	s[i-1] = v
	return s
}

// PowF is ** with calculation type f.
func PowF(a, b float64) float64 {
	if a < 0 && b != math.Trunc(b) {
		panic(ArithmeticError{"CX_SY_ARG_OUT_OF_DOMAIN", "**"})
	}
	if a == 0 && b < 0 {
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", "**"})
	}
	return math.Pow(a, b)
}

// Pad is WIDTH / ALIGN / PAD of a template, as measured on A4H: the text
// already formatted is padded, never cut (-5 in WIDTH 3 PAD '0' is 0-5).
func Pad(v string, width int, align, pad string) string {
	n := utf8.RuneCountInString(v)
	if n >= width {
		return v
	}
	fill := width - n
	switch align {
	case "RIGHT":
		return strings.Repeat(pad, fill) + v
	case "CENTER":
		return strings.Repeat(pad, fill/2) + v + strings.Repeat(pad, fill-fill/2)
	}
	return v + strings.Repeat(pad, fill)
}

// FmtFDec is DECIMALS = n of an f in a template, as measured on A4H: the
// exact binary value rounded half away from zero (2.5 -> 3, 1.005 -> 1.00,
// 0.15 -> 0.1), the sign kept (-0.4 -> -0), no more than seventeen
// significant digits (1E20 has no fraction).
func FmtFDec(v float64, n int) string {
	neg := v < 0 || (v == 0 && math.Signbit(v))
	exact := strconv.FormatFloat(math.Abs(v), 'f', 1100, 64)
	intPart, frac, _ := strings.Cut(exact, ".")
	digits := len(strings.TrimLeft(intPart, "0"))
	if digits > 0 && n > 17-digits {
		n = max(0, 17-digits)
	}
	keep := intPart + frac[:n]
	up := frac[n] >= '5'
	b := []byte(keep)
	if up {
		i := len(b) - 1
		for ; i >= 0; i-- {
			if b[i] == '9' {
				b[i] = '0'
				continue
			}
			b[i]++
			break
		}
		if i < 0 {
			b = append([]byte{'1'}, b...)
		}
	}
	s := string(b)
	ip, fp := s[:len(s)-n], s[len(s)-n:]
	ip = strings.TrimLeft(ip, "0")
	if ip == "" {
		ip = "0"
	}
	out := ip
	if n > 0 {
		out += "." + fp
	}
	if neg {
		out = "-" + out
	}
	return out
}

// NotCompiled is what a method that did not compile raises when called: the
// class exists and its other methods run, this one names why it cannot.
func NotCompiled(method, reason string) ArithmeticError {
	return ArithmeticError{"NOT_COMPILED", method + ": " + reason}
}

// Contains is the unique-key check of a HASHED table keyed on the whole line.
func Contains[T comparable](s []T, v T) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// BitX is BIT-AND / BIT-OR / BIT-XOR of two x fields of one length.
func BitX(op, a, b string) string {
	out := []byte(a)
	for i := range out {
		switch op {
		case "BIT-AND":
			out[i] &= b[i]
		case "BIT-OR":
			out[i] |= b[i]
		default:
			out[i] ^= b[i]
		}
	}
	return string(out)
}

// XToI moves an x of fewer than four bytes into an i: filled with 00 on
// the left, so it reads unsigned (FF is 255, measured on A4H).
func XToI(v string) int32 {
	var r int32
	for i := 0; i < len(v); i++ {
		r = r<<8 | int32(v[i])
	}
	return r
}

func rangeError() { panic(ArithmeticError{"CX_SY_RANGE_OUT_OF_BOUNDS", "offset/length"}) }

// SubS is v+off(len) of a string, counted in characters; len -1 is the
// rest. Out of range raises, as ABAP does.
func SubS(v string, off, length int32) string {
	r := []rune(v)
	n := int32(len(r))
	if off < 0 || off > n {
		rangeError()
	}
	if length < 0 {
		return string(r[off:])
	}
	if off+length > n {
		rangeError()
	}
	return string(r[off : off+length])
}

// SubC is v+off(len) of a c field of length n: read with its trailing
// blanks, stored trimmed again.
func SubC(v string, n, off, length int32) string {
	r := []rune(v)
	for int32(len(r)) < n {
		r = append(r, ' ')
	}
	return strings.TrimRight(SubS(string(r[:n]), off, length), " ")
}

// SubX is v+off(len) of an x or xstring, counted in bytes.
func SubX(v string, off, length int32) string {
	n := int32(len(v))
	if off < 0 || off > n {
		rangeError()
	}
	if length < 0 {
		return v[off:]
	}
	if off+length > n {
		rangeError()
	}
	return v[off : off+length]
}

// XFit moves bytes into an x field of n bytes: cut, or padded right with 00.
func XFit(v string, n int) string {
	if len(v) >= n {
		return v[:n]
	}
	return v + strings.Repeat("\x00", n-len(v))
}

// Uccpi is cl_abap_conv_in_ce=>uccpi: the character of a code point, as a
// c(1) (a blank is stored as the empty c).
func Uccpi(v int32) string { return strings.TrimRight(string(rune(v)), " ") }

// Find is find( val = v sub = x off = n ), measured on A4H 2026-09-23: the
// character offset or -1; an offset equal to the length finds nothing, one
// beyond it raises; an empty sub raises CX_SY_STRG_PAR_VAL; case counts.
func Find(v, sub string, off int32) int32 {
	if sub == "" {
		panic(ArithmeticError{"CX_SY_STRG_PAR_VAL", "find"})
	}
	r := []rune(v)
	if off < 0 || off > int32(len(r)) {
		rangeError()
	}
	i := strings.Index(string(r[off:]), sub)
	if i < 0 {
		return -1
	}
	return off + int32(utf8.RuneCountInString(string(r[off:])[:i]))
}

// CO: every character of a is one of b; true for an empty a.
func CO(a, b string) bool {
	for _, c := range a {
		if !strings.ContainsRune(b, c) {
			return false
		}
	}
	return true
}

// CS: a contains b, ignoring case; an empty b is always found.
func CS(a, b string) bool { return b == "" || strings.Contains(strings.ToUpper(a), strings.ToUpper(b)) }

// IToString is the move of an i into a string, measured on A4H: the digits
// and then the place of the sign, 42 is "42 " and -5 is "5-".
func IToString(v int32) string {
	if v < 0 {
		return strconv.FormatInt(-int64(v), 10) + "-"
	}
	return strconv.FormatInt(int64(v), 10) + " "
}

// Uccp is cl_abap_conv_out_ce=>uccpi: the code point of a character; the
// blank c, stored empty, is 32 (measured on A4H).
func Uccp(v string) int32 {
	for _, r := range v {
		return int32(r)
	}
	return 32
}

// Split is SPLIT v AT sep INTO TABLE, measured on A4H: an empty v gives no
// rows, and one empty piece after a trailing separator is dropped.
func Split(v, sep string) []string {
	if v == "" {
		return []string{}
	}
	// an empty separator does not split (measured: abc is one row)
	if sep == "" {
		return []string{v}
	}
	parts := strings.Split(v, sep)
	if strings.HasSuffix(v, sep) {
		parts = parts[:len(parts)-1]
	}
	return parts
}

// UnescapeURL is cl_http_utility=>unescape_url, which open-abap-core writes as
// the host's decodeURIComponent: %xx sequences decode as UTF-8, a + stays a +,
// and a malformed sequence is an error (a URIError there, a dump here)
func UnescapeURL(s *Session, escaped string, options int32) string {
	_ = options // open-abap-core ignores it too
	out, err := url.PathUnescape(escaped)
	if err != nil {
		// not an ABAP exception class: the transpiler runtime dumps with a URIError
		panic(ArithmeticError{"URI_MALFORMED", "unescape_url: " + err.Error()})
	}
	return out
}

// EncodeXBase64 is cl_http_utility=>encode_x_base64: the bytes of an
// xstring as base64, standard alphabet, padded (A4H 2026-09-24,
// ZCL_GOGEN_T_BYTECAT; ultra/packs).
func EncodeXBase64(s *Session, unencoded string) string {
	return base64.StdEncoding.EncodeToString([]byte(unencoded))
}

// CP is the pattern match, measured on A4H (2026-09-23): * is any run, + any
// one character, # makes the next character literal and case-sensitive;
// everything else compares ignoring case. A c pattern stored empty was all
// blanks and is one blank (” CP ” is false); a string pattern is as written.
func CP(a, p string, cpat bool) bool {
	if cpat && p == "" {
		p = " "
	}
	type tok struct {
		r    rune
		kind byte // 'l' literal ignoring case, 'e' escaped (exact), '*', '+'
	}
	var ps []tok
	pr := []rune(p)
	for i := 0; i < len(pr); i++ {
		switch {
		case pr[i] == '#' && i+1 < len(pr):
			i++
			ps = append(ps, tok{pr[i], 'e'})
		case pr[i] == '*':
			ps = append(ps, tok{0, '*'})
		case pr[i] == '+':
			ps = append(ps, tok{0, '+'})
		default:
			ps = append(ps, tok{pr[i], 'l'})
		}
	}
	ar := []rune(a)
	// classic wildcard matching with backtracking over the last *
	i, j, star, mark := 0, 0, -1, 0
	eq := func(t tok, c rune) bool {
		switch t.kind {
		case '+':
			return true
		case 'e':
			return t.r == c
		default:
			return strings.EqualFold(string(t.r), string(c))
		}
	}
	for i < len(ar) {
		if j < len(ps) && ps[j].kind != '*' && eq(ps[j], ar[i]) {
			i++
			j++
		} else if j < len(ps) && ps[j].kind == '*' {
			star, mark = j, i
			j++
		} else if star >= 0 {
			j = star + 1
			mark++
			i = mark
		} else {
			return false
		}
	}
	for j < len(ps) && ps[j].kind == '*' {
		j++
	}
	return j == len(ps)
}

// CA: a contains any character of b, case-sensitive (A4H); an empty operand
// on either side is false.
func CA(a, b string) bool { return b != "" && strings.ContainsAny(a, b) }
