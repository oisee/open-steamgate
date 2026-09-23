package abap

import "math"

// Sin and Cos are fdlibm's, as V8 carries them (src/base/ieee754.cc), not
// Go's math.Sin: Go's differ in the last bit for 43 % of arguments, and a
// hash such as sin( x * '12.9898' ) * '43758.5453' turns that bit into a
// visible difference against A4H, where the JS emitter (V8) agrees.
// Arguments beyond 2^19 * pi/2 need fdlibm's Payne-Hanek reduction, which is
// not ported; they fall back to math.Sin / math.Cos.

const trigLarge = 0x413921fb // high word of 2^19 * pi/2

func hiWord(x float64) int32 { return int32(math.Float64bits(x) >> 32) }

func Sin(x float64) float64 {
	ix := hiWord(x) & 0x7fffffff
	switch {
	case ix <= 0x3fe921fb:
		return kSin(x, 0, 0)
	case ix >= 0x7ff00000:
		return math.NaN()
	case ix > trigLarge:
		return math.Sin(x)
	}
	n, y0, y1 := remPio2(x)
	switch n & 3 {
	case 0:
		return kSin(y0, y1, 1)
	case 1:
		return kCos(y0, y1)
	case 2:
		return -kSin(y0, y1, 1)
	}
	return -kCos(y0, y1)
}

func Cos(x float64) float64 {
	ix := hiWord(x) & 0x7fffffff
	switch {
	case ix <= 0x3fe921fb:
		return kCos(x, 0)
	case ix >= 0x7ff00000:
		return math.NaN()
	case ix > trigLarge:
		return math.Cos(x)
	}
	n, y0, y1 := remPio2(x)
	switch n & 3 {
	case 0:
		return kCos(y0, y1)
	case 1:
		return -kSin(y0, y1, 1)
	case 2:
		return -kCos(y0, y1)
	}
	return kSin(y0, y1, 1)
}

func kSin(x, y float64, iy int) float64 {
	const (
		S1 = -1.66666666666666324348e-01
		S2 = 8.33333333332248946124e-03
		S3 = -1.98412698298579493134e-04
		S4 = 2.75573137070700676789e-06
		S5 = -2.50507602534068634195e-08
		S6 = 1.58969099521155010221e-10
	)
	if hiWord(x)&0x7fffffff < 0x3e400000 && int32(x) == 0 {
		return x
	}
	z := x * x
	v := z * x
	r := S2 + z*(S3+z*(S4+z*(S5+z*S6)))
	if iy == 0 {
		return x + v*(S1+z*r)
	}
	return x - ((z*(0.5*y-v*r) - y) - v*S1)
}

func kCos(x, y float64) float64 {
	const (
		C1 = 4.16666666666666019037e-02
		C2 = -1.38888888888741095749e-03
		C3 = 2.48015872894767294178e-05
		C4 = -2.75573143513906633035e-07
		C5 = 2.08757232129817482790e-09
		C6 = -1.13596475577881948265e-11
	)
	ix := hiWord(x) & 0x7fffffff
	if ix < 0x3e400000 && int32(x) == 0 {
		return 1
	}
	z := x * x
	r := z * (C1 + z*(C2+z*(C3+z*(C4+z*(C5+z*C6)))))
	if ix < 0x3FD33333 {
		return 1 - (0.5*z - (z*r - x*y))
	}
	var qx float64
	if ix > 0x3fe90000 {
		qx = 0.28125
	} else {
		qx = math.Float64frombits(uint64(uint32(ix-0x00200000)) << 32)
	}
	hz := 0.5*z - qx
	a := 1 - qx
	return a - (hz - (z*r - x*y))
}

var npio2hw = [32]int32{
	0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
	0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
	0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
	0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
}

// remPio2 is fdlibm's __ieee754_rem_pio2 for |x| <= 2^19 * pi/2: x - n*pi/2
// as y0 + y1.
func remPio2(x float64) (int32, float64, float64) {
	const (
		invpio2 = 6.36619772367581382433e-01
		pio2_1  = 1.57079632673412561417e+00
		pio2_1t = 6.07710050650619224932e-11
		pio2_2  = 6.07710050630396597660e-11
		pio2_2t = 2.02226624879595063154e-21
		pio2_3  = 2.02226624871116645580e-21
		pio2_3t = 8.47842766036889956997e-32
	)
	hx := hiWord(x)
	ix := hx & 0x7fffffff
	if ix < 0x4002d97c { // |x| < 3pi/4
		if hx > 0 {
			z := x - pio2_1
			if ix != 0x3ff921fb {
				y0 := z - pio2_1t
				return 1, y0, (z - y0) - pio2_1t
			}
			z -= pio2_2
			y0 := z - pio2_2t
			return 1, y0, (z - y0) - pio2_2t
		}
		z := x + pio2_1
		if ix != 0x3ff921fb {
			y0 := z + pio2_1t
			return -1, y0, (z - y0) + pio2_1t
		}
		z += pio2_2
		y0 := z + pio2_2t
		return -1, y0, (z - y0) + pio2_2t
	}
	t := math.Abs(x)
	n := int32(t*invpio2 + 0.5)
	fn := float64(n)
	r := t - fn*pio2_1
	w := fn * pio2_1t
	var y0 float64
	if n < 32 && ix != npio2hw[n-1] {
		y0 = r - w
	} else {
		j := ix >> 20
		y0 = r - w
		i := j - ((hiWord(y0) >> 20) & 0x7ff)
		if i > 16 {
			t = r
			w = fn * pio2_2
			r = t - w
			w = fn*pio2_2t - ((t - r) - w)
			y0 = r - w
			i = j - ((hiWord(y0) >> 20) & 0x7ff)
			if i > 49 {
				t = r
				w = fn * pio2_3
				r = t - w
				w = fn*pio2_3t - ((t - r) - w)
				y0 = r - w
			}
		}
	}
	y1 := (r - y0) - w
	if hx < 0 {
		return -n, -y0, -y1
	}
	return n, y0, y1
}
