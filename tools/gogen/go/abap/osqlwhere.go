package abap

import (
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// A dynamic Open SQL condition (SELECT ... WHERE (lv_where)) as an IR
// predicate: a port of osqlWherePredicate() of tools/ir-osql-where.mjs
// (open-steamgate #47, fe65935), the one place its meaning is written, measured on
// A4H over SFLIGHT (docs/osql-where.md there). The string an ABAP program
// builds at run time is parsed against the columns of the table it reads;
// every text or decimal value is bound, every integer checked to its range
// and inlined, and the tree is ordinary IR, lowered by irsql.go.
//
// Checked against test/fixtures/ir-pairs/osql-where.json in all four
// dialects (osqlwhere_test.go): the same SQL and parameters, or the same
// outcome. The outcomes that are not a predicate:
//   OsqlWhereSyntax     CX_SY_DYNAMIC_OSQL_SYNTAX on A4H (catchable)
//   OsqlWhereSemantics  CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H (catchable)
//   OsqlWhereDump       an uncatchable runtime error on A4H
//   OsqlWhereRefused    a form not measured, refused by a reason from
//                       OsqlWhereReasons, never with a class A4H was not
//                       seen to raise

// OsqlWhereReasons is the closed list of refusal reasons (REASONS).
var OsqlWhereReasons = []string{
	"host variable", "column to column", "qualified name", "number into char",
	"number format", "numc", "column type", "like type", "malformed", "too deep",
	"non-BMP",
}

// OsqlWhereRefused is a condition the parser does not carry.
type OsqlWhereRefused struct{ Reason, Message string }

func (e OsqlWhereRefused) Error() string { return e.Message }

// OsqlWhereSyntax is CX_SY_DYNAMIC_OSQL_SYNTAX, raised only where A4H did.
type OsqlWhereSyntax struct{ Message string }

func (e OsqlWhereSyntax) Error() string { return e.Message }

// Abap is the class A4H raised.
func (OsqlWhereSyntax) Abap() string { return "CX_SY_DYNAMIC_OSQL_SYNTAX" }

// OsqlWhereSemantics is CX_SY_DYNAMIC_OSQL_SEMANTICS, raised only where A4H did.
type OsqlWhereSemantics struct{ Message string }

func (e OsqlWhereSemantics) Error() string { return e.Message }

// Abap is the class A4H raised.
func (OsqlWhereSemantics) Abap() string { return "CX_SY_DYNAMIC_OSQL_SEMANTICS" }

// OsqlWhereDump is an uncatchable runtime error on A4H.
type OsqlWhereDump struct{ Message string }

func (e OsqlWhereDump) Error() string { return e.Message }

// the limits of MAX_DEPTH and MAX_TERMS: a port whose stack grows must
// refuse where the JavaScript one runs out of it
const (
	OsqlMaxDepth = 256
	OsqlMaxTerms = 2000
)

func refuseWhere(reason, format string, a ...any) {
	ok := false
	for _, r := range OsqlWhereReasons {
		if r == reason {
			ok = true
		}
	}
	if !ok {
		panic(fmt.Sprintf("OsqlWhereRefused: %s is not in OsqlWhereReasons", reason))
	}
	panic(OsqlWhereRefused{reason, fmt.Sprintf(format, a...)})
}

// blank is what separates tokens: space, tab, CR and LF, nothing else (a
// no-break space is not one; RE2's \s and unicode.IsSpace would differ)
func blank(r rune) bool { return r == ' ' || r == '\t' || r == '\n' || r == '\r' }

var osqlCompare = map[string]string{"=": "=", "<>": "<>", "<": "<", ">": ">", "<=": "<=", ">=": ">=",
	"EQ": "=", "NE": "<>", "LT": "<", "GT": ">", "LE": "<=", "GE": ">="}

var osqlKeywords = map[string]bool{"AND": true, "OR": true, "NOT": true, "BETWEEN": true, "LIKE": true, "ESCAPE": true,
	"IN": true, "IS": true, "NULL": true, "INITIAL": true, "EQ": true, "NE": true, "LT": true, "GT": true, "LE": true, "GE": true}

type osqlToken struct {
	kind  string // name text string number op ( ) ,
	value string
	at    int
}

var (
	osqlNumber = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?`)
	osqlName   = regexp.MustCompile(`^[A-Za-z_/][A-Za-z0-9_/~]*`)
)

func osqlTokens(text []rune) []osqlToken {
	var out []osqlToken
	i := 0
	literal := func(quote rune, kind string) {
		var b strings.Builder
		j := i + 1
		for {
			if j >= len(text) {
				refuseWhere("malformed", "an unterminated literal at %d", i)
			}
			if text[j] == quote {
				if j+1 < len(text) && text[j+1] == quote {
					b.WriteRune(quote)
					j += 2
					continue
				}
				break
			}
			b.WriteRune(text[j])
			j++
		}
		out = append(out, osqlToken{kind, b.String(), i})
		i = j + 1
	}
	for i < len(text) {
		ch := text[i]
		if blank(ch) {
			i++
			continue
		}
		if ch == '\'' {
			literal('\'', "text")
			continue
		}
		// a backtick literal is a STRING (measured: carrid = `AA` finds AA)
		if ch == '`' {
			literal('`', "string")
			continue
		}
		if ch == '(' || ch == ')' || ch == ',' {
			out = append(out, osqlToken{string(ch), string(ch), i})
			i++
			continue
		}
		rest := string(text[i:])
		op := ""
		for _, o := range []string{"<>", "<=", ">=", "=", "<", ">"} {
			if strings.HasPrefix(rest, o) {
				op = o
				break
			}
		}
		if op != "" {
			// measured: `carrid='AA'` is CX_SY_DYNAMIC_OSQL_SYNTAX; an operator
			// stands between blanks
			before := i == 0 || blank(text[i-1])
			after := i+len(op) >= len(text) || blank(text[i+len(op)])
			if !before && !after {
				panic(OsqlWhereSyntax{fmt.Sprintf("the operator %s at %d is not between blanks", op, i)})
			}
			// a blank on one side only was not measured
			if !before || !after {
				refuseWhere("malformed", "the operator %s at %d has a blank on one side only", op, i)
			}
			out = append(out, osqlToken{"op", op, i})
			i += len(op)
			continue
		}
		// measured: `!=` is CX_SY_DYNAMIC_OSQL_SYNTAX
		if ch == '!' && i+1 < len(text) && text[i+1] == '=' {
			panic(OsqlWhereSyntax{fmt.Sprintf("!= at %d is not an Open SQL operator", i)})
		}
		// measured: `@lv` in the condition of a statement without @ is
		// CX_SY_DYNAMIC_OSQL_SEMANTICS
		if ch == '@' {
			panic(OsqlWhereSemantics{fmt.Sprintf("an escaped host variable at %d is not allowed in this statement", i)})
		}
		if m := osqlNumber.FindStringSubmatch(rest); m != nil {
			// measured unquoted: 400 and -5; an unquoted decimal is not
			if m[1] != "" {
				refuseWhere("number format", "the unquoted decimal %s at %d is not measured", m[0], i)
			}
			out = append(out, osqlToken{"number", m[0], i})
			i += len([]rune(m[0]))
			continue
		}
		if m := osqlName.FindString(rest); m != "" {
			// a word run straight into a literal or a parenthesis (EQ'LH',
			// IN('AA')) was not measured
			if n := i + len([]rune(m)); n < len(text) && (text[n] == '\'' || text[n] == '`' || text[n] == '(') {
				refuseWhere("malformed", "%s at %d runs into %q without a blank", m, i, string(text[n]))
			}
			out = append(out, osqlToken{"name", m, i})
			i += len([]rune(m))
			continue
		}
		refuseWhere("malformed", "%q at %d is not part of a condition this parser reads", string(ch), i)
	}
	return out
}

