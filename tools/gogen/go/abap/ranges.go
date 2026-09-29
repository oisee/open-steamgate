package abap

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

// col IN range: a port of rangesPredicate() of tools/ir-ranges.mjs, the one
// place the meaning of an ABAP ranges table is written (measured on A4H by
// osg-i7 and foreman-dell, docs/sqlscript-hana-observed.md). The build
// lowers the statement with a hostPred marker where the range goes
// (/*@range:<id>*/, with the number of parameters before it); this fills
// the marker at run time. Checked byte for byte against
// test/fixtures/ir-pairs/ranges.json and replayed against A4H's rows from
// a4h-ranges.json (ranges_test.go).
//
// The three outcomes that are not a predicate, as the module names them:
//   RangesDump      A4H dumps (SAPSQL_IN_ITAB_ILLEGAL_SIGN / _OPTION), uncatchable
//   RangesDataError A4H raises a catchable CX_SY_* (a value too long, a CP
//                   pattern past twice the column)
//   RangesRefused   a form the module does not reconstruct, by reason

// RangeRow is one row of a ranges table as the ABAP fields hold it: SIGN
// and OPTION as text, LOW and HIGH as the Go value of their field (a string
// for a character field, an integer for an i field); nil is an absent one.
type RangeRow struct {
	Sign, Option string
	Low, High    any
}

// RangesDump is what A4H answers with a dump nobody can catch.
type RangesDump struct{ Abap, Message string }

func (e RangesDump) Error() string { return e.Message }

// RangesDataError is what A4H raises as a catchable exception of class Abap.
type RangesDataError struct{ Abap, Message string }

func (e RangesDataError) Error() string { return e.Message }

// RangesRefused is a range the module refuses by name; Reason is its code.
type RangesRefused struct{ Reason, Message string }

func (e RangesRefused) Error() string { return e.Message }

func refuse(reason, format string, a ...any) {
	panic(RangesRefused{reason, fmt.Sprintf(format, a...)})
}

// jsLen is String.length: UTF-16 code units.
func jsLen(s string) int { return len(utf16.Encode([]rune(s))) }

// jsString is String(v ?? "").
func jsString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := jsNumber(v); ok {
		return s
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

// jsInteger is Number(v) when it is an integer: what bound() accepts for an
// INTEGER column. A text is read as JavaScript reads it for the forms an
// ABAP field can hold (blanks around digits, empty = 0); anything else is
// refused rather than read differently.
func jsInteger(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case float64:
		if n == math.Trunc(n) && !math.IsInf(n, 0) {
			return int64(n), true
		}
		return 0, false
	case string:
		t := strings.TrimSpace(n)
		if t == "" {
			return 0, true
		}
		i, err := strconv.ParseInt(t, 10, 64)
		if err != nil || i > 1<<53 || i < -(1<<53) {
			return 0, false
		}
		return i, true
	}
	return 0, false
}

func rtrimBlanks(s string) string { return strings.TrimRight(s, " ") }

// bound: a LOW / HIGH value as the column's type binds it.
func bound(value any, t *IRType, kind string) *IR {
	switch {
	case t != nil && t.Abap == "I":
		n, ok := jsInteger(value)
		if !ok {
			refuse("refused", "range value %q is not an INTEGER", jsString(value))
		}
		return Lit(n, t)
	case t != nil && t.Abap == "C":
		text := rtrimBlanks(jsString(value))
		if kind == "NUMC" {
			for _, r := range text {
				if r < '0' || r > '9' {
					refuse("refused", "range value %q is not NUMC digits", jsString(value))
				}
			}
			for jsLen(text) < t.Len {
				text = "0" + text
			}
		}
		if t.Len > 0 && jsLen(text) > t.Len {
			panic(RangesDataError{"CX_SY_OPEN_SQL_DATA_ERROR", fmt.Sprintf("range value %q is longer than the column's %d characters: CX_SY_OPEN_SQL_DATA_ERROR on A4H", jsString(value), t.Len)})
		}
		return Lit(text, t)
	case t != nil && t.Abap == "STRING":
		return Lit(jsString(value), t)
	}
	abap := "unknown"
	if t != nil {
		abap = t.Abap
	}
	refuse("refused", "ranges over a column of type %s are not carried yet", abap)
	return nil
}

// cpItem is one item of a CP pattern: a literal character, * or +.
type cpItem struct {
	lit      rune
	any, one bool
}

