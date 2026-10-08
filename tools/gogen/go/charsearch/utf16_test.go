package charsearch

import "testing"

func TestUTF16(t *testing.T) {
	if FindOcc("😀A😀A", "A", -1) != 5 {
		t.Fatal("occ")
	}
	if got := Reverse("😀A"); got != "A\xed\xb8\x80\xed\xa0\xbd" {
		t.Fatalf("reverse %x", got)
	}
}
