package abap

import "strings"

// outsideClasses is a pattern with every bracket expression ([...]) and every
// escaped character taken out, so the checks for lazy quantifiers and (?...)
// groups look at the pattern's syntax only: in [^/(?] the ( and ? are two
// characters of a class, not the start of a group. A ] right after [ or [^
// belongs to the class, as in POSIX.
func outsideClasses(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		switch p[i] {
		case '\\':
			i++ // the escaped character is a literal
			b.WriteString("_")
		case '[':
			j := i + 1
			if j < len(p) && p[j] == '^' {
				j++
			}
			if j < len(p) && p[j] == ']' {
				j++
			}
			for j < len(p) && p[j] != ']' {
				if p[j] == '[' && j+1 < len(p) && (p[j+1] == ':' || p[j+1] == '.' || p[j+1] == '=') {
					// [:alpha:] and friends inside a class
					if k := strings.Index(p[j+2:], string(p[j+1])+"]"); k >= 0 {
						j += k + 4
						continue
					}
				}
				j++
			}
			i = j
			b.WriteString("_")
		default:
			b.WriteByte(p[i])
		}
	}
	return b.String()
}