// cpItems reads a CP pattern as the kernel does: # makes the next character
// literal (a trailing # escapes a padding blank), trailing literal blanks
// dropped.
func cpItems(pattern string) []cpItem {
	var items []cpItem
	rs := []rune(pattern)
	for i := 0; i < len(rs); i++ {
		switch rs[i] {
		case '#':
			if i+1 < len(rs) {
				items = append(items, cpItem{lit: rs[i+1]})
			} else {
				items = append(items, cpItem{lit: ' '})
			}
			i++
		case '*':
			items = append(items, cpItem{any: true})
		case '+':
			items = append(items, cpItem{one: true})
		default:
			items = append(items, cpItem{lit: rs[i]})
		}
	}
	for len(items) > 0 && !items[len(items)-1].any && !items[len(items)-1].one && items[len(items)-1].lit == ' ' {
		items = items[:len(items)-1]
	}
	return items
}

func isLit(it cpItem, r rune) bool { return !it.any && !it.one && it.lit == r }

// likeText is the items as a LIKE pattern, and whether it needs ESCAPE '#'.
func likeText(items []cpItem) (string, bool) {
	escape := false
	for _, it := range items {
		if isLit(it, '%') || isLit(it, '_') {
			escape = true
		}
	}
	var b strings.Builder
	for _, it := range items {
		switch {
		case it.any:
			b.WriteByte('%')
		case it.one:
			b.WriteByte('_')
		case escape && (it.lit == '%' || it.lit == '_' || it.lit == '#'):
			b.WriteByte('#')
			b.WriteRune(it.lit)
		default:
			b.WriteRune(it.lit)
		}
	}
	return b.String(), escape
}

var (
	irTrue  = func() *IR { return Bin("=", Lit(int64(1), TInt), Lit(int64(1), TInt), TBool) }
	irFalse = func() *IR { return Bin("=", Lit(int64(1), TInt), Lit(int64(0), TInt), TBool) }
)

func irOr(parts []*IR) *IR {
	out := parts[0]
	for _, p := range parts[1:] {
		out = Bin("OR", out, p, TBool)
	}
	return out
}

var validOptions = map[string]bool{"EQ": true, "NE": true, "GT": true, "GE": true, "LT": true, "LE": true, "BT": true, "NB": true, "CP": true, "NP": true}

// rowCondition: one row of the ranges as a condition true when it matches.
func rowCondition(expr *IR, t *IRType, kind string, row RangeRow, lowLen int) *IR {
	option := row.Option
	if !validOptions[option] {
		panic(RangesDump{"SAPSQL_IN_ITAB_ILLEGAL_OPTION", fmt.Sprintf("range OPTION %q: SAPSQL_IN_ITAB_ILLEGAL_OPTION, an uncatchable dump on A4H", option)})
	}
	low := func() *IR { return bound(row.Low, t, kind) }
	high := func() *IR { return bound(row.High, t, kind) }
	if op, ok := map[string]string{"EQ": "=", "NE": "<>", "GT": ">", "GE": ">=", "LT": "<", "LE": "<="}[option]; ok {
		return Bin(op, expr, low(), TBool)
	}
	if option == "BT" || option == "NB" {
		between := Bin("AND", Bin(">=", expr, low(), TBool), Bin("<=", expr, high(), TBool), TBool)
		if option == "BT" {
			return between
		}
		return Not(between)
	}
	// CP / NP
	abap := ""
	if t != nil {
		abap = t.Abap
	}
	if abap != "C" && abap != "STRING" {
		refuse("refused", "%s over a column of type %s is not carried", option, abap)
	}
	lowText := jsString(row.Low)
	highText := rtrimBlanks(jsString(row.High))
	if abap == "STRING" && highText != "" {
		refuse("high over string", "%s with a HIGH over a STRING column is not measured", option)
	}
	if highText != "" && lowLen <= 0 {
		refuse("high without lowLen", "%s with a HIGH needs the declared width of the range's LOW (option lowLen)", option)
	}
	source := lowText
	if abap == "C" && highText != "" {
		source = lowText
		for jsLen(source) < lowLen {
			source += " "
		}
		source += highText
	}
	if abap == "C" && jsLen(rtrimBlanks(source)) > 2*t.Len {
		panic(RangesDataError{"CX_SY_DYNAMIC_OSQL_SEMANTICS", fmt.Sprintf("CP pattern %q is longer than twice the column's %d (the limit measured at CHAR10, extrapolated): CX_SY_DYNAMIC_OSQL_SEMANTICS on A4H", rtrimBlanks(source), t.Len)})
	}
	items := cpItems(source)
	wild := func(i int) bool { return i < len(items) && (items[i].any || items[i].one) }
	leadingBlank := len(items) > 0 && isLit(items[0], ' ')
	blankBeforeWild := false
	for i, it := range items {
		if isLit(it, ' ') && wild(i+1) {
			blankBeforeWild = true
		}
	}
	if leadingBlank || blankBeforeWild {
		refuse("special padding form", "%s pattern %q has blanks that meet the padding; A4H renders a special form for it that is not carried", option, source)
	}
	if len(items) == 1 && items[0].one {
		refuse("plus alone", "%s pattern \"+\" matches the initial value on A4H in a way not reconstructed here", option)
	}
	negated := option == "NP"
	allAny := len(items) > 0
	someWild := false
	for i := range items {
		if !items[i].any {
			allAny = false
		}
		if wild(i) {
			someWild = true
		}
	}
	if allAny {
		if negated {
			return irFalse()
		}
		return irTrue()
	}
	if !someWild {
		var b strings.Builder
		for _, it := range items {
			b.WriteRune(it.lit)
		}
		op := "="
		if negated {
			op = "<>"
		}
		return Bin(op, expr, Lit(b.String(), t), TBool)
	}
	text, escape := likeText(items)
	var esc *IR
	if escape {
		esc = Lit("#", TStr)
	}
	return Like(expr, Lit(text, TStr), esc, negated)
}

