package abap

import (
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"
)

var regexCache sync.Map

// FindStmt is FIND [REGEX] p IN s, as measured on A4H 2026-09-23: POSIX, so the
// leftmost-longest match (a|ab in xab is ab); offsets and lengths in
// characters; n submatches, a group that did not take part (or that does
// not exist) gives the empty string. A non-greedy quantifier raises
// INVALID_REGEX, as the kernel does; a non-capturing group (?:...) is
// accepted, as it is there (both measured). Lookahead (?= (?! is valid on a
// system too, and Go's regexp has none: that dumps as not compiled rather
// than calling a valid pattern invalid.
func FindStmt(s, p string, regex, icase bool, n int) (bool, int32, int32, []string) {
	subs := make([]string, n)
	if !regex {
		// an empty substring is found at the start, length 0 (A4H
		// 2026-09-24, ZCL_GOGEN_T_FINDSEC x1 x2: 0/0/0)
		if p == "" {
			return true, 0, 0, subs
		}
		hay, needle := s, p
		if icase {
			hay, needle = strings.ToUpper(s), strings.ToUpper(p)
		}
		i := strings.Index(hay, needle)
		if i < 0 {
			return false, 0, 0, subs
		}
		return true, int32(utf8.RuneCountInString(s[:i])), int32(utf8.RuneCountInString(p)), subs
	}
	re := compileABAP(p, icase)
	checkLines(p, s, "FIND REGEX")
	m := re.FindStringSubmatchIndex(s)
	if m == nil {
		return false, 0, 0, subs
	}
	for i := 0; i < n; i++ {
		if 2*(i+1)+1 < len(m) && m[2*(i+1)] >= 0 {
			subs[i] = s[m[2*(i+1)]:m[2*(i+1)+1]]
		}
	}
	return true, int32(utf8.RuneCountInString(s[:m[0]])), int32(utf8.RuneCountInString(s[m[0]:m[1]])), subs
}

func compileABAP(p string, icase bool) *regexp.Regexp {
	// ^ and $ are the start and end of a line and . is any character, \n
	// included (measured on A4H 2026-09-23: FIND REGEX `^b` IN |a\nb| finds
	// it, . matches \r and \n), so the pattern compiles multi-line and
	// dot-all. Lines end at \n only here; see checkLines for the rest.
	key := "(?ms)" + p
	if icase {
		key = "(?msi)" + p
	}
	if r, ok := regexCache.Load(key); ok {
		return r.(*regexp.Regexp)
	}
	syntax := outsideClasses(p)
	if strings.Contains(syntax, "*?") || strings.Contains(syntax, "+?") || strings.Contains(syntax, "??") {
		panic(ArithmeticError{"CX_SY_INVALID_REGEX", p})
	}
	if strings.Contains(strings.ReplaceAll(syntax, "(?:", ""), "(?") {
		panic(NotCompiled("FIND REGEX", "a (?...) group other than (?:...) is not in Go's regexp: "+p))
	}
	re, err := regexp.Compile(key)
	if err != nil {
		panic(ArithmeticError{"CX_SY_INVALID_REGEX", p})
	}
	re.Longest()
	regexCache.Store(key, re)
	return re
}

// lineAnchors says whether p has a ^ or a $ that is an anchor: not escaped
// and not inside a bracket expression ([^...] is a negation, [$] a dollar).
func lineAnchors(p string) bool {
	r := []rune(p)
	for i := 0; i < len(r); i++ {
		switch r[i] {
		case '\\':
			i++
		case '^', '$':
			return true
		case '[':
			i++
			if i < len(r) && r[i] == '^' {
				i++
			}
			if i < len(r) && r[i] == ']' {
				i++
			}
			for ; i < len(r) && r[i] != ']'; i++ {
				if r[i] == '[' && i+1 < len(r) && (r[i+1] == ':' || r[i+1] == '=' || r[i+1] == '.') {
					end := r[i+1]
					for i += 2; i+1 < len(r) && !(r[i] == end && r[i+1] == ']'); i++ {
					}
					i++
				}
			}
		}
	}
	return false
}

// checkLines refuses an anchored pattern on a text with a line end other
// than \n. Measured on A4H 2026-09-23 (a X b): with X = \n, ^ is at 0 and 2
// and $ at 1 and 3, as here; with X = \r, U+2028 or U+2029, $ is also at 1
// but ^ only at 0; with X = \r\n, $ is at 1 and 4 and not at 2; and a\n\rb
// has ^ at 3, after the \r. Go's (?m) knows \n alone and has no lookaround
// to say the rest, so that is a NOT_COMPILED, not a guess. \f, \v and U+0085
// end no line there, nor here.
func checkLines(p, s, where string) {
	if strings.ContainsAny(s, "\r\u2028\u2029") && lineAnchors(p) {
		panic(NotCompiled(where, "^ or $ in a text with a line end other than \\n is not measured: "+p))
	}
}

