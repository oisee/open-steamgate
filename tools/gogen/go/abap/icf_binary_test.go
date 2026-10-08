package abap

import (
	"net/http/httptest"
	"testing"
)

func TestRound3ICFBinary(t *testing.T) {
	x := &ICFExchange{}
	ICFResponseSend(nil, Data{P: x}, 200, "\xed\x00\xff")
	w := httptest.NewRecorder()
	x.Write(w, "GET")
	if got := w.Body.String(); got != "\xed\x00\xff" {
		t.Fatalf("binary body changed: %x", got)
	}
}
