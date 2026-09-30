package abap

import "testing"

func TestDecodeXBase64(t *testing.T) {
	for _, tc := range []struct{ encoded, hex string }{
		{"YWJhcA==", "61626170"},
		{"YWJhcA", "61626170"},
		{"Y WJhcA==", "61626170"},
		{"--__", "FBEFFF"},
		{"Y@WJhcA==", "61626170"},
		{"abcde", "69B71D"},
		{"qrvM", "AABBCC"},
		{"/w==", "FF"},
		{"", ""},
	} {
		if got := XToHex(DecodeXBase64(&Session{}, tc.encoded)); got != tc.hex {
			t.Errorf("DecodeXBase64(%q) = %q, want %q", tc.encoded, got, tc.hex)
		}
	}
}
