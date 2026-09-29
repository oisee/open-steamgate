package abap

import (
	"math"
	"math/big"
	"strconv"
	"strings"
)

// Packed numbers (p LENGTH n DECIMALS d), measured on A4H 2026-09-24
// (ZCL_GOGEN_T_PDCONV, _PDCALC, _PDFMT, _PDPREC, _PDCMP in semantics.mjs).
//
// Representation: a p value is its decimal text, "-" in front when negative.
// A typed field of d decimals holds exactly d of them ("1.50", "0.00",
// "-0.05"): that is what a string template prints, so a template of a p
// field is the value itself. An intermediate result of calculation type p
// is exact and carries as many decimals as it has ("2.5", "0.3125"); it is
// rounded only when it lands in a field. Every function here reads "" as 0
// (a structure field Go left at its zero value) and tolerates either form.
//
// The rules, each measured:
//   - + - * are exact. An intermediate result may grow to 63 integer
//     digits; the 64th is CX_SY_ARITHMETIC_OVERFLOW ((10^31-1)^2 * 10 / ...
//     passes, * 100 does not).
//   - / rounds its quotient half away from zero to 31 significant digits
//     (2 * 10^28 / 3 - 6666666666666666666666666666 is 0.667; 1e-14 cubed
//     and divided back is exact, so there is no fixed number of decimals).
//   - DIV and MOD as for i: 0 <= a MOD b < |b|, a = b * (a DIV b) + a MOD b.
//     A zero divisor raises CX_SY_ZERODIVIDE; 0 / 0 is 0.
//   - A value lands in a field rounded half away from zero to its decimals
//     (1.5625 -> 1.56, 2.5 -> 3, -2.5 -> -3). One that does not fit the
//     field's 2n-1 digits raises CX_SY_ARITHMETIC_OVERFLOW when it is the
//     result of an arithmetic expression and CX_SY_CONVERSION_OVERFLOW when
//     it is a plain move.

type pdec struct {
	v *big.Int // the digits
	s int      // the decimals: value = v / 10^s
}

var (
	bigTen = big.NewInt(10)
	pZero  = pdec{v: new(big.Int)}
)

func pow10(n int) *big.Int { return new(big.Int).Exp(bigTen, big.NewInt(int64(n)), nil) }

// pParse reads a p value in either form; "" is 0.
func pParse(a string) pdec {
	if a == "" {
		return pZero
	}
	neg := a[0] == '-'
	if neg {
		a = a[1:]
	}
	ip, fp, _ := strings.Cut(a, ".")
	v, ok := new(big.Int).SetString(ip+fp, 10)
	if !ok {
		panic(NotCompiled("packed number", "the value "+strconv.Quote(a)+" is not a packed number"))
	}
	if neg {
		v.Neg(v)
	}
	return pdec{v: v, s: len(fp)}
}

// pText is an exact value as text, trailing zeros of the fraction dropped
func pText(d pdec) string {
	if d.s <= 0 {
		return new(big.Int).Mul(d.v, pow10(-d.s)).String()
	}
	t := new(big.Int).Abs(d.v).String()
	if len(t) <= d.s {
		t = strings.Repeat("0", d.s-len(t)+1) + t
	}
	ip, fp := t[:len(t)-d.s], strings.TrimRight(t[len(t)-d.s:], "0")
	out := ip
	if fp != "" {
		out += "." + fp
	}
	if d.v.Sign() < 0 && out != "0" {
		out = "-" + out
	}
	return out
}

// pFixed is a value already rounded to dec decimals, written with exactly dec
func pFixed(d pdec, dec int) string {
	d = pScale(d, dec)
	t := new(big.Int).Abs(d.v).String()
	if dec > 0 {
		if len(t) <= dec {
			t = strings.Repeat("0", dec-len(t)+1) + t
		}
		t = t[:len(t)-dec] + "." + t[len(t)-dec:]
	}
	if d.v.Sign() < 0 {
		t = "-" + t
	}
	return t
}

// pScale writes d with dec decimals, rounding half away from zero when it
// has more
func pScale(d pdec, dec int) pdec {
	switch {
	case d.s == dec:
		return d
	case d.s < dec:
		return pdec{v: new(big.Int).Mul(d.v, pow10(dec-d.s)), s: dec}
	}
	return pdec{v: roundDiv(d.v, pow10(d.s-dec)), s: dec}
}

