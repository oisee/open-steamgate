package abap

import (
	"strings"
	"testing"
)

func TestRound3KoreanFastPath(t *testing.T) {
	v := "퀀" + strings.Repeat("a", 1<<20)
	if n := testing.AllocsPerRun(20, func() { benchUTF16String = JoinSurrogates(v) }); n != 0 {
		t.Fatalf("valid Korean canonicalization allocated %g times", n)
	}
}
func TestRound3SupplementaryFold(t *testing.T) {
	for _, v := range []string{"𐐨가", "𐐨퀀", "\xed\xa0\xbd𐐨가"} {
		want := strings.ReplaceAll(v, "𐐨", "𐐀")
		if got := ToUpper(v); got != want {
			t.Errorf("ToUpper(%x)=%x, want %x", v, got, want)
		}
		if got := ToLower(want); got != v {
			t.Errorf("ToLower(%x)=%x, want %x", want, got, v)
		}
	}
}

func TestCanonOnlyJoinsAdjacentHalves(t *testing.T) {
	hi, lo := "\xed\xa0\xbd", "\xed\xb8\x80"
	for _, v := range []string{hi, lo, lo + hi, hi + "X" + lo, "퀀", "\xed\x00\xff"} {
		if got := Canon(v); got != v {
			t.Fatalf("Canon(%x)=%x", v, got)
		}
		if n := testing.AllocsPerRun(10, func() { benchUTF16String = Canon(v) }); n != 0 {
			t.Fatalf("unchanged %x allocated %g", v, n)
		}
	}
	if got := Canon(hi + lo + hi + lo); got != "😀😀" {
		t.Fatalf("pairs: %x", got)
	}
}
