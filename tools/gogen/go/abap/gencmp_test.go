package abap

import "testing"

// Pairwise comparisons of generic values (CmpData / DataEq), the ones
// CL_ABAP_UNIT_ASSERT=>ASSERT_EQUALS reaches with act and exp TYPE any.
// None existed on origin/main, where every non-c/string pair dumped in
// DataChars; the critic cases of 57d22009 (a per-operand key) are marked.

type gcPair struct {
	A string
	N int32
}

var gcPairT = &Type{Kind: 'u', Comps: []Comp{
	{Name: "A", T: TString, Get: func(p any) any { return &p.(*gcPair).A }},
	{Name: "N", T: TI, Get: func(p any) any { return &p.(*gcPair).N }},
}}

var gcTabT = &Type{Kind: 'h', Row: TI,
	Lines: func(p any) int { return len(*p.(*[]int32)) },
	At:    func(p any, i int) any { return &(*p.(*[]int32))[i] },
}

type gcObj struct{ x int }

func gi(v int32) Data         { return Data{P: &v, T: TI} }
func gi8(v int64) Data        { return Data{P: &v, T: TInt8} }
func gf(v float64) Data       { return Data{P: &v, T: TF} }
func gp(v string) Data        { return Data{P: &v, T: TP(8, 2)} }
func gs(v string) Data        { return Data{P: &v, T: TString} }
func gc(v string) Data        { return Data{P: &v, T: TC(10)} }
func gn(v string) Data        { return Data{P: &v, T: TN(4)} }
func gxs(v string) Data       { return Data{P: &v, T: TXString} }
func gx(v string, n int) Data { return Data{P: &v, T: TX(n)} }
func gd(v string) Data        { return Data{P: &v, T: TD} }

func gcCatch(f func()) (err any) {
	defer func() { err = recover() }()
	f()
	return nil
}

func TestDataEq(t *testing.T) {
	st := func(a string, n int32) Data { v := gcPair{a, n}; return Data{P: &v, T: gcPairT} }
	tab := func(v ...int32) Data { return Data{P: &v, T: gcTabT} }
	o1, o2 := &gcObj{1}, &gcObj{1}
	var onil *gcObj
	obj := func(o *gcObj) Data { return Data{P: &o, T: TObj} }
	n1, n2 := int32(5), int32(5)
	dref := func(p *int32) Data { r := Data{P: p, T: TI}; return Data{P: &r, T: TRef} }
	cases := []struct {
		name string
		a, b Data
		eq   bool
	}{
		{"i = i", gi(3), gi(3), true},
		{"i <> i", gi(3), gi(4), false},
		{"int8 = i", gi8(3), gi(3), true},
		{"p 1.50 = f 1.5", gp("1.50"), gf(1.5), true},
		{"p 2.00 = i 2", gp("2.00"), gi(2), true},
		{"f 0.1 = p 0.10 (p to f)", gf(0.1), gp("0.10"), true},
		{"i 5 = string 5", gi(5), gs("5"), true},
		{"i 5 = c ' 05' (c to number)", gi(5), gc(" 05"), true},
		{"critic 1: x 10 <> i 10", gx("\x10", 1), gi(10), false},
		{"x 10 = i 16", gx("\x10", 1), gi(16), true},
		{"critic 2: n 0005 = c 5", gn("0005"), gc("5"), true},
		{"n 0005 = i 5", gn("0005"), gi(5), true},
		{"critic 2: f 2^53 = int8 2^53+1 (int8 to f)", gf(9007199254740992), gi8(9007199254740993), true},
		{"critic 3: x AB = x AB00", gx("\xab", 1), gx("\xab\x00", 2), true},
		{"xstring AB <> xstring AB00", gxs("\xab"), gxs("\xab\x00"), false},
		{"x FF00 = string FF00", gx("\xff\x00", 2), gs("FF00"), true},
		{"x FF <> string ff", gx("\xff", 1), gs("ff"), false},
		{"c = string", gc("AB"), gs("AB"), true},
		{"string 'AB ' <> c AB", gs("AB "), gc("AB"), false},
		{"d never set = 00000000", gd(""), gd("00000000"), true},
		{"struct =", st("a", 1), st("a", 1), true},
		{"struct <>", st("a", 1), st("a", 2), false},
		{"struct boundaries", st("a1", 1), st("a", 11), false},
		{"table =", tab(1, 2), tab(1, 2), true},
		{"table rows", tab(1, 2), tab(1), false},
		{"table order", tab(1, 2), tab(2, 1), false},
		{"object same", obj(o1), obj(o1), true},
		{"object other", obj(o1), obj(o2), false},
		{"object initial", obj(onil), obj(nil), true},
		{"data ref same", dref(&n1), dref(&n1), true},
		{"data ref other", dref(&n1), dref(&n2), false},
	}
	for _, k := range cases {
		var eq bool
		if err := gcCatch(func() { eq = DataEq(k.a, k.b) }); err != nil {
			t.Errorf("%s: panic %v", k.name, err)
			continue
		}
		if eq != k.eq {
			t.Errorf("%s: equal %v, want %v", k.name, eq, k.eq)
		}
		var back bool
		gcCatch(func() { back = DataEq(k.b, k.a) })
		if back != eq {
			t.Errorf("%s: not symmetric", k.name)
		}
	}
}

func TestCmpDataOrder(t *testing.T) {
	tab := func(v ...int32) Data { return Data{P: &v, T: gcTabT} }
	cases := []struct {
		name string
		a, b Data
		want int
	}{
		{"9 < 10 as numbers", gi(9), gi(10), -1},
		{"i with p", gi(2), gp("1.99"), 1},
		{"f with i", gf(-0.5), gi(0), -1},
		{"string as a number", gs("10"), gi(9), 1},
		{"n as numbers", gn("0010"), gc("9"), 1},
		{"x FF > i 254", gx("\xff", 1), gi(254), 1},
		{"x FFFFFFFF = i -1", gx("\xff\xff\xff\xff", 4), gi(-1), 0},
		{"xstring prefix smaller", gxs("\xab"), gxs("\xab\x00"), -1},
		{"fewer rows first", tab(9), tab(1, 1), -1},
		{"rows in order", tab(1, 3), tab(1, 2), 1},
	}
	for _, k := range cases {
		if got := CmpData(k.a, k.b); got != k.want {
			t.Errorf("%s: %d, want %d", k.name, got, k.want)
		}
	}
	for name, pair := range map[string][2]Data{
		"string no number with i": {gs("x"), gi(1)},
		"d with i (not measured)": {gd("20260101"), gi(1)},
		"x with p (not measured)": {gx("\x01", 1), gp("1")},
		"struct with i":           {Data{P: &gcPair{}, T: gcPairT}, gi(1)},
	} {
		if gcCatch(func() { CmpData(pair[0], pair[1]) }) == nil {
			t.Errorf("%s: must dump", name)
		}
	}
}

// DataChars keeps its measured domain, a c or a string; other kinds need
// the other operand and are CmpData's
func TestDataCharsDomain(t *testing.T) {
	if DataChars(gc("AB")) != "AB" || DataChars(gs("AB ")) != "AB " {
		t.Errorf("c / string characters changed")
	}
	if gcCatch(func() { DataChars(gi(1)) }) == nil {
		t.Errorf("an i through DataChars must dump")
	}
}