// roundDiv is n / m rounded half away from zero (m > 0)
func roundDiv(n, m *big.Int) *big.Int {
	q, r := new(big.Int).QuoRem(n, m, new(big.Int))
	if new(big.Int).Mul(new(big.Int).Abs(r), big.NewInt(2)).Cmp(m) >= 0 {
		if n.Sign() < 0 {
			q.Sub(q, big.NewInt(1))
		} else {
			q.Add(q, big.NewInt(1))
		}
	}
	return q
}

// intDigits counts the digits before the point of |d|
func intDigits(d pdec) int {
	ip := new(big.Int).Abs(d.v)
	if d.s > 0 {
		ip.Quo(ip, pow10(d.s))
	} else if d.s < 0 {
		ip.Mul(ip, pow10(-d.s))
	}
	if ip.Sign() == 0 {
		return 0
	}
	return len(ip.String())
}

// pCalc checks an intermediate result against the 63 digits calculation
// type p has before the point
func pCalc(d pdec, op string) string {
	if intDigits(d) > 63 {
		overflow(op)
	}
	return pText(d)
}

func pAlign(a, b pdec) (pdec, pdec) {
	if a.s < b.s {
		a = pScale(a, b.s)
	} else if b.s < a.s {
		b = pScale(b, a.s)
	}
	return a, b
}

func AddP(a, b string) string {
	x, y := pAlign(pParse(a), pParse(b))
	return pCalc(pdec{v: new(big.Int).Add(x.v, y.v), s: x.s}, "+")
}

func SubP(a, b string) string {
	x, y := pAlign(pParse(a), pParse(b))
	return pCalc(pdec{v: new(big.Int).Sub(x.v, y.v), s: x.s}, "-")
}

func MulP(a, b string) string {
	x, y := pParse(a), pParse(b)
	return pCalc(pdec{v: new(big.Int).Mul(x.v, y.v), s: x.s + y.s}, "*")
}

func NegP(a string) string {
	x := pParse(a)
	return pText(pdec{v: new(big.Int).Neg(x.v), s: x.s})
}

// DivP is / in calculation type p: 31 significant digits, rounded
func DivP(a, b string) string {
	x, y := pParse(a), pParse(b)
	if y.v.Sign() == 0 {
		if x.v.Sign() == 0 {
			return "0"
		}
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
	}
	if x.v.Sign() == 0 {
		return "0"
	}
	// x / y = (xv * 10^ys) / (yv * 10^xs)
	n := new(big.Int).Mul(x.v, pow10(y.s))
	m := new(big.Int).Mul(y.v, pow10(x.s))
	if m.Sign() < 0 {
		n.Neg(n)
		m.Neg(m)
	}
	// the first significant digit of |n / m| sits at 10^e
	an := new(big.Int).Abs(n)
	e := len(an.String()) - len(m.String())
	lhs, rhs := an, new(big.Int).Mul(m, pow10(max(e, 0)))
	if e < 0 {
		lhs, rhs = new(big.Int).Mul(an, pow10(-e)), m
	}
	if lhs.Cmp(rhs) < 0 {
		e--
	}
	scale := 30 - e // digits after the point that keep 31 significant ones
	var q *big.Int
	if scale >= 0 {
		q = roundDiv(new(big.Int).Mul(n, pow10(scale)), m)
	} else {
		q = roundDiv(n, new(big.Int).Mul(m, pow10(-scale)))
	}
	return pCalc(pdec{v: q, s: scale}, "/")
}

// pDivMod is DIV and MOD of calculation type p
func pDivMod(a, b, op string) (pdec, pdec) {
	x, y := pAlign(pParse(a), pParse(b))
	if y.v.Sign() == 0 {
		if x.v.Sign() == 0 {
			return pZero, pZero
		}
		panic(ArithmeticError{"CX_SY_ZERODIVIDE", op})
	}
	ay := new(big.Int).Abs(y.v)
	r := new(big.Int).Mod(x.v, ay) // Euclidean: 0 <= r < |y|
	q := new(big.Int).Sub(x.v, r)
	q.Quo(q, y.v)
	return pdec{v: q}, pdec{v: r, s: x.s}
}

func DivIntP(a, b string) string {
	q, _ := pDivMod(a, b, "DIV")
	return pCalc(q, "DIV")
}

func ModP(a, b string) string {
	_, r := pDivMod(a, b, "MOD")
	return pCalc(r, "MOD")
}

