package abap

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// The relational IR of tools/sqlscript-ir.mjs as Go values, and a port of
// the SQLite rendering of tools/sqlscript-lower.mjs for the part a host has
// to render at run time: a range predicate (tools/ir-ranges.mjs, a hostPred
// marker filled here) and a write whose rows are values of the work area
// (tools/ir-writes.mjs). Everything that is known at build time is lowered
// there by lower() itself; this renders only what arrives at run time, and
// it is checked byte for byte against the pairs osg-i7's modules write
// (test/fixtures/ir-pairs/ranges.json and writes.json, irsql_test.go).
//
// The field names follow the JSON of the IR, so the pairs files decode into
// these types unchanged.

// IRType is an IR type: {abap: "C", len: 10}, {abap: "I"}, {abap: "STRING"}.
type IRType struct {
	Abap string `json:"abap"`
	Len  int    `json:"len,omitempty"`
	Bits int    `json:"bits,omitempty"`
	// Dec is the decimals of a P ({abap: "P", len: digits, dec})
	Dec int `json:"dec,omitempty"`
}

// seam is the type as the seam names it (seamType in sqlscript-ir.mjs).
func (t *IRType) seam() string {
	if t == nil {
		return "STRING"
	}
	if t.Abap == "P" && t.Len > 0 {
		return fmt.Sprintf("P(%d,%d)", t.Len, t.Dec)
	}
	if t.Len > 0 {
		return fmt.Sprintf("%s(%d)", t.Abap, t.Len)
	}
	return t.Abap
}

var (
	TInt  = &IRType{Abap: "I"}
	TStr  = &IRType{Abap: "STRING"}
	TBool = &IRType{Abap: "BOOL"}
)

// TChar is CHAR of a length.
func TChar(n int) *IRType { return &IRType{Abap: "C", Len: n} }

// IR is one expression node.
type IR struct {
	Node    string  `json:"node"`
	Name    string  `json:"name,omitempty"`
	Source  string  `json:"source,omitempty"`
	Value   any     `json:"value,omitempty"`
	Type    *IRType `json:"type,omitempty"`
	Op      string  `json:"op,omitempty"`
	Left    *IR     `json:"left,omitempty"`
	Right   *IR     `json:"right,omitempty"`
	Expr    *IR     `json:"expr,omitempty"`
	Pattern *IR     `json:"pattern,omitempty"`
	Escape  *IR     `json:"escape,omitempty"`
	Negated bool    `json:"negated,omitempty"`
	IsNull  bool    `json:"isNull,omitempty"`
	Values  []*IR   `json:"values,omitempty"`
}

// Lit, Col, Bin, Not and Like build nodes as sqlscript-ir.mjs does.
func Lit(v any, t *IRType) *IR       { return &IR{Node: "lit", Value: v, Type: t} }
func Col(name string, t *IRType) *IR { return &IR{Node: "col", Name: name, Type: t} }
func Bin(op string, l, r *IR, t *IRType) *IR {
	return &IR{Node: "bin", Op: op, Left: l, Right: r, Type: t}
}
func Not(e *IR) *IR { return &IR{Node: "not", Expr: e, Type: TBool} }
func Like(e, p, esc *IR, negated bool) *IR {
	return &IR{Node: "like", Expr: e, Pattern: p, Escape: esc, Negated: negated, Type: TBool}
}

// IRRel is a relation node, the few shapes a write's INSERT ... FROM
// (SELECT) carries: scan, filter, project.
type IRRel struct {
	Rel   string   `json:"rel"`
	Table string   `json:"table,omitempty"`
	Input *IRRel   `json:"input,omitempty"`
	Pred  *IR      `json:"pred,omitempty"`
	Items []IRItem `json:"items,omitempty"`
}

// IRItem is one column of a projection.
type IRItem struct {
	As   string `json:"as"`
	Expr *IR    `json:"expr"`
}

// IRSet is one SET col = expr of an UPDATE.
type IRSet struct {
	Col  string `json:"col"`
	Expr *IR    `json:"expr"`
}

