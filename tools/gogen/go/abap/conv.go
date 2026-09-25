package abap

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"math"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
	"unicode/utf8"
	"unsafe"
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

// S2D and S2T are a string moved into a d or a t (A4H ZCL_GOGEN_T_GENMOVD):
// the first eight (six) characters, an empty string the initial value, and
// a t shorter than six filled with zeros on the right ('abc' is abc000).
func S2D(v string) string {
	if v == "" {
		return "00000000"
	}
	return CFit(v, 8)
}

func S2T(v string) string {
	if v == "" {
		return "000000"
	}
	r := []rune(v)
	if len(r) > 6 {
		r = r[:6]
	}
	return string(r) + strings.Repeat("0", 6-len(r))
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

// ParseF converts a character value to f, as A4H does (parity-wave2,
// ZCL_GOGEN_T_C2NUM): leading blanks skipped, the first word read and the
// rest of the text ignored ('12 abc' is 12, '12 -' is 12); in that word a
// leading + or -, or a trailing -, digits with at most one point (at least
// one digit) and an exponent E or e with an optional sign and digits.
// Blanks are 0. A value past f's range raises CX_SY_CONVERSION_OVERFLOW, as
// do the words nan, inf and Infinity; a value below it is 0. Anything else
// is CX_SY_CONVERSION_NO_NUMBER. Other spellings of nan / inf are not
// measured and dump as not compiled.
func ParseF(v string) float64 {
	t := strings.TrimLeft(v, " ")
	if t == "" {
		return 0
	}
	if i := strings.IndexByte(t, ' '); i >= 0 {
		t = t[:i]
	}
	switch t {
	case "nan", "inf", "Infinity":
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "c->f"})
	}
	for _, w := range []string{"nan", "inf", "infinity"} {
		if strings.Contains(strings.ToLower(t), w) {
			panic(NotCompiled("move to f", "a text naming "+w+" in a spelling not measured: "+t))
		}
	}
	neg, body, ok := numSign(t)
	if !ok {
		panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->f"})
	}
	mant, exp := body, ""
	if i := strings.IndexAny(body, "Ee"); i >= 0 {
		mant, exp = body[:i], body[i+1:]
		if exp != "" && (exp[0] == '+' || exp[0] == '-') {
			exp = exp[1:]
		}
		if exp == "" || !allDigits(exp) {
			panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->f"})
		}
	}
	if !decimalDigits(mant) {
		panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->f"})
	}
	f, err := strconv.ParseFloat(body, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->f"})
	}
	if math.IsInf(f, 0) {
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "c->f"})
	}
	if neg {
		f = -f
	}
	return f
}

// numSign takes the sign off a number's text: a leading + or -, or a
// trailing -, never two (A4H: '+-1' and '-1-' are no number); blanks
// between the sign and the digits stay for the caller to judge
func numSign(t string) (neg bool, body string, ok bool) {
	signs := 0
	if t != "" && (t[0] == '+' || t[0] == '-') {
		signs++
		neg = t[0] == '-'
		t = t[1:]
	}
	if t != "" && t[len(t)-1] == '-' {
		signs++
		neg = true
		t = t[:len(t)-1]
	}
	return neg, t, signs <= 1
}

func allDigits(t string) bool {
	for i := 0; i < len(t); i++ {
		if t[i] < '0' || t[i] > '9' {
			return false
		}
	}
	return true
}

// decimalDigits: digits with at most one point, at least one digit ('.5'
// and '5.' are numbers, '.' is not)
func decimalDigits(t string) bool {
	i := strings.IndexByte(t, '.')
	if i < 0 {
		return t != "" && allDigits(t)
	}
	return len(t) > 1 && allDigits(t[:i]) && allDigits(t[i+1:])
}

// ParseI converts a character value to i, as A4H does (parity-wave2,
// ZCL_GOGEN_T_C2NUM): blanks around it, one sign -- a leading + or -, or a
// trailing -, a blank between it and the digits allowed ('- 12' and '12 -'
// are -12) -- and digits with at most one point; no exponent, nothing after
// a blank. The fraction rounds half away from zero; past i's range is
// CX_SY_CONVERSION_OVERFLOW, anything else CX_SY_CONVERSION_NO_NUMBER.
// Blanks are 0.
func ParseI(v string) int32 {
	t := strings.Trim(v, " ")
	if t == "" {
		return 0
	}
	neg, body, ok := numSign(t)
	body = strings.Trim(body, " ")
	if !ok || !decimalDigits(body) {
		panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->i"})
	}
	whole, frac := body, ""
	if i := strings.IndexByte(body, '.'); i >= 0 {
		whole, frac = body[:i], body[i+1:]
	}
	whole = strings.TrimLeft(whole, "0")
	if len(whole) > 10 {
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "c->i"})
	}
	var n int64
	for i := 0; i < len(whole); i++ {
		n = n*10 + int64(whole[i]-'0')
	}
	if frac != "" && frac[0] >= '5' {
		n++
	}
	if neg {
		n = -n
	}
	if n > math.MaxInt32 || n < math.MinInt32 {
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "c->i"})
	}
	return int32(n)
}

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