// CmpP compares two packed values: -1, 0 or 1.
func CmpP(a, b string) int {
	x, y := pAlign(pParse(a), pParse(b))
	return x.v.Cmp(y.v)
}

// IToP is an integer as a packed value (i and int8 both reach it widened).
func IToP[T int32 | int64](i T) string { return strconv.FormatInt(int64(i), 10) }

// PFit moves a packed value into a p of length n with dec decimals: rounded
// half away from zero, and a value whose digits do not fit raises
// CX_SY_ARITHMETIC_OVERFLOW after an arithmetic expression and
// CX_SY_CONVERSION_OVERFLOW after a plain move (A4H, PDCALC ov / PDCONV).
func PFit(a string, n, dec int, arith bool) string {
	d := pScale(pParse(a), dec)
	if intDigits(d) > 2*n-1-dec {
		if arith {
			overflow("=")
		}
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "p"})
	}
	return pFixed(d, dec)
}

// CToP converts characters to a packed value (exact), as measured on A4H
// (PDCONV c: and s:): blanks around it, a sign in front ("- 1" too, blanks
// after the sign) or behind ("12.5-"), one point with digits on either side
// or both ('.5', '5.'), blanks only is 0. An exponent, a comma, a blank
// inside the digits or anything else raises CX_SY_CONVERSION_NO_NUMBER.
func CToP(v string) string {
	t := strings.Trim(v, " ")
	if t == "" {
		return "0"
	}
	neg := false
	switch {
	case strings.HasSuffix(t, "-"):
		neg, t = true, strings.TrimRight(t[:len(t)-1], " ")
	case strings.HasPrefix(t, "-"):
		neg, t = true, strings.TrimLeft(t[1:], " ")
	case strings.HasPrefix(t, "+"):
		t = strings.TrimLeft(t[1:], " ")
	}
	ip, fp, _ := strings.Cut(t, ".")
	if ip+fp == "" || strings.Trim(ip, "0123456789") != "" || strings.Trim(fp, "0123456789") != "" {
		panic(ArithmeticError{"CX_SY_CONVERSION_NO_NUMBER", "c->p"})
	}
	x := pParse(ip + "." + fp)
	if neg {
		x.v.Neg(x.v)
	}
	return pText(x)
}

// FToP is an f as a packed value: its seventeen significant digits, which
// the move then rounds to the field (A4H: 2.345 -> 2.35 and 2.355 -> 2.36,
// but 2.675 -> 2.67 and 1.005 -> 1.00, which is what 2.6749999999999998
// and 1.0049999999999999 round to).
func FToP(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "f->p"})
	}
	return pText(pParseExp(strconv.FormatFloat(f, 'e', 16, 64)))
}

// pParseExp reads a decimal with an optional exponent (1.5e-05), exactly
func pParseExp(t string) pdec {
	mant, exp, found := strings.Cut(strings.ToLower(t), "e")
	d := pParse(mant)
	if found {
		x, err := strconv.Atoi(exp)
		if err != nil {
			panic(NotCompiled("packed number", "the value "+strconv.Quote(t)+" is not a number"))
		}
		d.s -= x
	}
	if d.s < 0 {
		d = pdec{v: new(big.Int).Mul(d.v, pow10(-d.s))}
	}
	return d
}

// PToI rounds a packed value half away from zero into an i; out of range is
// CX_SY_ARITHMETIC_OVERFLOW after arithmetic, CX_SY_CONVERSION_OVERFLOW
// after a move (A4H: 3000000000 into i both ways).
func PToI(a string, arith bool) int32 {
	v := pScale(pParse(a), 0).v
	if !v.IsInt64() || v.Int64() > math.MaxInt32 || v.Int64() < math.MinInt32 {
		if arith {
			overflow("=")
		}
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "p->i"})
	}
	return int32(v.Int64())
}

func PToI8(a string, arith bool) int64 {
	v := pScale(pParse(a), 0).v
	if !v.IsInt64() {
		if arith {
			overflow("=")
		}
		panic(ArithmeticError{"CX_SY_CONVERSION_OVERFLOW", "p->int8"})
	}
	return v.Int64()
}

// PToF is the nearest f (0.10 -> 0.1, whose template is 0.10000000000000001)
func PToF(a string) float64 {
	f, _ := strconv.ParseFloat(pText(pParse(a)), 64)
	return f
}

