package abap

import (
	"math"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// String statements and built-in string functions, each rule measured on
// A4H 2026-09-23 (ZCL_GOGEN_T_STR* in testdata, EXPECT in semantics.mjs).
// Character-like arguments arrive as Go strings; a c argument has already
// lost its trailing blanks, which is what ABAP does with them everywhere
// here except the separator of SPLIT and the c field REPLACE works in.

// NoLength is the LENGTH of a SECTION that names none: the rest.
const NoLength = math.MinInt32

// PadC is a c value at its full length: the trailing blanks a c field has
// and its Go string does not. SPLIT ... AT a c separator keeps them ('a '
// splits `a b` into ” and 'b'; a c(5) holding 'x' is 'x    ').
func PadC(v string, n int) string {
	if c := utf8.RuneCountInString(v); c < n {
		return v + strings.Repeat(" ", n-c)
	}
	return v
}

// SplitInto is SPLIT v AT sep INTO t1 ... tn: more pieces than targets and
// the last target gets the rest, separators included (a,b,c, into two is a
// / b,c,); fewer and the other targets are cleared; an empty v clears them
// all; an empty separator does not split (abc into two is abc / ”).
func SplitInto(v, sep string, n int) []string {
	out := make([]string, n)
	if v == "" {
		return out
	}
	if sep == "" {
		out[0] = v
		return out
	}
	parts := strings.SplitN(v, sep, n)
	copy(out, parts)
	return out
}

// SplitSubrc is sy-subrc of SPLIT INTO fields: 4 when a piece is longer
// than the c field it goes into (it is cut there), 0 otherwise. lens holds
// the length of each c target, -1 for a string.
func SplitSubrc(pieces []string, lens []int) int32 {
	for i, p := range pieces {
		if lens[i] >= 0 && utf8.RuneCountInString(p) > lens[i] {
			return 4
		}
	}
	return 0
}

// rxAll is every match of an ABAP regex in s, in the order REPLACE ALL
// takes them (measured): leftmost-longest from the current position; after
// an empty match the next search starts one character later, after a
// non-empty one at its end, where an empty match is taken too (abbc with b*
// is -a--c-), except at the end of the string (bb with b* is -). Each match
// is the submatch index slice of Go's regexp, in bytes. first stops at one.
func rxAll(s, p string, icase, first bool) [][]int {
	re := compileABAP(p, icase)
	checkLines(p, s, "REPLACE REGEX")
	var out [][]int
	pos := 0
	for pos <= len(s) {
		var m []int
		if pos == 0 {
			m = re.FindStringSubmatchIndex(s)
		} else {
			// a match that starts at pos or later, with the character before
			// pos in view, so that ^ \b and the like see their context
			_, w := utf8.DecodeLastRuneInString(s[:pos])
			base := pos - w
			m2 := compileABAPAfter(p, icase).FindStringSubmatchIndex(s[base:])
			if m2 != nil {
				m = make([]int, len(m2)-2)
				for i := 2; i < len(m2); i++ {
					if m2[i] >= 0 {
						m[i-2] = m2[i] + base
					} else {
						m[i-2] = -1
					}
				}
			}
		}
		if m == nil {
			break
		}
		out = append(out, m)
		if first {
			break
		}
		if m[1] > m[0] {
			pos = m[1]
			if pos == len(s) {
				break
			}
			continue
		}
		if m[0] >= len(s) {
			break
		}
		_, w := utf8.DecodeRuneInString(s[m[0]:])
		pos = m[0] + w
	}
	return out
}

// compileABAPAfter is the pattern behind one arbitrary character, for a
// search that must begin after it: (?s:.)(p), leftmost-longest, so the
// first group is the match of p and the groups of p follow it.
func compileABAPAfter(p string, icase bool) *regexp.Regexp {
	compileABAP(p, icase) // the same checks and errors as the pattern itself
	key := "after\x00" + p
	if icase {
		key = "after-i\x00" + p
	}
	if r, ok := regexCache.Load(key); ok {
		return r.(*regexp.Regexp)
	}
	flags := "(?ms)"
	if icase {
		flags = "(?msi)"
	}
	re := regexp.MustCompile(flags + "(?s:.)(" + p + ")")
	re.Longest()
	regexCache.Store(key, re)
	return re
}

// plainAll is every occurrence of sub in s, left to right, not overlapping,
// as [start end] byte pairs; icase compares case-insensitively.
func plainAll(s, sub string, icase, first bool) [][]int {
	if icase {
		return rxAll(s, regexp.QuoteMeta(sub), true, first)
	}
	var out [][]int
	for pos := 0; pos <= len(s); {
		i := strings.Index(s[pos:], sub)
		if i < 0 {
			break
		}
		out = append(out, []int{pos + i, pos + i + len(sub)})
		if first {
			break
		}
		pos += i + len(sub)
	}
	return out
}

// rxWith is the replacement text of one regex match: $0..$9 a group (one
// that did not take part, or does not exist, is empty), $& the whole match,
// \x the character x (measured: \$1 is $1). Anything else a $ can start is
// not measured and does not compile.
func rxWith(s, with string, m []int) string {
	if !strings.ContainsAny(with, `$\`) {
		return with
	}
	group := func(g int) string {
		if 2*g+1 < len(m) && m[2*g] >= 0 {
			return s[m[2*g]:m[2*g+1]]
		}
		return ""
	}
	var b strings.Builder
	r := []rune(with)
	for i := 0; i < len(r); i++ {
		switch {
		case r[i] == '\\' && i+1 < len(r):
			i++
			b.WriteRune(r[i])
		case r[i] == '$' && i+1 < len(r) && r[i+1] >= '0' && r[i+1] <= '9':
			if i+2 < len(r) && r[i+2] >= '0' && r[i+2] <= '9' {
				panic(NotCompiled("REPLACE REGEX", "a replacement $nn of two digits is not measured: "+with))
			}
			b.WriteString(group(int(r[i+1] - '0')))
			i++
		case r[i] == '$' && i+1 < len(r) && r[i+1] == '&':
			b.WriteString(group(0))
			i++
		case r[i] == '$' || r[i] == '\\':
			panic(NotCompiled("REPLACE REGEX", "a replacement "+string(r[i:])+" is not measured"))
		default:
			b.WriteRune(r[i])
		}
	}
	return b.String()
}

// splice replaces the given matches of s (byte ranges, in order) with the
// replacement text of each.
func splice(s string, ms [][]int, with func(m []int) string) string {
	var b strings.Builder
	last := 0
	for _, m := range ms {
		b.WriteString(s[last:m[0]])
		b.WriteString(with(m))
		last = m[1]
	}
	b.WriteString(s[last:])
	return b.String()
}

// runeByte is the byte offset of the n-th character of s.
func runeByte(s string, n int) int {
	i := 0
	for k := 0; k < n; k++ {
		_, w := utf8.DecodeRuneInString(s[i:])
		i += w
	}
	return i
}

// ReplaceStmt is REPLACE [FIRST OCCURRENCE | ALL OCCURRENCES] OF [REGEX] p
// IN [SECTION [OFFSET off] [LENGTH ln] OF] v WITH with [IGNORING CASE], as
// measured on A4H: sy-subrc 0 when something was replaced, 4 when not; an
// empty plain pattern is inserted at the start by FIRST and raises
// CX_SY_REPLACE_INFINITE_LOOP with ALL (a c pattern of blanks is empty); a
// regex that matches empty replaces there (abc with x* is -a-b-c-); $n in
// WITH is literal without REGEX; a SECTION outside v raises
// CX_SY_RANGE_OUT_OF_BOUNDS. off is 0 and ln NoLength without a SECTION. cLen is
// the length of a c target, -1 for a string: the c field is searched with
// its trailing blanks (ab in a c(10), all blanks replaced, is ab--------),
// cut back to its length after, and a cut of more than blanks is
// sy-subrc 2.
func ReplaceStmt(v, p, with string, regex, all, icase bool, off, ln int32, cLen int) (string, int32) {
	if cLen >= 0 {
		v = PadC(v, cLen)
	}
	n := int32(utf8.RuneCountInString(v))
	if ln == NoLength {
		ln = n - off
	} else if ln < 0 {
		panic(NotCompiled("REPLACE", "a SECTION of negative LENGTH is not measured"))
	}
	if off < 0 || off > n || off+ln > n {
		rangeError()
	}
	b0, b1 := runeByte(v, int(off)), runeByte(v, int(off+ln))
	sec := v[b0:b1]
	var ms [][]int
	if regex {
		ms = rxAll(sec, p, icase, !all)
	} else {
		if p == "" && all {
			panic(ArithmeticError{"CX_SY_REPLACE_INFINITE_LOOP", "REPLACE ALL OCCURRENCES OF ''"})
		}
		ms = plainAll(sec, p, icase, !all)
	}
	if len(ms) == 0 {
		if cLen >= 0 {
			return strings.TrimRight(v, " "), 4
		}
		return v, 4
	}
	out := v[:b0] + splice(sec, ms, func(m []int) string {
		if regex {
			return rxWith(sec, with, m)
		}
		return with
	}) + v[b1:]
	if cLen >= 0 {
		if utf8.RuneCountInString(out) > cLen {
			cut := []rune(out)[cLen:]
			// only blanks cut is no cut (measured: ab in a c(4), a -> xxx, is
			// xxxb and sy-subrc 0)
			if strings.TrimRight(string(cut), " ") == "" {
				return CFit(out, cLen), 0
			}
			return CFit(out, cLen), 2
		}
		return strings.TrimRight(out, " "), 0
	}
	return out, 0
}

// ReplaceFn is replace( val sub|regex with occ ): occ 0 every occurrence,
// n > 0 the n-th, n < 0 the n-th from the end, one that does not exist
// leaves val alone; an empty sub raises CX_SY_STRG_PAR_VAL (measured).
func ReplaceFn(v, p, with string, regex bool, occ int32) string {
	if p == "" {
		if regex {
			panic(NotCompiled("replace( )", "an empty regex is not measured"))
		}
		panic(ArithmeticError{"CX_SY_STRG_PAR_VAL", "replace"})
	}
	var ms [][]int
	if regex {
		ms = rxAll(v, p, false, occ == 1)
	} else {
		ms = plainAll(v, p, false, occ == 1)
	}
	switch {
	case occ > 0 && int(occ) <= len(ms):
		ms = ms[occ-1 : occ]
	case occ < 0 && int(-occ) <= len(ms):
		ms = ms[len(ms)+int(occ) : len(ms)+int(occ)+1]
	case occ != 0:
		ms = nil
	}
	return splice(v, ms, func(m []int) string {
		if regex {
			return rxWith(v, with, m)
		}
		return with
	})
}

// Repeat is repeat( val occ ): a negative occ raises CX_SY_STRG_PAR_VAL.
func Repeat(v string, occ int32) string {
	if occ < 0 {
		panic(ArithmeticError{"CX_SY_STRG_PAR_VAL", "repeat"})
	}
	return strings.Repeat(v, int(occ))
}

// CondenseFn is condense( val del from to ), measured: the characters of
// del go from both ends first, then every run of characters of from becomes
// the first character of to (none when to is empty); an empty del strips
// nothing, an empty from joins nothing.
func CondenseFn(v, del, from, to string) string {
	v = strings.TrimFunc(v, func(r rune) bool { return strings.ContainsRune(del, r) })
	if from == "" {
		return v
	}
	rep := ""
	if to != "" {
		r, _ := utf8.DecodeRuneInString(to)
		rep = string(r)
	}
	var b strings.Builder
	in := false
	for _, r := range v {
		if strings.ContainsRune(from, r) {
			if !in {
				b.WriteString(rep)
			}
			in = true
			continue
		}
		in = false
		b.WriteRune(r)
	}
	return b.String()
}

// ShiftFn is shift_left / shift_right( val [places | circular | sub] ),
// measured: without an argument the blanks at that end go; places or
// circular beyond the length (or places below 0) raise
// CX_SY_RANGE_OUT_OF_BOUNDS; sub goes as often as it stands at that end.
// kind is "", "places", "circular" or "sub".
func ShiftFn(v string, left bool, kind string, n int32, sub string) string {
	r := []rune(v)
	l := int32(len(r))
	switch kind {
	case "":
		if left {
			return strings.TrimLeft(v, " ")
		}
		return strings.TrimRight(v, " ")
	case "places":
		if n < 0 || n > l {
			rangeError()
		}
		if left {
			return string(r[n:])
		}
		return string(r[:l-n])
	case "circular":
		if n < 0 {
			panic(NotCompiled("shift( )", "a negative circular is not measured"))
		}
		if n > l {
			rangeError()
		}
		if left {
			return string(r[n:]) + string(r[:n])
		}
		return string(r[l-n:]) + string(r[:l-n])
	}
	if sub == "" {
		panic(NotCompiled("shift( )", "an empty sub is not measured"))
	}
	for left && strings.HasPrefix(v, sub) {
		v = v[len(sub):]
	}
	for !left && strings.HasSuffix(v, sub) {
		v = v[:len(v)-len(sub)]
	}
	return v
}

// ToMixed is to_mixed( val [sep] [case] [min] ), measured: the first
// character as it is (upper with a case in upper case), every other one in
// lower case, except that a sep with at least min characters before it and
// one after it goes and the character after it is upper case (the one after
// is taken as it is, even a second sep: _a__b_ is _a_b_). hasCase says a
// case was given.
func ToMixed(v, sep string, hasCase bool, cs string, min int32) string {
	if utf8.RuneCountInString(sep) != 1 {
		panic(NotCompiled("to_mixed( )", "a sep that is not one character is not measured"))
	}
	if min < 1 {
		panic(NotCompiled("to_mixed( )", "a min below 1 is not measured"))
	}
	s, _ := utf8.DecodeRuneInString(sep)
	r := []rune(v)
	var b strings.Builder
	for i := 0; i < len(r); i++ {
		switch {
		case i == 0 && hasCase:
			c, _ := utf8.DecodeRuneInString(cs)
			if unicode.IsUpper(c) {
				b.WriteRune(unicode.ToUpper(r[0]))
			} else {
				b.WriteRune(unicode.ToLower(r[0]))
			}
		case i == 0:
			b.WriteRune(r[0])
		case r[i] == s && int32(i) >= min && i+1 < len(r):
			i++
			b.WriteRune(unicode.ToUpper(r[i]))
		default:
			b.WriteRune(unicode.ToLower(r[i]))
		}
	}
	return b.String()
}
