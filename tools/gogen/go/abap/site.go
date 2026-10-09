package abap

import (
	"runtime/debug"
	"strings"
)

// SourceSite is the ABAP file:line where the panic r began: the first
// frame of the stack that is ABAP source (the generated code carries line
// directives), from the stack of the first panic when a TRY passed it on.
// Call it inside the recovering deferred function; "" when no ABAP frame.
func SourceSite(r any) string {
	st := string(debug.Stack())
	if w, ok := r.(*Rethrown); ok {
		st = w.Stack
	}
	for _, l := range strings.Split(st, "\n") {
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