// IRWrite is a write statement of tools/ir-writes.mjs.
type IRWrite struct {
	Write       string   `json:"write"`
	Table       string   `json:"table"`
	Columns     []string `json:"columns,omitempty"`
	Rows        [][]*IR  `json:"rows,omitempty"`
	From        *IRRel   `json:"from,omitempty"`
	OnDuplicate string   `json:"onDuplicate,omitempty"`
	Expected    int      `json:"expected,omitempty"`
	Set         []IRSet  `json:"set,omitempty"`
	Pred        *IR      `json:"pred,omitempty"`
	Key         []string `json:"key,omitempty"`
}

// Param is a bound value as lower() lists it.
type Param struct {
	Name   string `json:"name"`
	Value  any    `json:"value"`
	Type   string `json:"type"`
	IsNull bool   `json:"isNull"`
}

// Refused is what lower() throws as Refused: a node this renderer does not
// carry, by name.
type Refused struct{ Reason string }

func (r Refused) Error() string { return r.Reason }

// lowering renders for one dialect; "" is SQLite, the one the host runs.
// The other three (duckdb, postgres, hana) are the dialects of
// tools/sqlscript-lower.mjs for the expression nodes a predicate has: the
// placeholder and LIKE differ, nothing else a predicate uses does. They are
// what the pairs files check the port against, all four of them.
type lowering struct {
	params  []Param
	dialect string
}

// placeholder is the dialect's placeholder for the n-th parameter (from 1)
// of the seam type code (DIALECTS[d].placeholder).
var (
	seamInteger = regexp.MustCompile(`^[IBS](\(|$)`)
	seamDouble  = regexp.MustCompile(`^F(\(|$)`)
	seamPacked  = regexp.MustCompile(`^P\(\d+,\d+\)$`)
	seamChar    = regexp.MustCompile(`^C\(\d+\)$`)
)

func (l *lowering) placeholder(n int, code string) string {
	if l.dialect == "" || l.dialect == "duckdb" {
		return "?"
	}
	code = strings.ToUpper(code)
	integer := seamInteger.MatchString(code)
	double := seamDouble.MatchString(code)
	packed := seamPacked.MatchString(code)
	switch l.dialect {
	case "hana":
		switch {
		case integer:
			return "CAST(? AS INTEGER)"
		case double:
			return "CAST(? AS DOUBLE)"
		case packed:
			return "CAST(? AS DECIMAL" + code[1:] + ")"
		}
		return "?"
	case "postgres":
		var pg string
		switch {
		case integer:
			pg = "integer"
		case double:
			pg = "double precision"
		case packed:
			pg = "numeric" + code[1:]
		case seamChar.MatchString(code):
			pg = "varchar" + code[1:]
		case code == "STRING":
			pg = "text"
		default:
			c := code
			if c == "" {
				c = "(missing)"
			}
			panic(Refused{"the ABAP type " + c + " has no PostgreSQL parameter type"})
		}
		return fmt.Sprintf("$%d::%s", n, pg)
	}
	return "?"
}

// like is DIALECTS[d].like: PostgreSQL always says ESCAPE, '' when the
// condition has none (its default escape is a backslash, which neither
// ABAP nor the other engines have)
func (l *lowering) like(e, p string, esc *string, neg bool) string {
	n := ""
	if neg {
		n = " NOT"
	}
	if l.dialect == "postgres" {
		x := "''"
		if esc != nil {
			x = *esc
		}
		return "(" + e + n + " LIKE " + p + " ESCAPE " + x + ")"
	}
	tail := ""
	if esc != nil {
		tail = " ESCAPE " + *esc
	}
	return "(" + e + n + " LIKE " + p + tail + ")"
}

