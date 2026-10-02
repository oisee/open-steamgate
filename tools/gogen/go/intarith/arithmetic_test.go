package intarith

import (
	"math"
	"math/big"
	"math/rand"
	"osg/gogen/abaperr"
	"testing"
)

func observed(f func() int64) (v int64, class string) {
	defer func() {
		if r := recover(); r != nil {
			class = r.(abaperr.ArithmeticError).Class
		}
	}()
	v = f()
	return
}
func reference(a, b int64, op string) (int64, string) {
	x, y := big.NewInt(a), big.NewInt(b)
	var v *big.Int
	switch op {
	case "+":
		v = new(big.Int).Add(x, y)
	case "-":
		v = new(big.Int).Sub(x, y)
	case "*":
		v = new(big.Int).Mul(x, y)
	default:
		if b == 0 {
			if a == 0 {
				return 0, ""
			}
			return 0, "CX_SY_ZERODIVIDE"
		}
		if op == "/" {
			q, r := new(big.Int).QuoRem(x, y, new(big.Int))
			if new(big.Int).Lsh(new(big.Int).Abs(r), 1).Cmp(new(big.Int).Abs(y)) >= 0 {
				if (a < 0) != (b < 0) {
					q.Sub(q, big.NewInt(1))
				} else {
					q.Add(q, big.NewInt(1))
				}
			}
			v = q
		} else {
			r := new(big.Int).Mod(x, new(big.Int).Abs(y))
			if op == "MOD" {
				v = r
			} else {
				v = new(big.Int).Quo(new(big.Int).Sub(x, r), y)
			}
		}
	}
	if !v.IsInt64() {
		return 0, "CX_SY_ARITHMETIC_OVERFLOW"
	}
	return v.Int64(), ""
}
func TestAgainstBigIntegerReference(t *testing.T) {
	ops := map[string]func(int64, int64) int64{"+": Add, "-": Sub, "*": Mul, "/": Div, "DIV": Quot, "MOD": Mod}
	check := func(a, b int64) {
		for op, f := range ops {
			got, class := observed(func() int64 { return f(a, b) })
			want, wantClass := reference(a, b, op)
			if class != wantClass || class == "" && got != want {
				t.Fatalf("%d %s %d = %d/%s, want %d/%s", a, op, b, got, class, want, wantClass)
			}
		}
	}
	edges := []int64{math.MinInt64, math.MinInt64 + 1, -4611686018427387904, -4294967296, -65536, -7, -3, -2, -1, 0, 1, 2, 3, 7, 65536, 4294967296, 4611686018427387904, math.MaxInt64 - 1, math.MaxInt64}
	for _, a := range edges {
		for _, b := range edges {
			check(a, b)
		}
	}
	random := rand.New(rand.NewSource(1))
	for i := 0; i < 5000; i++ {
		check(int64(random.Uint64()), int64(random.Uint64()))
	}
}
func TestNoArithmeticAllocations(t *testing.T) {
	for name, f := range map[string]func(int64, int64) int64{"add": Add, "sub": Sub, "mul": Mul, "round": Div, "div": Quot, "mod": Mod} {
		if n := testing.AllocsPerRun(100, func() { f(-12345, 65536) }); n != 0 {
			t.Fatalf("%s allocated %v", name, n)
		}
	}
}
func TestPackedFallback(t *testing.T) {
	calls := 0
	if got := Packed(func() int64 { return Add(math.MaxInt64, 1) }, func() int64 { calls++; return math.MaxInt64 }); got != math.MaxInt64 || calls != 1 {
		t.Fatal(got, calls)
	}
	if got := Packed(func() int64 { return 7 }, func() int64 { t.Fatal("unnecessary fallback"); return 0 }); got != 7 {
		t.Fatal(got)
	}
	_, class := observed(func() int64 {
		return Packed(func() int64 { return Quot(1, 0) }, func() int64 { t.Fatal("zero division retried"); return 0 })
	})
	if class != "CX_SY_ZERODIVIDE" {
		t.Fatal(class)
	}
	_, class = observed(func() int64 {
		return Packed(func() int64 { return Mul(math.MaxInt64, 2) }, func() int64 { panic(abaperr.ArithmeticError{Class: "CX_SY_ARITHMETIC_OVERFLOW", Op: "="}) })
	})
	if class != "CX_SY_ARITHMETIC_OVERFLOW" {
		t.Fatal(class)
	}
}
