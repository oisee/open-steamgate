// Package nodehdr implements Node IncomingMessage duplicate header joining.
package nodehdr

// FirstWins names headers for which Node keeps the first value.
var FirstWins = map[string]bool{"age": true, "authorization": true, "content-length": true, "content-type": true, "etag": true,
	"expires": true, "from": true, "host": true, "if-modified-since": true, "if-unmodified-since": true, "last-modified": true,
	"location": true, "max-forwards": true, "proxy-authorization": true, "referer": true, "retry-after": true, "server": true, "user-agent": true}

// Merge joins a repeated lower-case header name. Set-Cookie is represented
// as an array by Node; the callers handle that case separately.
func Merge(name, old, next string) string {
	if FirstWins[name] {
		return old
	}
	if name == "cookie" {
		return old + "; " + next
	}
	return old + ", " + next
}
