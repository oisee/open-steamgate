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
		if p == "" {
			return false, 0, 0, subs
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