var (
	abapNumberShape = regexp.MustCompile(`^([+-]?)([0-9]+)(?:\.([0-9]+))?([+-]?)$`)
	abapLetter      = regexp.MustCompile(`[A-Za-z]`)
	leadingZeros    = regexp.MustCompile(`^0+([0-9])`)
)

// trimSpaces drops blanks (spaces only) on both ends: what ABAP skips in a number
func trimSpaces(s string) string { return strings.Trim(s, " ") }

// stripZeros is .replace(/^0+(?=\d)/, "")
func stripZeros(s string) string { return leadingZeros.ReplaceAllString(s, "$1") }

// AbapNumber is ABAP's conversion of text to a number as the kernel applied
// it to a literal against an INT4 or packed column (abapNumber of
// ir-osql-where.mjs, measured): blanks around ignored, empty is 0, a sign
// leading or trailing, rounded half away from zero to decimals. A letter is
// an uncatchable runtime error (OsqlWhereDump); another shape is refused as
// a number format not measured. The value as a decimal string with exactly
// decimals digits after the point.
func AbapNumber(raw string, decimals int, column string) string {
	text := trimSpaces(raw)
	if text == "" {
		if decimals == 0 {
			return "0"
		}
		return "0." + strings.Repeat("0", decimals)
	}
	m := abapNumberShape.FindStringSubmatch(text)
	// digits on both sides of a point, when there is one: '385.' and '.5'
	// are not measured
	if m == nil || (m[1] != "" && m[4] != "") {
		if abapLetter.MatchString(text) {
			panic(OsqlWhereDump{fmt.Sprintf("%q against the numeric column %s is not a number: an uncatchable runtime error on A4H", raw, column)})
		}
		refuseWhere("number format", "%q against the numeric column %s: this number format is not measured", raw, column)
	}
	sign := m[1]
	if sign == "" {
		sign = m[4]
	}
	negative := sign == "-"
	whole := m[2]
	if whole == "" {
		whole = "0"
	}
	whole = stripZeros(whole)
	fraction := m[3]
	padded := fraction
	for len(padded) < decimals {
		padded += "0"
	}
	digits := whole + padded[:decimals]
	next := byte('0')
	if decimals < len(fraction) {
		next = fraction[decimals]
	}
	if next >= '5' {
		n, _ := new(big.Int).SetString(digits, 10)
		carried := n.Add(n, big.NewInt(1)).String()
		for len(carried) < len(digits) {
			carried = "0" + carried
		}
		digits = carried
	}
	digits = stripZeros(digits)
	if digits == "" {
		digits = "0"
	}
	intPart := digits
	decPart := ""
	if decimals > 0 {
		intPart = "0"
		if len(digits) > decimals {
			intPart = digits[:len(digits)-decimals]
		}
		d := digits
		for len(d) < decimals+1 {
			d = "0" + d
		}
		decPart = d[len(d)-decimals:]
	}
	zero := strings.Trim(digits, "0") == ""
	out := intPart
	if negative && !zero {
		out = "-" + out
	}
	if decimals > 0 {
		out += "." + decPart
	}
	return out
}

