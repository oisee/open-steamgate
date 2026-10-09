// Package abapsite finds where a panic began in ABAP source: the generated
// code carries line directives, so a Go stack names ABAP files and lines.
package abapsite

import "strings"

// Site is the first ABAP file:line of a Go stack (debug.Stack(), or the
// stack of the first panic a TRY kept); "" when no frame is ABAP source.
func Site(stack string) string {
	for _, l := range strings.Split(stack, "\n") {
		l = strings.TrimSpace(l)
		if i := strings.Index(l, ".abap:"); i > 0 {
			if j := strings.IndexAny(l[i:], " +"); j > 0 {
				l = l[:i+j]
			}
			return l[strings.LastIndex(l, "/")+1:]
		}
	}
	return ""
}
