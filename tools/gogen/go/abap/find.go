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
	// ^ and $ are the start and end of a line (measured: FIND REGEX `^b`
	// IN |a\nb| finds it), so the pattern compiles multi-line
	key := "(?m)" + p
	if icase {
		key = "(?mi)" + p
	}
	if r, ok := regexCache.Load(key); ok {
		return r.(*regexp.Regexp)
	}
	if strings.Contains(p, "*?") || strings.Contains(p, "+?") || strings.Contains(p, "??") {
		panic(ArithmeticError{"CX_SY_INVALID_REGEX", p})
	}
	if strings.Contains(strings.ReplaceAll(p, "(?:", ""), "(?") {
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