// nonBMP is a character outside the Basic Multilingual Plane
func nonBMP(s string) bool {
	for _, r := range s {
		if r > 0xFFFF {
			return true
		}
	}
	return false
}

// OsqlColumn is one column as the parser takes it: its IR type and Kind
// "NUMC" for a NUMC column (the parser's {type, kind?}).
type OsqlColumn struct {
	Name string
	Type *IRType
	Kind string
}

var (
	int4Min = big.NewInt(-2147483648)
	int4Max = big.NewInt(2147483647)
)

// valueFor is a literal as a value of the column's type, the conversion A4H does
func valueFor(tok osqlToken, c *OsqlColumn) *IR {
	t := c.Type
	raw := tok.value
	if nonBMP(raw) {
		refuseWhere("non-BMP", "a character outside the Basic Multilingual Plane in a literal against %s is not carried", c.Name)
	}
	switch t.Abap {
	case "I":
		value := AbapNumber(raw, 0, c.Name)
		n, _ := new(big.Int).SetString(value, 10)
		if n == nil || n.Cmp(int4Min) < 0 || n.Cmp(int4Max) > 0 {
			panic(OsqlWhereDump{fmt.Sprintf("%q is past the INT4 range of %s: an uncatchable runtime error on A4H", raw, c.Name)})
		}
		return Lit(n.Int64(), t)
	case "P":
		value := AbapNumber(raw, t.Dec, c.Name)
		// len is the DDIC length in digits, as everywhere in the IR (CURR
		// 15,2 is {P, 15, 2}); more digits is an overflow, uncatchable as it
		// was for INT4
		room := 31
		if t.Len > 0 {
			room = t.Len
		}
		d := stripZeros(strings.NewReplacer("-", "", ".", "").Replace(value))
		if len(d) > room {
			panic(OsqlWhereDump{fmt.Sprintf("%q is past the %d digits of %s: an overflow, uncatchable on A4H as it was for INT4", raw, room, c.Name)})
		}
		// a decimal string, bound: never a float
		return Lit(value, t)
	}
	// a RAW(n) column (ultra/zvdb, A4H ZCL_GOGEN_T_RAWDYN): a quoted literal
	// of exactly 2n upper-case hex digits compares as those bytes; any other
	// quoted literal or a number is CX_SY_OPEN_SQL_DATA_ERROR. A backquoted
	// literal was not measured
	if t.Abap == "X" && t.Len > 0 {
		if tok.kind == "text" && rawHexLit(raw, t.Len) {
			return Lit(raw, t)
		}
		if tok.kind == "text" || tok.kind == "number" {
			panic(ArithmeticError{"CX_SY_OPEN_SQL_DATA_ERROR", fmt.Sprintf("%q is not a valid value for X(%d,0)", raw, t.Len)})
		}
	}
	if tok.kind == "number" && t.Abap != "C" {
		refuseWhere("number into char", "an unquoted number against the %s column %s is not measured", t.Abap, c.Name)
	}
	if t.Abap == "C" && c.Kind == "NUMC" {
		digits := trimSpaces(raw)
		ok := digits != ""
		for _, r := range digits {
			if r < '0' || r > '9' {
				ok = false
			}
		}
		if !ok || len(digits) > t.Len {
			refuseWhere("numc", "%q against the NUMC column %s: only digits within its length are measured", raw, c.Name)
		}
		for len(digits) < t.Len {
			digits = "0" + digits
		}
		return Lit(digits, t)
	}
	if t.Abap == "C" || t.Abap == "D" {
		if tok.kind == "number" {
			refuseWhere("number into char", "an unquoted number against the column %s is not measured", c.Name)
		}
		// cut to the column's length in UTF-16 code units, as the kernel
		// counts (non-BMP is refused above, so a unit is a character), then
		// its trailing blanks gone
		n, ct := t.Len, t
		if t.Abap == "D" {
			n, ct = 8, TChar(8)
		}
		v := raw
		if u := utf16.Encode([]rune(v)); n > 0 && len(u) > n {
			v = string(utf16.Decode(u[:n]))
		}
		return Lit(strings.TrimRight(v, " "), ct)
	}
	if t.Abap == "STRING" {
		if tok.kind == "string" {
			return Lit(raw, t)
		}
		// a quoted literal is type C, and C into STRING drops trailing blanks
		return Lit(strings.TrimRight(raw, " "), t)
	}
	refuseWhere("column type", "a condition on the %s column %s is not carried yet", t.Abap, c.Name)
	return nil
}

