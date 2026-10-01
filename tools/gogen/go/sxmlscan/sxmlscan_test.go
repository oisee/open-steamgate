package sxmlscan

import "testing"

func TestByteOffsetsAndUtf8Text(t *testing.T) {
	if got := NameEnd("é:name >", 0); got != 7 {
		t.Fatalf("name end byte offset: %d", got)
	}
	if got := SpaceEnd(" \t\r\n<tag", 0); got != 4 {
		t.Fatalf("space end byte offset: %d", got)
	}
	if got, ok := Utf8Text("é"); !ok || got != "é" {
		t.Fatalf("valid UTF-8: %q %t", got, ok)
	}
	if _, ok := Utf8Text("\xef\xbb\xbftext"); ok {
		t.Fatal("BOM accepted")
	}
	if _, ok := Utf8Text("\xff"); ok {
		t.Fatal("invalid UTF-8 accepted")
	}
}