// RangesPredicate is column IN rows as an IR condition. kind is "NUMC" for
// a NUMC column of type C; lowLen is the declared width of the range's LOW
// (0 when it is not a character field), needed for a CP / NP with a HIGH.
// A dump, a data error or a refusal is returned as the error, never as "no
// restriction".
func RangesPredicate(column string, t *IRType, rows []RangeRow, kind string, lowLen int) (pred *IR, err error) {
	defer func() {
		if r := recover(); r != nil {
			switch x := r.(type) {
			case RangesDump:
				err = x
			case RangesDataError:
				err = x
			case RangesRefused:
				err = x
			default:
				panic(r)
			}
		}
	}()
	expr := Col(strings.ToUpper(column), t)
	if len(rows) == 0 {
		return irTrue(), nil
	}
	// exactly I or E: lower case or an initial row is a dump on A4H
	for _, r := range rows {
		if r.Sign != "I" && r.Sign != "E" {
			panic(RangesDump{"SAPSQL_IN_ITAB_ILLEGAL_SIGN", fmt.Sprintf("range SIGN %q: SAPSQL_IN_ITAB_ILLEGAL_SIGN, an uncatchable dump on A4H", r.Sign)})
		}
	}
	var include, exclude []*IR
	for _, r := range rows {
		if r.Sign == "I" {
			include = append(include, rowCondition(expr, t, kind, r, lowLen))
		}
	}
	for _, r := range rows {
		if r.Sign == "E" {
			exclude = append(exclude, rowCondition(expr, t, kind, r, lowLen))
		}
	}
	switch {
	case len(include) > 0 && len(exclude) > 0:
		return Bin("AND", irOr(include), Not(irOr(exclude)), TBool), nil
	case len(include) > 0:
		return irOr(include), nil
	default:
		return Not(irOr(exclude)), nil
	}
}

// HostPred is a range that arrives at run time: where lower() put its
// marker, the column and its type, and the rows.
type HostPred struct {
	ID     string
	After  int // parameters of the statement before the marker
	Column string
	Type   *IRType
	Kind   string
	LowLen int
	Rows   []RangeRow
}

// rangeFailure turns a refused range into what the program sees: a dump,
// a catchable exception of the class A4H raises, or NOT_COMPILED.
func rangeFailure(err error) {
	switch x := err.(type) {
	case RangesDump:
		panic(ArithmeticError{x.Abap, x.Message})
	case RangesDataError:
		panic(ArithmeticError{x.Abap, x.Message})
	case RangesRefused:
		panic(NotCompiled("IN range", x.Message))
	case Refused:
		panic(NotCompiled("IN range", x.Reason))
	}
	panic(err)
}

// SpliceRanges fills the hostPred markers of a statement lowered at build
// time: each marker replaced by its predicate's SQL, its parameters put
// after the statement's first After ones.
func SpliceRanges(text string, args []any, preds []HostPred) (string, []any) {
	if len(preds) == 0 {
		return text, args
	}
	out := []any{}
	next := 0
	for _, p := range preds {
		pred, err := RangesPredicate(p.Column, p.Type, p.Rows, p.Kind, p.LowLen)
		if err != nil {
			rangeFailure(err)
		}
		sql, params, err := LowerPredicate(pred)
		if err != nil {
			rangeFailure(err)
		}
		marker := "/*@range:" + p.ID + "*/"
		if !strings.Contains(text, marker) {
			panic(NotCompiled("IN range", "the statement has no marker "+marker))
		}
		text = strings.Replace(text, marker, sql, 1)
		out = append(out, args[next:p.After]...)
		out = append(out, values(params)...)
		next = p.After
	}
	out = append(out, args[next:]...)
	return text, out
}
