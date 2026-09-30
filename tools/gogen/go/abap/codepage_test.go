package abap

import "testing"

func TestDecodeISO88591XML(t *testing.T) {
	input := "<?xml version=\"1.0\" encoding=\"iso-8859-1\"?><a>caf\xe9 \x80</a>"
	want := "<?xml version=\"1.0\" encoding=\"iso-8859-1\"?><a>café €</a>"
	if got := DecodeText("iso-8859-1", false, input); got != want {
		t.Fatalf("DecodeText = %q, want %q", got, want)
	}
}