func quote(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

// jsNumber is String(n) of a JavaScript number, for the integers a lit holds.
func jsNumber(v any) (string, bool) {
	switch n := v.(type) {
	case int:
		return strconv.Itoa(n), true
	case int32:
		return strconv.FormatInt(int64(n), 10), true
	case int64:
		return strconv.FormatInt(n, 10), true
	case float64:
		return strconv.FormatFloat(n, 'f', -1, 64), true
	}
	return "", false
}

func (l *lowering) expr(e *IR) string {
	if e == nil || e.Node == "" {
		panic(Refused{"an expression arrived without a node kind"})
	}
	switch e.Node {
	case "col":
		if e.Source == "" {
			return quote(e.Name)
		}
		return quote(e.Source) + "." + quote(e.Name)
	case "lit":
		if s, ok := jsNumber(e.Value); ok {
			return s
		}
		// a string literal still goes through a parameter
		l.params = append(l.params, Param{Name: fmt.Sprintf("p%d", len(l.params)), Value: e.Value, Type: e.Type.seam(), IsNull: e.Value == nil})
		return l.placeholder(len(l.params), e.Type.seam())
	case "param":
		l.params = append(l.params, Param{Name: e.Name, Value: e.Value, Type: e.Type.seam(), IsNull: e.IsNull})
		return l.placeholder(len(l.params), e.Type.seam())
	case "bin":
		left := l.expr(e.Left)
		right := l.expr(e.Right)
		if e.Op == "/" {
			if l.dialect != "" {
				panic(Refused{"division is rendered for SQLite only here"})
			}
			if e.Type != nil && e.Type.Abap == "I" {
				return "(" + left + " / " + right + ")"
			}
			return "((" + left + ") * 1.0 / (" + right + "))"
		}
		return "(" + left + " " + e.Op + " " + right + ")"
	case "isnull":
		return "(" + l.expr(e.Expr) + " IS NULL)"
	case "not":
		return "(NOT " + l.expr(e.Expr) + ")"
	case "like":
		x := l.expr(e.Expr)
		p := l.expr(e.Pattern)
		var esc *string
		if e.Escape != nil {
			v := l.expr(e.Escape)
			esc = &v
		}
		return l.like(x, p, esc, e.Negated)
	case "in":
		x := l.expr(e.Expr)
		vals := make([]string, len(e.Values))
		for i, v := range e.Values {
			vals[i] = l.expr(v)
		}
		neg := ""
		if e.Negated {
			neg = " NOT"
		}
		return "(" + x + neg + " IN (" + strings.Join(vals, ", ") + "))"
	}
	panic(Refused{"expression " + e.Node + " not lowered"})
}

func (l *lowering) from(r *IRRel) string {
	if r.Rel == "scan" {
		return quote(r.Table)
	}
	return "(" + l.sel(r) + ") AS " + quote("t0")
}

func (l *lowering) sel(r *IRRel) string {
	if r == nil || r.Rel == "" {
		panic(Refused{"a relation arrived without a rel kind"})
	}
	items := func(r *IRRel) string {
		parts := make([]string, len(r.Items))
		for i, it := range r.Items {
			parts[i] = l.expr(it.Expr) + " AS " + quote(it.As)
		}
		return strings.Join(parts, ", ")
	}
	switch r.Rel {
	case "scan":
		return "SELECT * FROM " + l.from(r)
	case "filter":
		if r.Input.Rel != "scan" {
			break
		}
		src := l.from(r.Input)
		return "SELECT * FROM " + src + " WHERE " + l.expr(r.Pred)
	case "project":
		if r.Input.Rel == "filter" && r.Input.Input.Rel == "scan" {
			its := items(r)
			src := l.from(r.Input.Input)
			return "SELECT " + its + " FROM " + src + " WHERE " + l.expr(r.Input.Pred)
		}
		if r.Input.Rel == "scan" {
			its := items(r)
			return "SELECT " + its + " FROM " + l.from(r.Input)
		}
	}
	panic(Refused{"relation " + r.Rel + " is not rendered at run time (it is lowered at build time)"})
}

func (l *lowering) write(w *IRWrite) string {
	table := quote(w.Table)
	cols := func(list []string) string {
		q := make([]string, len(list))
		for i, c := range list {
			q[i] = quote(c)
		}
		return "(" + strings.Join(q, ", ") + ")"
	}
	values := func(rows [][]*IR) string {
		out := make([]string, len(rows))
		for i, row := range rows {
			vs := make([]string, len(row))
			for j, v := range row {
				vs[j] = l.expr(v)
			}
			out[i] = "(" + strings.Join(vs, ", ") + ")"
		}
		return strings.Join(out, ", ")
	}
	where := func() string {
		if w.Pred == nil {
			return ""
		}
		return " WHERE " + l.expr(w.Pred)
	}
	switch w.Write {
	case "insert":
		skip := w.OnDuplicate == "ignore" || w.OnDuplicate == "raise"
		ignore := ""
		if skip {
			ignore = " ON CONFLICT DO NOTHING"
		}
		if w.From != nil {
			from := l.sel(w.From)
			if skip {
				from = "SELECT * FROM (" + from + ") WHERE true"
			}
			return "INSERT INTO " + table + " " + cols(w.Columns) + " " + from + ignore
		}
		return "INSERT INTO " + table + " " + cols(w.Columns) + " VALUES " + values(w.Rows) + ignore
	case "update":
		set := make([]string, len(w.Set))
		for i, s := range w.Set {
			set[i] = quote(s.Col) + " = " + l.expr(s.Expr)
		}
		return "UPDATE " + table + " SET " + strings.Join(set, ", ") + where()
	case "delete":
		return "DELETE FROM " + table + where()
	case "upsert":
		key := map[string]bool{}
		for _, k := range w.Key {
			key[k] = true
		}
		var rest []string
		for _, c := range w.Columns {
			if !key[c] {
				rest = append(rest, quote(c)+" = excluded."+quote(c))
			}
		}
		action := "DO NOTHING"
		if len(rest) > 0 {
			action = "DO UPDATE SET " + strings.Join(rest, ", ")
		}
		return "INSERT INTO " + table + " " + cols(w.Columns) + " VALUES " + values(w.Rows) + " ON CONFLICT " + cols(w.Key) + " " + action
	}
	panic(Refused{fmt.Sprintf("no write %q", w.Write)})
}

func catchRefused(err *error) {
	if r := recover(); r != nil {
		if x, ok := r.(Refused); ok {
			*err = x
			return
		}
		panic(r)
	}
}

// LowerPredicate renders a condition alone, as lowerPredicate() of
// ir-ranges.mjs does for SQLite: the text a host splices into a hostPred
// marker, with its own parameters in order.
func LowerPredicate(pred *IR) (sql string, params []Param, err error) {
	defer catchRefused(&err)
	l := &lowering{}
	sql = l.expr(pred)
	return sql, l.params, nil
}

// LowerPredicateIn renders a condition alone in one of the four dialects
// of tools/sqlscript-lower.mjs (sqlite, duckdb, postgres, hana), as
// lowerPredicate(pred, dialect) of ir-ranges.mjs does. Only SQLite runs
// here; the other three are what the pairs check the port against.
func LowerPredicateIn(pred *IR, dialect string) (sql string, params []Param, err error) {
	defer catchRefused(&err)
	switch dialect {
	case "sqlite", "":
		dialect = ""
	case "duckdb", "postgres", "hana":
	default:
		panic(Refused{"no dialect " + dialect})
	}
	l := &lowering{dialect: dialect}
	sql = l.expr(pred)
	return sql, l.params, nil
}

// LowerWrite renders a write statement for SQLite, as lower() does.
func LowerWrite(w *IRWrite) (sql string, params []Param, err error) {
	defer catchRefused(&err)
	l := &lowering{}
	sql = l.write(w)
	return sql, l.params, nil
}

// values is what the driver binds, in order.
func values(params []Param) []any {
	out := make([]any, len(params))
	for i, p := range params {
		out[i] = p.Value
	}
	return out
}
