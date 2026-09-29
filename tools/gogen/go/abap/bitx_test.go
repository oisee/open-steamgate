package abap

import "testing"

// xor_int of rotozoom on A4H 2026-09-23: x1 = a MOD 256, BIT-XOR, back to i.
func TestXorIntA4H(t *testing.T) {
	xor := func(a, b int32) int32 {
		return XToI(BitX("BIT-XOR", IToX(ModI(a, 256), 1), IToX(ModI(b, 256), 1)))
	}
	for _, c := range [][3]int32{{5, 3, 6}, {200, 55, 255}, {255, 0, 255}, {300, 1, 45}, {-1, 0, 255}, {-3, 7, 250}} {
		if got := xor(c[0], c[1]); got != c[2] {
			t.Errorf("xor(%d, %d) = %d, A4H %d", c[0], c[1], got, c[2])
		}
	}
	for _, c := range []struct {
		i    int32
		hex  string
		back int32
	}{{128, "80", 128}, {255, "FF", 255}, {256, "00", 0}, {-1, "FF", 255}, {300, "2C", 44}} {
		x := IToX(c.i, 1)
		if XToHex(x) != c.hex || XToI(x) != c.back {
			t.Errorf("%d -> %s:%d, A4H %s:%d", c.i, XToHex(x), XToI(x), c.hex, c.back)
		}
	}
}
