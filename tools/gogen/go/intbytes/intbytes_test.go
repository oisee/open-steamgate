package intbytes

import (
	"encoding/hex"
	"math"
	"strings"
	"testing"
)

func TestOracle(t *testing.T) {
	for _, c := range []struct {
		v   int64
		n   int
		hex string
	}{
		{-2, 8, "fffffffffffffffe"},
		{-1, 8, "ffffffffffffffff"},
		{0, 8, "0000000000000000"},
		{math.MinInt64, 8, "8000000000000000"},
		{math.MaxInt64, 8, "7fffffffffffffff"},
		{72623859790382856, 2, "0708"},
		{72623859790382856, 8, "0102030405060708"},
		{72623859790382856, 4, "05060708"},
		{72623859790382856, 16, "00000000000000000102030405060708"},
		{-2, 16, "0000000000000000fffffffffffffffe"},
	} {
		if got := hex.EncodeToString([]byte(ToX(c.v, 8, c.n))); got != c.hex {
			t.Errorf("ToX(%d, 8, %d) = %s, want %s", c.v, c.n, got, c.hex)
		}
		if c.n >= 8 && FromX(ToX(c.v, 8, c.n), 8) != c.v {
			t.Errorf("oracle round trip %d at width %d", c.v, c.n)
		}
	}
}

func TestWidthsAndBoundaries(t *testing.T) {
	widths := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 32, 1024}
	for _, width := range []int{4, 8} {
		values := []int64{-2, -1, 0, 1, math.MinInt32, math.MaxInt32}
		if width == 8 {
			values = append(values, math.MinInt64, math.MaxInt64, 72623859790382856)
		}
		for _, v := range values {
			full := ToX(v, width, width)
			for _, n := range widths {
				want := full
				if n < width {
					want = full[width-n:]
				} else {
					want = strings.Repeat("\x00", n-width) + full
				}
				if got := ToX(v, width, n); got != want {
					t.Errorf("ToX(%d, %d, %d) = %x, want %x", v, width, n, got, want)
				}
				if n >= width && FromX(want, width) != v {
					t.Errorf("round trip %d width %d n %d", v, width, n)
				}
			}
		}
	}
}

func TestByteSources(t *testing.T) {
	for _, c := range []struct {
		hex   string
		width int
		want  int64
	}{
		{"", 8, 0}, {"ff", 8, 255}, {"ffff", 8, 65535},
		{"ffffffffffffff", 8, 72057594037927935},
		{"ffffffffffffffff", 8, -1}, {"8000000000000000", 8, math.MinInt64},
		{"018000000000000000", 8, math.MinInt64},
		{"ffffffffffffffffffffffffffffffff", 8, -1},
		{"", 4, 0}, {"ff", 4, 255}, {"ffff", 4, 65535},
		{"ffffff", 4, 16777215}, {"ffffffff", 4, -1},
		{"80000000", 4, math.MinInt32}, {"0100000002", 4, 2},
	} {
		b, err := hex.DecodeString(c.hex)
		if err != nil {
			t.Fatal(err)
		}
		if got := FromX(string(b), c.width); got != c.want {
			t.Errorf("FromX(%s, %d) = %d, want %d", c.hex, c.width, got, c.want)
		}
	}
}

func TestXstrings(t *testing.T) {
	for _, width := range []int{4, 8} {
		for _, v := range []int64{-2, -1, 1, 255, 256, 65535, 65536, 16777216, math.MaxInt32} {
			got := ToString(v, width)
			if FromX(got, width) != v || (v > 0 && got[0] == 0) || (v < 0 && len(got) != width) {
				t.Errorf("ToString(%d, %d) = %x", v, width, got)
			}
		}
	}
	if got := ToString(math.MaxInt64, 8); len(got) != 8 || FromX(got, 8) != math.MaxInt64 {
		t.Errorf("max int8 = %x", got)
	}
	for _, c := range []struct {
		v     int64
		width int
		hex   string
	}{
		{0, 4, "00"}, {0, 8, "00"}, {0, 1, "00"}, {255, 1, "ff"},
		{0, 2, "00"}, {32767, 4, "7fff"}, {-32768, 4, "ffff8000"},
		{1 << 32, 8, "0100000000"}, {1 << 40, 8, "010000000000"},
		{1 << 48, 8, "01000000000000"}, {-1, 4, "ffffffff"}, {-1, 8, "ffffffffffffffff"},
	} {
		if got := hex.EncodeToString([]byte(ToString(c.v, c.width))); got != c.hex {
			t.Errorf("ToString(%d, %d) = %s, want %s", c.v, c.width, got, c.hex)
		}
	}
}
