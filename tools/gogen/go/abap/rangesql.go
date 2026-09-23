package abap

import "strings"

// RangeRow is one row of a ranges table (SIGN, OPTION, LOW, HIGH), its
// values as the text the column is compared with.
type RangeRow struct {
	Sign, Option, Low, High string
}

// RangeSQL renders col IN range as an SQL predicate with ? parameters, the
// way ABAP defines a ranges table rather than the way SQL reads IN: the rows
// of sign I are OR'ed (none at all is true), the rows of sign E are OR'ed and
// negated, and the two are AND'ed; an empty table is true. CP and NP become
// LIKE on the column without its trailing blanks (a CHAR column stores them
// padded, and 'T0001' CP 'T0001' is true in ABAP), with * as %, + as _, and
// # making the next character literal.
//
// Not yet pinned against A4H: the conformance pairs for every option, sign
// combination, initial values and patterns are the next step (codex gpt-6-sol,
// 2026-09-23: "ranges are ABAP predicates, not a plain SQL IN").
func RangeSQL(col string, rows []RangeRow) (string, []any) {
	if len(rows) == 0 {
		return "1=1", nil
	}
	var inc, exc []string
	var incArgs, excArgs []any
	for _, r := range rows {
		p, a := rangeCond(col, r)
		if strings.TrimRight(r.Sign, " ") == "E" {
			exc, excArgs = append(exc, p), append(excArgs, a...)
		} else if strings.TrimRight(r.Sign, " ") == "I" {
			inc, incArgs = append(inc, p), append(incArgs, a...)
		} else {
			panic(NotCompiled("IN range", "sign "+r.Sign))
		}
	}
	sql := "1=1"
	args := []any{}
	if len(inc) > 0 {
		sql = "(" + strings.Join(inc, " OR ") + ")"
		args = append(args, incArgs...)
	}
	if len(exc) > 0 {
		sql += " AND NOT (" + strings.Join(exc, " OR ") + ")"
		args = append(args, excArgs...)
	}
	return sql, args
}

func rangeCond(col string, r RangeRow) (string, []any) {
	switch strings.TrimRight(r.Option, " ") {
	case "EQ":
		return col + " = ?", []any{r.Low}
	case "NE":
		return col + " <> ?", []any{r.Low}
	case "GT":
		return col + " > ?", []any{r.Low}
	case "GE":
		return col + " >= ?", []any{r.Low}
	case "LT":
		return col + " < ?", []any{r.Low}
	case "LE":
		return col + " <= ?", []any{r.Low}
	case "BT":
		return col + " BETWEEN ? AND ?", []any{r.Low, r.High}
	case "NB":
		return col + " NOT BETWEEN ? AND ?", []any{r.Low, r.High}
	case "CP":
		return "rtrim(" + col + ") LIKE ? ESCAPE '\\'", []any{likePattern(r.Low)}
	case "NP":
		return "rtrim(" + col + ") NOT LIKE ? ESCAPE '\\'", []any{likePattern(r.Low)}
	}
	panic(NotCompiled("IN range", "option "+r.Option))
}

// likePattern turns a CP pattern into a LIKE pattern with \ as the escape.
func likePattern(p string) string {
	p = strings.TrimRight(p, " ")
	var b strings.Builder
	rs := []rune(p)
	for i := 0; i < len(rs); i++ {
		switch c := rs[i]; {
		case c == '#' && i+1 < len(rs):
			i++
			if rs[i] == '%' || rs[i] == '_' || rs[i] == '\\' {
				b.WriteRune('\\')
			}
			b.WriteRune(rs[i])
		case c == '*':
			b.WriteByte('%')
		case c == '+':
			b.WriteByte('_')
		case c == '%' || c == '_' || c == '\\':
			b.WriteByte('\\')
			b.WriteRune(c)
		default:
			b.WriteRune(c)
		}
	}
	return b.String()
}