type osqlParser struct {
	list  []osqlToken
	at    int
	depth int
	terms int
	known map[string]*OsqlColumn
}

func (p *osqlParser) peek(off int) *osqlToken {
	if p.at+off < len(p.list) {
		return &p.list[p.at+off]
	}
	return nil
}

func (p *osqlParser) word() string {
	if t := p.peek(0); t != nil && t.kind == "name" {
		return strings.ToUpper(t.value)
	}
	return ""
}

func (p *osqlParser) take() *osqlToken {
	t := p.peek(0)
	p.at++
	return t
}

func (p *osqlParser) deeper() {
	p.depth++
	if p.depth > OsqlMaxDepth {
		refuseWhere("too deep", "the condition nests deeper than %d", OsqlMaxDepth)
	}
}

func (p *osqlParser) expect(kind, value string) *osqlToken {
	one := p.take()
	if one == nil || one.kind != kind || (value != "" && strings.ToUpper(one.value) != value) {
		want := value
		if want == "" {
			want = kind
		}
		if one == nil {
			refuseWhere("malformed", "expected %s at the end", want)
		}
		refuseWhere("malformed", "expected %s at %d, found %q", want, one.at, one.value)
	}
	return one
}

func (p *osqlParser) literal(c *OsqlColumn) *IR {
	one := p.take()
	// measured: `carrid = ` with nothing after is CX_SY_DYNAMIC_OSQL_SYNTAX
	if one == nil {
		panic(OsqlWhereSyntax{"a value is missing at the end"})
	}
	if one.kind == "text" || one.kind == "string" || one.kind == "number" {
		return valueFor(*one, c)
	}
	if one.kind == "name" && !osqlKeywords[strings.ToUpper(one.value)] {
		if _, ok := p.known[strings.ToUpper(one.value)]; ok {
			refuseWhere("column to column", "comparing the column %s with the column %s is not carried yet", c.Name, strings.ToUpper(one.value))
		}
		// measured: a system reads `carrid = lv_c`; no producer here writes one
		refuseWhere("host variable", "%s is a host variable in the condition, which is not carried (no producer here writes one)", one.value)
	}
	refuseWhere("malformed", "a value was expected at %d, found %q", one.at, one.value)
	return nil
}

