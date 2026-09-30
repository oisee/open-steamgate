package abap

import "testing"

func TestDecodeXBase64(t *testing.T) {
	for _, tc := range []struct{ encoded, hex string }{
		{"YWJhcA==", "61626170"},
		{"qrvM", "AABBCC"},
		{"/w==", "FF"},
		{"", ""},
	} {
		if got := XToHex(DecodeXBase64(&Session{}, tc.encoded)); got != tc.hex {
			t.Errorf("DecodeXBase64(%q) = %q, want %q", tc.encoded, got, tc.hex)
		}
	}
}