// BitXS is BIT-XOR of two xstrings (A4H 2026-09-24, ZCL_GOGEN_T_XCONV): the
// shorter padded with 00 on the right, the result as long as the longer.
func BitXS(op, a, b string) string {
	n := max(len(a), len(b))
	return BitX(op, XFit(a, n), XFit(b, n))
}

// XToI reads an x or xstring as an i: the last four bytes, 00 on the left,
// a signed int32 (A4H 2026-09-24, ZCL_GOGEN_T_XCMPN: FF 255, FFFFFFFF -1,
// 0100000002 2, empty 0; a move the same, ZCL_GOGEN_T_XMOVI); the shift
// drops the bytes before the last four.
func XToI(v string) int32 {
	var r int32
	for i := 0; i < len(v); i++ {
		r = r<<8 | int32(v[i])
	}
	return r
}

// A character offset into a string is a byte offset only when every
// character is one byte. For a long string asked about again (a parser
// calling find( off = ... ) and substring( ) on one document over and over)
// the answer is kept: whether it is ASCII, and else its length in
// characters and the byte offset of every 64th character, so that an offset
// costs at most 63 steps. The memo keeps the pointer it was given, so the
// memory it names cannot be reused for another string meanwhile. Without it
// each call converted the whole string to runes, and a 750 KB import took
// minutes instead of milliseconds (parity-wave1, ZCL_STG_JSON=>READ_STRING
// and ZCL_STG_SEGW_IMPORT=>PARSE).
type strMemo struct {
	p     *byte
	n     int
	ascii bool
	runes int
	idx   []int
}

var lastStr atomic.Pointer[strMemo]

func memoOf(v string) *strMemo {
	if len(v) < 256 {
		return nil
	}
	p := unsafe.StringData(v)
	if m := lastStr.Load(); m != nil && m.p == p && m.n == len(v) {
		return m
	}
	m := &strMemo{p: p, n: len(v), ascii: true}
	for i := 0; i < len(v); i++ {
		if v[i] >= 0x80 {
			m.ascii = false
			break
		}
	}
	if !m.ascii {
		k := 0
		for i := range v {
			if k%64 == 0 {
				m.idx = append(m.idx, i)
			}
			k++
		}
		m.runes = k
	}
	lastStr.Store(m)
	return m
}

func isASCII(v string) bool {
	if m := memoOf(v); m != nil {
		return m.ascii
	}
	for i := 0; i < len(v); i++ {
		if v[i] >= 0x80 {
			return false
		}
	}
	return true
}

// byteAt is the byte offset of character k of a non-ASCII memoised string
// (k up to its length)
func (m *strMemo) byteAt(v string, k int) int {
	if k >= m.runes {
		return len(v)
	}
	b := m.idx[k/64]
	for j := k % 64; j > 0; j-- {
		_, w := utf8.DecodeRuneInString(v[b:])
		b += w
	}
	return b
}

func rangeError() { panic(ArithmeticError{"CX_SY_RANGE_OUT_OF_BOUNDS", "offset/length"}) }

