package nodeutf8

import "testing"

func TestDecodeMatchesNode(t *testing.T) {
	for in, want := range map[string]string{
		"abap":         "abap",
		"\xc3\xa4":     "\u00e4",
		"\xe4\xf6":     "\ufffd\ufffd",
		"\xed\xa0\x80": "\ufffd\ufffd\ufffd",
		"\xe4\xb8":     "\ufffd",
		"\xf0\x9f\x98": "\ufffd",
		"\xc0\xaf":     "\ufffd\ufffd",
		"a\xffb":       "a\ufffdb",
	} {
		if got := Decode(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}
