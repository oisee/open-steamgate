package crc32x

import "testing"

func TestCombineAcrossChunks(t *testing.T) {
	whole := Combine("", "123456789")
	chunked := Combine(Combine("", "1234"), "56789")
	if whole != chunked || len(whole) != 4 {
		t.Fatalf("chunked register %x differs from whole %x", chunked, whole)
	}
}
