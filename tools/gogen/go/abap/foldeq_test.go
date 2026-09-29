package abap

import (
	"strings"
	"testing"
)

// foldEq must be strings.EqualFold of one character each (CP's comparison)
func TestFoldEq(t *testing.T) {
	for a := rune(0); a < 0x2200; a++ {
		for _, b := range []rune{a, a + 1, a - 1, a + 32, a - 32, 'k', 'K', 0x212A, 's', 'S', 0x17F, 0x3C3, 0x3C2, 0x3A3} {
			if got, want := foldEq(a, b), strings.EqualFold(string(a), string(b)); got != want {
				t.Fatalf("%U %U: %v, EqualFold %v", a, b, got, want)
			}
		}
	}
}
