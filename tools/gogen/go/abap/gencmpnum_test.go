package abap

import "testing"

func gt(v string) Data              { return Data{P: &v, T: TT} }
func gnn(v string) Data             { return Data{P: &v, T: TN(len(v))} }
func gpn(v string, n, dec int) Data { return Data{P: &v, T: TP(n, dec)} }

// The facts of A4H, 2026-09-30 (ZCL_OSD_T_CMP, generic a TYPE any against
// b TYPE any). want is the sign of CmpData(a, b); both orders are checked.
func TestCmpDataA4HFacts(t *testing.T) {
	cases := []struct {
		name string
		a, b Data
		want int
	}{
		// numeric with character: converted to the numeric operand's type
		{"i5 = c'5'", gi(5), gc("5"), 0},
		{"i5 = c'5.0'", gi(5), gc("5.0"), 0},
		{"i5 = c' 5'", gi(5), gc(" 5"), 0},
		{"p5.00 = s'5'", gp("5.00"), gs("5"), 0},
		{"f5 = c'5'", gf(5), gc("5"), 0},
		{"i9 < c'10'", gi(9), gc("10"), -1},
		{"i5 = s'4.9' (rounded to i)", gi(5), gs("4.9"), 0},
		{"i0 = c''", gi(0), gc(""), 0},
		// n with character and with n: as numbers
		{"n'0005' = c'5'", gnn("0005"), gc("5"), 0},
		{"n'0005' = s'0005'", gnn("0005"), gs("0005"), 0},
		{"n'0005' = n'000005'", gnn("0005"), gnn("000005"), 0},
		{"n'09' < c'10'", gnn("09"), gc("10"), -1},
		// f with int8 and p: as f; int8 with p exact
		{"f 2^53 = int8 2^53+1", gf(9007199254740992), gi8(9007199254740993), 0},
		{"f 2^53 = p 2^53+1", gf(9007199254740992), gpn("9007199254740993", 16, 0), 0},
		{"int8 2^53+1 > p 2^53", gi8(9007199254740993), gpn("9007199254740992", 16, 0), 1},
		// x with numbers: the field converted to the numeric type
		{"x'10' = i16", gx("\x10", 1), gi(16), 0},
		{"x'10' > i10", gx("\x10", 1), gi(10), 1},
		{"x'0010' = i16", gx("\x00\x10", 2), gi(16), 0},
		{"x(4)'00000010' = i16", gx("\x00\x00\x00\x10", 4), gi(16), 0},
		{"x(8)'..10' = int8 16", gx("\x00\x00\x00\x00\x00\x00\x00\x10", 8), gi8(16), 0},
		{"x(8)'0100000000000010' > int8 16", gx("\x01\x00\x00\x00\x00\x00\x00\x10", 8), gi8(16), 1},
		{"x(1)'10' = int8 16", gx("\x10", 1), gi8(16), 0},
		{"xstring'10' = i16", gxs("\x10"), gi(16), 0},
		{"x'10' = n'16'", gx("\x10", 1), gnn("16"), 0},
		{"x'0010' = p16", gx("\x00\x10", 2), gpn("16", 8, 0), 0},
		{"x'0010' = f16", gx("\x00\x10", 2), gf(16), 0},
		{"x'0010' = p16.00", gx("\x00\x10", 2), gp("16.00"), 0},
		{"x'AB' = x(2)'AB00'", gx("\xab", 1), gx("\xab\x00", 2), 0},
		// d and t with numbers; d with c
		{"d'20260101' < i20260101", gd("20260101"), gi(20260101), -1},
		{"d'20260101' = i739618", gd("20260101"), gi(739618), 0},
		{"t'000010' = i10", gt("000010"), gi(10), 0},
		{"d'20260101' = c(8)'20260101'", gd("20260101"), gc("20260101"), 0},
	}
	for _, k := range cases {
		var got, back int
		if err := gcCatch(func() { got = CmpData(k.a, k.b); back = CmpData(k.b, k.a) }); err != nil {
			t.Errorf("%s: panic %v", k.name, err)
			continue
		}
		if got != k.want || back != -k.want {
			t.Errorf("%s: %d / %d, want %d", k.name, got, back, k.want)
		}
	}
	// i0 against c'abc': a runtime error no CATCH takes (not a CX_ class)
	err := gcCatch(func() { CmpData(gi(0), gc("abc")) })
	if e, ok := err.(ArithmeticError); !ok || e.Class != CompareNoNumber || ClassBased(err) {
		t.Errorf("i0 vs c'abc': %v, want the uncatchable %s", err, CompareNoNumber)
	}
}
