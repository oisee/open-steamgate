package intpower

import (
	"math/big"
	"osg/gogen/abaperr"
	"testing"
)

func TestPowers(t *testing.T) {
	for e := int32(0); e < 31; e++ {
		if got := Integer(int32(2), e); got != int32(1)<<e {
			t.Fatalf("2^%d: %d", e, got)
		}
	}
	if Integer(int64(2), 62) != int64(1)<<62 {
		t.Fatal("int8 precision")
	}
	if Integer(int32(-2), 31) != -2147483648 {
		t.Fatal("signed boundary")
	}
	if Integer(int64(-2), 63) != -9223372036854775808 {
		t.Fatal("int8 signed boundary")
	}
	if Integer(int32(0), 0) != 1 {
		t.Fatal("0^0")
	}
	if Integer(int32(1), 2147483647) != 1 {
		t.Fatal("large exponent")
	}
}
func TestOverflow(t *testing.T) {
	for _, run := range []func(){func() { Integer(int32(2), 31) }, func() { Integer(int64(2), 63) }} {
		func() {
			defer func() {
				err, ok := recover().(abaperr.ArithmeticError)
				if !ok || err.Class != "CX_SY_ARITHMETIC_OVERFLOW" {
					t.Fatalf("want overflow, got %v", err)
				}
			}()
			run()
		}()
	}
}
func TestNegativeRefused(t *testing.T) {
	defer func() {
		err, ok := recover().(abaperr.ArithmeticError)
		if !ok || err.Class != "NOT_COMPILED" {
			t.Fatalf("want refusal, got %v", err)
		}
	}()
	Integer(int32(2), -1)
}

func TestBoolx(t *testing.T) {
	for _, row := range []struct {
		value string
		bit   int32
		want  string
	}{{"X", 1, "\x80"}, {"X", 8, "\x01"}, {"X", 9, "\x00\x80"}, {" ", 9, ""}, {"X", 0, ""}, {"X", -9, "\xff\x80"}} {
		if got := Boolx(row.value, row.bit); got != row.want {
			t.Fatalf("%+v got %x", row, got)
		}
	}
}

func TestPackedUsesExactMultiplication(t *testing.T) {
	// A callback carrying rational values exercises exponentiation's schedule
	// without depending on the ABAP host package.
	calls := 0
	got := Packed("2", 5, func(a, b string) string {
		calls++
		x, _ := new(big.Int).SetString(a, 10)
		y, _ := new(big.Int).SetString(b, 10)
		return new(big.Int).Mul(x, y).String()
	})
	if got != "32" || calls != 4 {
		t.Fatalf("got %s in %d calls", got, calls)
	}
	if Packed("0", 0, nil) != "1" {
		t.Fatal("zero exponent should not multiply")
	}
}
