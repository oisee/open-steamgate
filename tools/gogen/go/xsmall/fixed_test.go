package xsmall

import (
	"osg/gogen/abap"
	"testing"
)

func TestIntegerAndFitContract(t *testing.T) {
	for n := 1; n <= 8; n++ {
		for _, v := range []int32{-2147483648, -65537, -256, -2, -1, 0, 1, 127, 128, 255, 256, 65536, 2147483647} {
			var b [8]byte
			FromInt(b[:n], v)
			want := abap.IToX(v, n)
			if string(b[:n]) != want || Int(b[:n]) != abap.XToI(want) {
				t.Fatalf("width %d, integer %d: %x", n, v, b[:n])
			}
		}
		for _, value := range []string{"", "\xff", "\x01\x02\x03\x04\x05\x06\x07\x08\x09"} {
			var b [8]byte
			for i := range b {
				b[i] = 255
			}
			Set(b[:n], value)
			if string(b[:n]) != abap.XFit(value, n) {
				t.Fatalf("fit width %d: %x", n, b[:n])
			}
		}
	}
}
