package abap

import (
	"math/rand"
	"strings"
	"testing"
)

// substring( ) of a long non-ASCII string, walked forward, backward and at
// random, agrees with the runes: the cursor is a shortcut, never an answer
func TestSubSCursorAgreesWithRunes(t *testing.T) {
	v := strings.Repeat("aä€𝄞b", 400)
	r := []rune(v)
	check := func(k int) {
		if got, want := SubS(v, int32(k), 1), string(r[k]); got != want {
			t.Fatalf("char %d: %q, want %q", k, got, want)
		}
	}
	for k := 0; k < len(r); k++ {
		check(k)
	}
	for k := len(r) - 1; k >= 0; k-- {
		check(k)
	}
	rnd := rand.New(rand.NewSource(1))
	for i := 0; i < 5000; i++ {
		check(rnd.Intn(len(r)))
	}
}
