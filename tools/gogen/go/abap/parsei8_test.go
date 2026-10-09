package abap

import "testing"

func TestParseI8(t *testing.T) {
	for in, want := range map[string]int64{" 42 ": 42, "8000000000": 8000000000, "-17": -17, "": 0,
		"9223372036854775807": 9223372036854775807, "-9223372036854775808": -9223372036854775808, "2.5": 3, "-2.5": -3} {
		if got := ParseI8(in); got != want {
			t.Errorf("ParseI8(%q) = %d, want %d", in, got, want)
		}
	}
	for in, class := range map[string]string{"9223372036854775808": "CX_SY_CONVERSION_OVERFLOW", "-9223372036854775809": "CX_SY_CONVERSION_OVERFLOW",
		"99999999999999999999": "CX_SY_CONVERSION_OVERFLOW", "9223372036854775807.5": "CX_SY_CONVERSION_OVERFLOW", "x1": "CX_SY_CONVERSION_NO_NUMBER"} {
		func() {
			defer func() {
				if e, ok := recover().(ArithmeticError); !ok || e.Class != class {
					t.Errorf("ParseI8(%q): %v, want %s", in, e, class)
				}
			}()
			ParseI8(in)
		}()
	}
}