// FindSection is FIND p IN SECTION [OFFSET off] [LENGTH n] OF s for a
// substring (not a regex), measured on A4H 2026-09-24 (ZCL_GOGEN_T_FINDSEC):
// the match offset counts from the start of s; an offset below 0 or past the
// end, a length below -1, or a section past the end raise
// CX_SY_RANGE_OUT_OF_BOUNDS; a length of -1 is the rest of s, as if none
// were given (measured: -1 finds, -3 raises); an offset at the end is an
// empty section, where only an empty pattern is found (at the offset,
// length 0). A match must lie inside the section.
func FindSection(s, p string, icase bool, off, n int32, nsub int) (bool, int32, int32, []string) {
	// the section by byte index, walked to once: no []rune of the whole
	// text per call (a loop of FIND ... SECTION OFFSET over a long text was
	// quadratic in allocations, 45 s of an ImportSet in ZCL_STG_SADL_DEF)
	if off < 0 || n < -1 {
		rangeError()
	}
	var from, to int
	if isASCII(s) {
		if int(off) > len(s) || (n >= 0 && int(off+n) > len(s)) {
			rangeError()
		}
		from, to = int(off), len(s)
		if n >= 0 {
			to = int(off + n)
		}
	} else if m := memoOf(s); m != nil {
		if int(off) > m.runes || (n >= 0 && int(off+n) > m.runes) {
			rangeError()
		}
		from, to = m.byteAt(s, int(off)), len(s)
		if n >= 0 {
			to = m.byteAt(s, int(off+n))
		}
	} else {
		var ok bool
		if from, ok = charsToByte(s, 0, int(off)); !ok {
			rangeError()
		}
		to = len(s)
		if n >= 0 {
			if to, ok = charsToByte(s, from, int(n)); !ok {
				rangeError()
			}
		}
	}
	found, o, l, subs := FindStmt(s[from:to], p, false, icase, nsub)
	if !found {
		return false, 0, 0, subs
	}
	return true, off + o, l, subs
}

// charsToByte is the byte index k characters after byte index from in s;
// false when s ends before that.
func charsToByte(s string, from, k int) (int, bool) {
	i := from
	for ; k > 0 && i < len(s); k-- {
		if s[i] < utf8.RuneSelf {
			i++
			continue
		}
		_, w := utf8.DecodeRuneInString(s[i:])
		i += w
	}
	return i, k == 0
}

// FindTable is FIND [REGEX] p IN TABLE itab (rows of strings), measured on
// A4H 2026-09-24 (ZCL_GOGEN_T_FINDSEC q..w2): each row on its own (no match
// across rows), the first row with a match wins; its line (from 1), offset,
// length and submatches, as FindStmt gives them for that row. An empty table
// is not found. An empty substring pattern is not measured here and dumps.
func FindTable(rows []string, p string, regex, icase bool, nsub int) (bool, int32, int32, int32, []string) {
	if !regex && p == "" {
		panic(NotCompiled("FIND IN TABLE", "an empty pattern in a table is not measured"))
	}
	for i, row := range rows {
		if ok, o, l, subs := FindStmt(row, p, regex, icase, nsub); ok {
			return true, int32(i + 1), o, l, subs
		}
	}
	return false, 0, 0, 0, make([]string, nsub)
}