// PToString is a p moved into a string: its dec decimals and then a place
// for the sign, "1.50 " and "1.50-" (A4H, as i -> string)
func PToString(a string, dec int) string {
	d := pScale(pParse(a), dec)
	if d.v.Sign() < 0 {
		return pFixed(pdec{v: new(big.Int).Neg(d.v), s: d.s}, dec) + "-"
	}
	return pFixed(d, dec) + " "
}

// PToC is a p moved into c LENGTH n (A4H, PDCONV pc and PDPREC c): right
// aligned with the sign place behind it ("   1.50 ", "   1.50-"); a
// positive value that fits only without the sign place drops it ("1.50" in
// c(4)); a value that does not fit keeps its last digits behind a "*"
// ("*67" for 12345.67 in c(3), "*50-" for -1.50 in c(4)). A c value is held
// without its trailing blanks.
func PToC(a string, dec, n int) string {
	d := pScale(pParse(a), dec)
	neg := d.v.Sign() < 0
	t := pFixed(pdec{v: new(big.Int).Abs(d.v), s: d.s}, dec)
	sign := " "
	if neg {
		sign = "-"
	}
	var out string
	switch {
	case len(t)+1 <= n:
		out = strings.Repeat(" ", n-len(t)-1) + t + sign
	case !neg && len(t) == n:
		out = t
	default:
		keep := n - 1
		if neg {
			keep--
		}
		if keep < 0 {
			keep = 0
		}
		out = "*" + t[len(t)-keep:]
		if neg {
			out += "-"
		}
		if len(out) > n {
			out = out[:n]
		}
	}
	return strings.TrimRight(out, " ")
}

// PToN is a p moved into n LENGTH k: rounded to an integer, the sign
// dropped, the last k digits kept (A4H: 12.50 -> 0013, -12.5 -> 0013,
// 12345.6 -> 2346 in n(4), no overflow)
func PToN(a string, k int) string {
	t := new(big.Int).Abs(pScale(pParse(a), 0).v).String()
	if len(t) > k {
		return t[len(t)-k:]
	}
	return strings.Repeat("0", k-len(t)) + t
}

// FmtP is a p field in a string template: its dec decimals, a leading minus
func FmtP(a string, dec int) string { return pFixed(pScale(pParse(a), dec), dec) }

// FmtPDec is DECIMALS = n of a p in a string template: rounded half away
// from zero or padded with zeros (A4H: 1.25 -> 1.3, 1.250, 1; 2.50 -> 3)
func FmtPDec(a string, n int) string { return pFixed(pScale(pParse(a), n), n) }

// abs( ), sign( ), ceil( ), floor( ), trunc( ), frac( ) of a p (A4H PDFMT fn)
func AbsP(a string) string {
	x := pParse(a)
	return pText(pdec{v: new(big.Int).Abs(x.v), s: x.s})
}

func SignP(a string) int32 { return int32(pParse(a).v.Sign()) }

func pInteger(a string, mode int) string {
	x := pParse(a)
	if x.s <= 0 {
		return pText(x)
	}
	q, r := new(big.Int).QuoRem(x.v, pow10(x.s), new(big.Int))
	if r.Sign() != 0 {
		if mode > 0 && x.v.Sign() > 0 {
			q.Add(q, big.NewInt(1))
		}
		if mode < 0 && x.v.Sign() < 0 {
			q.Sub(q, big.NewInt(1))
		}
	}
	return q.String()
}

func CeilP(a string) string  { return pInteger(a, 1) }
func FloorP(a string) string { return pInteger(a, -1) }
func TruncP(a string) string { return pInteger(a, 0) }
func FracP(a string) string  { return SubP(a, TruncP(a)) }

// DBP reads a DEC column into p LENGTH n DECIMALS dec. The SQLite store
// keeps a DEC column with NUMERIC affinity, so the driver hands over an
// integer, a REAL (as Go formats it, 12.5 or 1e-05) or the text: each is
// read exactly and rounded to the field. A REAL has 15 to 17 significant
// digits, so a DEC column of more digits than a double carries is not
// exact here (HANA's DECIMAL is).
func DBP(v DBString, n, dec int) string {
	if !v.Valid || strings.TrimSpace(v.String) == "" {
		return pFixed(pZero, dec)
	}
	return PFit(pText(pParseExp(strings.TrimSpace(v.String))), n, dec, false)
}
