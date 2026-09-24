package abap

import (
	"strconv"
	"testing"
)

// catch runs f and returns its value, or the class of the ABAP exception it
// raised, abbreviated as the probes print them
func catch(f func() string) (out string) {
	defer func() {
		if r := recover(); r != nil {
			e, ok := r.(ArithmeticError)
			if !ok {
				panic(r)
			}
			out = map[string]string{"CX_SY_ARITHMETIC_OVERFLOW": "AO", "CX_SY_CONVERSION_OVERFLOW": "CO",
				"CX_SY_ZERODIVIDE": "ZD", "CX_SY_CONVERSION_NO_NUMBER": "NN"}[e.Class]
		}
	}()
	return f()
}

// Every expected value below is A4H's (2026-09-24, $ZOSG_TMP_0270).
func TestPackedA4H(t *testing.T) {
	p32 := func(v string, arith bool) string { return PFit(v, 3, 2, arith) }
	cases := []struct{ name, got, want string }{}
	add := func(name string, f func() string, want string) {
		cases = append(cases, struct{ name, got, want string }{name, catch(f), want})
	}
	// c -> p(3,2)
	for in, want := range map[string]string{"1.235": "1.24", "-1.235": "-1.24", "1.2349": "1.23", " 12.5 ": "12.50", "12.5-": "-12.50",
		"+3": "3.00", "-0": "0.00", ".5": "0.50", "5.": "5.00", "": "0.00", "abc": "NN", "1,5": "NN", "1E2": "NN", "999.994": "999.99",
		"999.995": "CO", "1000": "CO", "12 3": "NN", "- 1": "-1.00", "0.001": "0.00", "-0.005": "-0.01", "x": "NN", " 2.5 ": "2.50", "1e1": "NN"} {
		add("c2p "+in, func() string { return p32(CToP(in), false) }, want)
	}
	// f -> p(3,2)
	for in, want := range map[float64]string{2.345: "2.35", 2.355: "2.36", -2.345: "-2.35", 0.125: "0.13", -0.125: "-0.13", 1.005: "1.00",
		999.995: "CO", 1000: "CO", 0.001: "0.00", -0.004: "0.00", 1e300: "CO", 2.675: "2.67"} {
		add("f2p "+strconv.FormatFloat(in, 'g', -1, 64), func() string { return p32(FToP(in), false) }, want)
	}
	add("p3->p2", func() string { return PFit("1.255", 8, 2, false) }, "1.26")
	add("p3->p2 neg", func() string { return PFit("-1.255", 8, 2, false) }, "-1.26")
	add("p2->p0", func() string { return PFit("-2.50", 8, 0, false) }, "-3")
	add("p->i", func() string { return strconv.Itoa(int(PToI("-2.50", false))) }, "-3")
	add("p->i ovf", func() string { return strconv.Itoa(int(PToI("3000000000", false))) }, "CO")
	add("p->i arith", func() string { return strconv.Itoa(int(PToI("3000000000", true))) }, "AO")
	add("p->f", func() string { return FmtF(PToF("0.10")) }, "0.10000000000000001")
	add("p->c8", func() string { return "[" + PToC("-1.50", 2, 8) + "]" }, "[   1.50-]")
	add("p->c3", func() string { return "[" + PToC("12345.67", 2, 3) + "]" }, "[*67]")
	add("p->c4", func() string { return "[" + PToC("1.50", 2, 4) + "]" }, "[1.50]")
	add("p->c4 neg", func() string { return "[" + PToC("-1.50", 2, 4) + "]" }, "[*50-]")
	add("p->c3 neg", func() string { return "[" + PToC("-1.50", 2, 3) + "]" }, "[*0-]")
	add("p->c8 long neg", func() string { return "[" + PToC("-12345.67", 2, 8) + "]" }, "[*345.67-]")
	add("p->c3 long neg", func() string { return "[" + PToC("-12345.67", 2, 3) + "]" }, "[*7-]")
	add("p->string", func() string { return "[" + PToString("1.5", 2) + "][" + PToString("-42", 0) + "]" }, "[1.50 ][42-]")
	add("p->n", func() string { return PToN("12.50", 4) + "," + PToN("-12.5", 4) + "," + PToN("12345.6", 4) }, "0013,0013,2346")
	// arithmetic
	add("mul", func() string { return PFit(MulP("-1.25", MulP("-1.25", "-1.25")), 8, 2, true) }, "-1.95")
	add("1/3*3 p0", func() string { return PFit(MulP(DivP("2", "3"), "3"), 8, 0, true) }, "2")
	add("-7/2 p0", func() string { return PFit(DivP("-7", "2"), 8, 0, true) }, "-4")
	add("1/3 p14", func() string { return PFit(DivP("1", "3"), 16, 14, true) }, "0.33333333333333")
	add("1/3*3 p14", func() string { return PFit(MulP(DivP("1", "3"), "3"), 16, 14, true) }, "1.00000000000000")
	add("2/3*1e29", func() string {
		return PFit(MulP(DivP("2", "3"), "100000000000000000000000000000"), 16, 0, true)
	}, "66666666666666666666666666667")
	add("1/7*1e21", func() string { return PFit(MulP(DivP("1", "7"), "1000000000000000000000"), 16, 0, true) }, "142857142857142857143")
	add("0.07/3*1e27", func() string {
		return PFit(MulP(DivP("0.07", "3"), "1000000000000000000000000000"), 16, 0, true)
	}, "23333333333333333333333333")
	add("2e28/3-", func() string {
		return PFit(SubP(DivP(MulP("2", "10000000000000000000000000000"), "3"), "6666666666666666666666666666"), 16, 14, true)
	}, "0.66700000000000")
	add("2e15/3-", func() string {
		return PFit(SubP(DivP(MulP("2", "1000000000000000"), "3"), "666666666666666"), 16, 14, true)
	}, "0.66666666666667")
	add("e^3/e/e", func() string {
		e := "0.00000000000001"
		return PFit(DivP(DivP(MulP(MulP(e, e), e), e), e), 16, 14, true)
	}, "0.00000000000001")
	add("DIV/MOD", func() string {
		out := ""
		for _, ab := range [][2]string{{"7.5", "2"}, {"7.5", "-2"}, {"-7.5", "2"}, {"-7.5", "-2"}} {
			out += PFit(DivIntP(ab[0], ab[1]), 8, 2, true) + "/" + PFit(ModP(ab[0], ab[1]), 8, 2, true) + " "
		}
		return out + PFit(ModP("7.5", "0.4"), 8, 2, true)
	}, "3.00/1.50 -3.00/1.50 -4.00/0.50 4.00/0.50 0.30")
	add("zero", func() string {
		return DivP("0", "0") + "," + catch(func() string { return DivP("7.5", "0") }) + "," + catch(func() string { return ModP("7.5", "0") })
	}, "0,ZD,ZD")
	nines := "9999999999999999999999999999999"
	add("31 nines + 1", func() string { return PFit(AddP(nines, "1"), 16, 0, true) }, "AO")
	add("63 digits", func() string { return PFit(DivP(DivP(MulP(MulP(nines, nines), "10"), nines), "10"), 16, 0, true) }, nines)
	add("64 digits", func() string { return PFit(DivP(DivP(MulP(MulP(nines, nines), "100"), nines), "100"), 16, 0, true) }, "AO")
	add("small arith", func() string { return PFit(MulP("5", "1000"), 3, 2, true) }, "AO")
	add("small /", func() string { return PFit(DivP("999999.99", "1000"), 3, 2, true) }, "AO")
	// templates and functions
	add("fmt", func() string {
		return FmtP("", 2) + "," + FmtP("0", 0) + "," + FmtP("-0.05", 2) + "," + FmtP("0.005", 3)
	}, "0.00,0,-0.05,0.005")
	add("DECIMALS", func() string {
		return FmtPDec("1.25", 1) + "," + FmtPDec("1.25", 3) + "," + FmtPDec("1.25", 0) + "," + FmtPDec("-1.25", 1) + "," + FmtPDec("2.50", 0) + "," + FmtPDec("42", 2)
	}, "1.3,1.250,1,-1.3,3,42.00")
	add("fn", func() string {
		return FmtP(AbsP("-1.50"), 2) + "," + CeilP("-1.50") + "," + FloorP("-1.50") + "," + TruncP("-1.50") + "," + FmtP(FracP("-1.50"), 2) + "," + strconv.Itoa(int(SignP("-1.5")))
	}, "1.50,-1,-2,-1,-0.50,-1")
	add("hash", func() string {
		h, i := "7", int32(30)
		for k := 0; k < 4; k++ {
			h = PFit(ModP(AddP(AddP(MulP(h, "97"), IToP(i)), "1"), "999999937"), 8, 0, true)
			i += 11
		}
		return h
	}, "648398213")
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s: got %s, A4H %s", c.name, c.got, c.want)
		}
	}
}

func TestDBP(t *testing.T) {
	for in, want := range map[string]string{"420": "420.00", "12.5": "12.50", "0.30000000000000004": "0.30", "1e-05": "0.00", "1.5e+03": "1500.00", "": "0.00"} {
		if got := DBP(DBString{String: in, Valid: in != ""}, 8, 2); got != want {
			t.Errorf("DBP(%q) = %s, want %s", in, got, want)
		}
	}
}