// SubS is v+off(len) of a string, counted in characters; len -1 is the
// rest. Out of range raises, as ABAP does.
func SubS(v string, off, length int32) string {
	if isASCII(v) {
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
	if m := memoOf(v); m != nil {
		if off < 0 || int(off) > m.runes {
			rangeError()
		}
		b := m.byteAt(v, int(off))
		if length < 0 {
			return v[b:]
		}
		if int(off+length) > m.runes {
			rangeError()
		}
		e := b
		for j := int32(0); j < length; j++ {
			_, w := utf8.DecodeRuneInString(v[e:])
			e += w
		}
		return v[b:e]
	}
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

// CToX is a character value moved into an x or an xstring (A4H 2026-09-24,
// ZCL_GOGEN_T_XCONV; UPDATE SET raw = string the same, ZCL_GOGEN_T_RAWSTR):
// the bytes of the longest prefix of upper-case hex digits -- a lower-case
// letter, a blank or any other character ends it -- an odd count padded
// with 0. `ab` is empty, `ABG1` is AB, `ABC` is ABC0, ` AB` is empty.
func CToX(v string) string {
	n := 0
	for n < len(v) && (v[n] >= '0' && v[n] <= '9' || v[n] >= 'A' && v[n] <= 'F') {
		n++
	}
	h := v[:n]
	if n%2 == 1 {
		h += "0"
	}
	b, _ := hex.DecodeString(h)
	return string(b)
}

// XFit moves bytes into an x field of n bytes: cut, or padded right with 00.
func XFit(v string, n int) string {
	if len(v) >= n {
		return v[:n]
	}
	return v + strings.Repeat("\x00", n-len(v))
}

// CatBytesX is CONCATENATE ... INTO x IN BYTE MODE for an x of n bytes (A4H
// 2026-09-24, ZCL_GOGEN_T_BYTECATX): the bytes padded with 00 and sy-subrc
// 0, or cut to n and sy-subrc 4
func CatBytesX(n int, joined string) (string, int32) {
	if len(joined) > n {
		return joined[:n], 4
	}
	return XFit(joined, n), 0
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
	if isASCII(v) {
		if off < 0 || off > int32(len(v)) {
			rangeError()
		}
		i := strings.Index(v[off:], sub)
		if i < 0 {
			return -1
		}
		return off + int32(i)
	}
	if m := memoOf(v); m != nil {
		if off < 0 || int(off) > m.runes {
			rangeError()
		}
		b := m.byteAt(v, int(off))
		i := strings.Index(v[b:], sub)
		if i < 0 {
			return -1
		}
		return off + int32(utf8.RuneCountInString(v[b:b+i]))
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

// nFit is k places of digits: right-aligned, zeros in front, the last k
// kept
func nFit(d string, k int) string {
	if len(d) > k {
		return d[len(d)-k:]
	}
	return strings.Repeat("0", k-len(d)) + d
}

// IToN is an i moved into n LENGTH k: the sign dropped, the last k digits
// kept (A4H 2026-09-24, ZCL_GOGEN_T_NUMC: 42 -> 0000000042, -5 -> 005,
// 123456 -> 456 in n 3)
func IToN(v int32, k int) string { return nFit(strconv.FormatInt(AbsI64(int64(v)), 10), k) }

// CToN is a c or string moved into n LENGTH k: its digits only, right-
// aligned, the last k kept (A4H: ' 12' -> 0000000012, 'a1b2 3' -> 123 and
// '98765' -> 765 in n 3, a blank c -> 000)
func CToN(s string, k int) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return nFit(b.String(), k)
}

// AbsI64 is |v| for an int64 that is not the minimum
func AbsI64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

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
// ZCL_GOGEN_T_B64; ultra/packs).
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
	ps := cpTokens(p)
	// the subject as characters: its bytes when it is ASCII (no copy, the
	// common case: a tag, a name), else its runes
	var ar []rune
	ascii := true
	for i := 0; i < len(a); i++ {
		if a[i] >= utf8.RuneSelf {
			ascii = false
			break
		}
	}
	n := len(a)
	if !ascii {
		ar = []rune(a)
		n = len(ar)
	}
	at := func(i int) rune {
		if ascii {
			return rune(a[i])
		}
		return ar[i]
	}
	eq := func(t cpTok, c rune) bool {
		switch t.kind {
		case '+':
			return true
		case 'e':
			return t.r == c
		default:
			return foldEq(t.r, c)
		}
	}
	// classic wildcard matching with backtracking over the last *
	i, j, star, mark := 0, 0, -1, 0
	for i < n {
		if j < len(ps) && ps[j].kind != '*' && eq(ps[j], at(i)) {
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

type cpTok struct {
	r    rune
	kind byte // 'l' literal ignoring case, 'e' escaped (exact), '*', '+'
}

// the tokens of a CP pattern, kept per pattern text (most are constants of
// the program; at most cpCacheMax are kept, the rest made each time)
var (
	cpCache    sync.Map
	cpCacheLen atomic.Int32
)

const cpCacheMax = 4096

func cpTokens(p string) []cpTok {
	if v, ok := cpCache.Load(p); ok {
		return v.([]cpTok)
	}
	var ps []cpTok
	pr := []rune(p)
	for i := 0; i < len(pr); i++ {
		switch {
		case pr[i] == '#' && i+1 < len(pr):
			i++
			ps = append(ps, cpTok{pr[i], 'e'})
		case pr[i] == '*':
			ps = append(ps, cpTok{0, '*'})
		case pr[i] == '+':
			ps = append(ps, cpTok{0, '+'})
		default:
			ps = append(ps, cpTok{pr[i], 'l'})
		}
	}
	if cpCacheLen.Load() < cpCacheMax {
		if _, loaded := cpCache.LoadOrStore(p, ps); !loaded {
			cpCacheLen.Add(1)
		}
	}
	return ps
}

// foldEq is strings.EqualFold of two single characters, without making
// two strings per comparison (CP ran it for every character it tried)
func foldEq(a, b rune) bool {
	if a == b {
		return true
	}
	if a < utf8.RuneSelf && b < utf8.RuneSelf {
		if 'A' <= a && a <= 'Z' {
			a += 'a' - 'A'
		}
		if 'A' <= b && b <= 'Z' {
			b += 'a' - 'A'
		}
		return a == b
	}
	for r := unicode.SimpleFold(a); r != a; r = unicode.SimpleFold(r) {
		if r == b {
			return true
		}
	}
	return false
}

// CA: a contains any character of b, case-sensitive (A4H); an empty operand
// on either side is false.
func CA(a, b string) bool { return b != "" && strings.ContainsAny(a, b) }
