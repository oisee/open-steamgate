package abap

import "testing"

func TestRound3JoinInvariant(t *testing.T) {
	hi, lo := SubS("😀", 0, 1), SubS("😀", 1, 1)
	for name, f := range map[string]func() string{
		"lines":   func() string { return ConcatLinesOf([]string{hi, lo}, "") },
		"replace": func() string { return ReplaceFn(hi+"X"+lo, "X", "", false, 1) },
		"pad":     func() string { return Pad(lo, 2, "RIGHT", hi) },
		"repeat":  func() string { return Repeat(lo+hi, 2) },
	} {
		t.Run(name, func(t *testing.T) {
			v := f()
			if v != JoinSurrogates(v) {
				t.Fatalf("noncanonical result: %x", v)
			}
		})
	}
	v := ConcatLinesOf([]string{hi, lo}, "")
	keys := map[string]bool{v: true}
	if !keys["😀"] {
		t.Error("hash equality disagrees with emoji")
	}
	if v != "😀" {
		t.Errorf("raw equality: %x", v)
	}
}
