package shiftleft

import "testing"

func TestLeading(t *testing.T) {
	if got := Leading("00042", "0"); got != "42" { t.Fatalf("got %q", got) }
}