// a chain of AND / OR becomes a balanced tree, split in the middle (the
// first ceil(n/2) terms on the left): the meaning is the same, and the depth
// is log2 of the chain, where a left-deep tree passes SQLite's expression
// depth of 1000 at 1000 terms
func balanced(op string, parts []*IR) *IR {
	if len(parts) == 1 {
		return parts[0]
	}
	h := (len(parts) + 1) / 2
	return Bin(op, balanced(op, parts[:h]), balanced(op, parts[h:]), TBool)
}

func (p *osqlParser) orExpr() *IR {
	parts := []*IR{p.andExpr()}
	for p.word() == "OR" {
		p.take()
		parts = append(parts, p.andExpr())
	}
	return balanced("OR", parts)
}

func (p *osqlParser) andExpr() *IR {
	parts := []*IR{p.notExpr()}
	for p.word() == "AND" {
		p.take()
		parts = append(parts, p.notExpr())
	}
	return balanced("AND", parts)
}

func (p *osqlParser) notExpr() *IR {
	if p.word() == "NOT" {
		p.take()
		p.deeper()
		inner := p.notExpr()
		p.depth--
		return Not(inner)
	}
	return p.primary()
}

func (p *osqlParser) primary() *IR {
	first := p.peek(0)
	if first == nil {
		refuseWhere("malformed", "a condition is missing at the end")
	}
	if first.kind == "(" {
		p.take()
		p.deeper()
		inner := p.orExpr()
		p.depth--
		p.expect(")", "")
		return inner
	}
	if first.kind == "text" || first.kind == "string" || first.kind == "number" {
		// measured: `1 = 1` is CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H
		panic(OsqlWhereSemantics{fmt.Sprintf("a literal on the left of a condition (%q at %d) is not a column", first.value, first.at)})
	}
	if first.kind != "name" || osqlKeywords[strings.ToUpper(first.value)] {
		refuseWhere("malformed", "a column was expected at %d, found %q", first.at, first.value)
	}
	p.take()
	p.terms++
	if p.terms > OsqlMaxTerms {
		refuseWhere("too deep", "the condition holds more than %d comparisons", OsqlMaxTerms)
	}
	if strings.Contains(first.value, "~") {
		refuseWhere("qualified name", "the qualified name %s is not carried yet", first.value)
	}
	c, ok := p.known[strings.ToUpper(first.value)]
	// measured: an unknown column is CX_SY_DYNAMIC_OSQL_SEMANTICS
	if !ok {
		panic(OsqlWhereSemantics{strings.ToUpper(first.value) + " is not a column of the table"})
	}
	ct := c.Type
	if ct.Abap == "D" {
		ct = TChar(8)
	}
	expr := Col(c.Name, ct)
	op := p.peek(0)
	if op == nil {
		refuseWhere("malformed", "%s is followed by nothing", c.Name)
	}
	if op.kind == "op" || (op.kind == "name" && osqlCompare[strings.ToUpper(op.value)] != "") {
		p.take()
		key := op.value
		if op.kind != "op" {
			key = strings.ToUpper(op.value)
		}
		return Bin(osqlCompare[key], expr, p.literal(c), TBool)
	}
	negated := p.word() == "NOT"
	if negated {
		p.take()
	}
	// a RAW column: the comparisons were measured (ZCL_GOGEN_T_RAWDYN), not
	// BETWEEN or IN
	if kw := p.word(); c.Type.Abap == "X" && (kw == "BETWEEN" || kw == "IN") {
		refuseWhere("column type", "%s on the RAW column %s is not measured", kw, c.Name)
	}
	switch kw := p.word(); {
	case kw == "BETWEEN":
		p.take()
		low := p.literal(c)
		p.expect("name", "AND")
		high := p.literal(c)
		between := Bin("AND", Bin(">=", expr, low, TBool), Bin("<=", expr, high, TBool), TBool)
		if negated {
			return Not(between)
		}
		return between
	case kw == "LIKE":
		p.take()
		pattern := p.take()
		if pattern == nil || pattern.kind != "text" {
			refuseWhere("malformed", "LIKE wants a quoted pattern after %s", c.Name)
		}
		if c.Type.Abap != "C" || c.Kind == "NUMC" {
			refuseWhere("like type", "LIKE on the column %s is not measured", c.Name)
		}
		if nonBMP(pattern.value) {
			refuseWhere("non-BMP", "a non-BMP character in a LIKE pattern is not carried")
		}
		var escape *IR
		if p.word() == "ESCAPE" {
			p.take()
			e := p.take()
			if e == nil || e.kind != "text" || jsLen(e.value) != 1 {
				refuseWhere("malformed", "ESCAPE wants one quoted character")
			}
			// measured: ESCAPE '%' is CX_SY_DYNAMIC_OSQL_SEMANTICS
			if e.value == "%" || e.value == "_" {
				panic(OsqlWhereSemantics{fmt.Sprintf("ESCAPE %q is a wildcard", e.value)})
			}
			escape = Lit(e.value, TStr)
		}
		// measured: LIKE 'AA ' finds what LIKE 'AA' finds on a CHAR column --
		// without an ESCAPE; with one, a trailing blank could be the escaped
		// character, and that was not measured
		if escape != nil && strings.HasSuffix(pattern.value, " ") {
			refuseWhere("like type", "a LIKE pattern with an ESCAPE and a trailing blank is not measured")
		}
		return Like(expr, Lit(strings.TrimRight(pattern.value, " "), TStr), escape, negated)
	case kw == "IN":
		p.take()
		p.expect("(", "")
		values := []*IR{p.literal(c)}
		for t := p.peek(0); t != nil && t.kind == ","; t = p.peek(0) {
			p.take()
			values = append(values, p.literal(c))
		}
		p.expect(")", "")
		return &IR{Node: "in", Expr: expr, Values: values, Negated: negated, Type: TBool}
	case !negated && kw == "IS":
		p.take()
		isNot := p.word() == "NOT"
		if isNot {
			p.take()
		}
		// measured: IS INITIAL is CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H
		if p.word() == "INITIAL" {
			if isNot {
				refuseWhere("malformed", "IS NOT INITIAL is not measured")
			}
			panic(OsqlWhereSemantics{"IS INITIAL is not allowed in a dynamic condition here"})
		}
		p.expect("name", "NULL")
		n := &IR{Node: "isnull", Expr: expr, Type: TBool}
		if isNot {
			return Not(n)
		}
		return n
	}
	refuseWhere("malformed", "%s is followed by %q at %d, which is not a comparison", c.Name, op.value, op.at)
	return nil
}