// FindResults is FIND [FIRST OCCURRENCE OF | ALL OCCURRENCES OF] [REGEX |
// PCRE] p IN s [IGNORING CASE] RESULTS (parity-wave2), measured on A4H
// 2026-09-25 (ZCL_GOGEN_T_FINDRES, ZCL_GOGEN_T_FINDPCRE): each match as
// offset, length, then offset and length of every group, in characters; a
// group that did not take part is -1, 0. kind is 0 (a substring), 'R'
// (REGEX: POSIX, leftmost-longest: a|ab takes ab) or 'P' (PCRE,
// leftmost-first: a|ab takes a; lazy quantifiers allowed). ALL goes on
// after a match at its end, and after an empty match one character on, so
// empty matches are found, one at the end of the text too: x* in abc is
// 0,0 1,0 2,0 3,0 and b* in abbc is 0,0 1,2 3,0 4,0 (both engines).
// A substring does not overlap its matches (aa in aaaaa: 0 and 2).
func FindResults(s, p string, kind byte, icase, all bool) [][]int32 {
	if p == "" {
		panic(NotCompiled("FIND ... RESULTS", "an empty pattern is not measured"))
	}
	var re, after *regexp.Regexp
	switch kind {
	case 0:
		if !icase {
			return plainResults(s, p, all)
		}
		re, after = compileABAP(regexp.QuoteMeta(p), true), compileABAPAfter(regexp.QuoteMeta(p), true)
	case 'R':
		re = compileABAP(p, icase)
		checkLines(p, s, "FIND REGEX")
		after = compileABAPAfter(p, icase)
	case 'P':
		re, after = compilePCRE(p, icase, s)
	default:
		panic(NotCompiled("FIND ... RESULTS", "a search kind "+string(kind)))
	}
	var out [][]int32
	chars := func(b int) int32 { return int32(utf8.RuneCountInString(s[:b])) }
	for pos := 0; pos <= len(s); {
		var m []int
		if pos == 0 {
			m = re.FindStringSubmatchIndex(s)
		} else {
			// a match that starts at pos or later, the character before in view
			_, w := utf8.DecodeLastRuneInString(s[:pos])
			base := pos - w
			if m2 := after.FindStringSubmatchIndex(s[base:]); m2 != nil {
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
		r := make([]int32, 0, len(m))
		for g := 0; g+1 < len(m); g += 2 {
			if m[g] < 0 {
				r = append(r, -1, 0)
				continue
			}
			o := chars(m[g])
			r = append(r, o, chars(m[g+1])-o)
		}
		out = append(out, r)
		if !all {
			break
		}
		if m[1] > m[0] {
			pos = m[1]
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

func plainResults(s, p string, all bool) [][]int32 {
	var out [][]int32
	n := int32(utf8.RuneCountInString(p))
	for pos := 0; pos <= len(s); {
		i := strings.Index(s[pos:], p)
		if i < 0 {
			break
		}
		out = append(out, []int32{int32(utf8.RuneCountInString(s[:pos+i])), n})
		if !all {
			break
		}
		pos += i + len(p)
	}
	return out
}

// pcreRefused are the PCRE constructs Go's RE2 does not have: refused by
// name rather than read as something else
var pcreRefused = []struct {
	re   *regexp.Regexp
	what string
}{
	{regexp.MustCompile(`\(\?=`), "a lookahead (?=...)"},
	{regexp.MustCompile(`\(\?!`), "a negative lookahead (?!...)"},
	{regexp.MustCompile(`\(\?<=`), "a lookbehind (?<=...)"},
	{regexp.MustCompile(`\(\?<!`), "a negative lookbehind (?<!...)"},
	{regexp.MustCompile(`\(\?>`), "an atomic group (?>...)"},
	{regexp.MustCompile(`\\[1-9]|\\g\{?-?\d|\\k[<{']`), "a backreference"},
	{regexp.MustCompile(`[*+?}]\+`), "a possessive quantifier"},
	{regexp.MustCompile(`\\K`), "\\K"},
	{regexp.MustCompile(`\\G`), "\\G"},
	{regexp.MustCompile(`\(\?(R|\d|&|P>|\()`), "a recursion or a conditional"},
	{regexp.MustCompile(`\(\*`), "a verb (*...)"},
	{regexp.MustCompile(`\\[cexoNXRhHvV]`), "an escape RE2 reads differently or not at all"},
}

// compilePCRE is the pattern for PCRE, leftmost-first, and its "after"
// form (see compileABAPAfter). PCRE's own ^ $ and . around line ends are
// not measured, so a text with \n or \r is refused; a construct RE2 lacks
// is refused by name; a pattern RE2 cannot read is not called invalid.
func compilePCRE(p string, icase bool, s string) (*regexp.Regexp, *regexp.Regexp) {
	plain := strings.NewReplacer(`\\`, "").Replace(p)
	for _, r := range pcreRefused {
		if r.re.MatchString(plain) {
			panic(NotCompiled("FIND PCRE", r.what+" is not in Go's RE2: "+p))
		}
	}
	if strings.ContainsAny(s, "\n\r") {
		panic(NotCompiled("FIND PCRE", "a text with line ends: PCRE's ^ $ and . around them are not measured"))
	}
	flags := ""
	if icase {
		flags = "(?i)"
	}
	key := "pcre" + flags + "\x00" + p
	if r, ok := regexCache.Load(key); ok {
		a, _ := regexCache.Load("after-" + key)
		return r.(*regexp.Regexp), a.(*regexp.Regexp)
	}
	re, err := regexp.Compile(flags + p)
	if err != nil {
		panic(NotCompiled("FIND PCRE", "RE2 does not read this pattern ("+err.Error()+"); whether PCRE does is not measured"))
	}
	after := regexp.MustCompile(flags + "(?s:.)(" + p + ")")
	regexCache.Store(key, re)
	regexCache.Store("after-"+key, after)
	return re, after
}
