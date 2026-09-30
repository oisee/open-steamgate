package abap

import (
	"regexp"
	"testing"
)

// crypto.randomUUID()'s shape: lower-case hex, hyphens at 8-4-4-4-12,
// version nibble 4, variant 8, 9, a or b.
var uuidV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestUUIDRandomShape(t *testing.T) {
	s := &Session{}
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		u := UUIDRandom(s)
		if !uuidV4.MatchString(u) {
			t.Fatalf("UUIDRandom = %q, not a v4 UUID as crypto.randomUUID gives it", u)
		}
		if seen[u] {
			t.Fatalf("UUIDRandom repeated %q", u)
		}
		seen[u] = true
	}
}