// OsqlWherePredicate is WHERE (text) as an IR predicate over the columns
// given (by name, any case); nil, nil when the text is empty or blank
// (every row). The error is an OsqlWhereSyntax, OsqlWhereSemantics,
// OsqlWhereDump or OsqlWhereRefused.
func OsqlWherePredicate(text string, columns []OsqlColumn) (pred *IR, err error) {
	defer func() {
		if r := recover(); r != nil {
			switch x := r.(type) {
			case OsqlWhereSyntax:
				err = x
			case OsqlWhereSemantics:
				err = x
			case OsqlWhereDump:
				err = x
			case OsqlWhereRefused:
				err = x
			default:
				panic(r)
			}
			pred = nil
		}
	}()
	known := make(map[string]*OsqlColumn, len(columns))
	for i := range columns {
		c := columns[i]
		c.Name = strings.ToUpper(c.Name)
		known[c.Name] = &c
	}
	p := &osqlParser{list: osqlTokens([]rune(text)), known: known}
	if len(p.list) == 0 {
		return nil, nil
	}
	pred = p.orExpr()
	if p.at < len(p.list) {
		t := p.peek(0)
		refuseWhere("malformed", "%q at %d is left over after the condition", t.value, t.at)
	}
	return pred, nil
}

// OsqlWhereOutcome is an error as the pairs file carries it:
// {error: OsqlWhereSyntax|OsqlWhereSemantics, abap}, {error: OsqlWhereDump},
// {error: Refused, reason}.
func OsqlWhereOutcome(err error) map[string]string {
	switch x := err.(type) {
	case OsqlWhereSyntax:
		return map[string]string{"error": "OsqlWhereSyntax", "abap": x.Abap()}
	case OsqlWhereSemantics:
		return map[string]string{"error": "OsqlWhereSemantics", "abap": x.Abap()}
	case OsqlWhereDump:
		return map[string]string{"error": "OsqlWhereDump"}
	case OsqlWhereRefused:
		return map[string]string{"error": "Refused", "reason": x.Reason}
	}
	return map[string]string{"error": "unexpected", "message": strconv.Quote(fmt.Sprint(err))}
}
