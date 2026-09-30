package abap

import "testing"

// LCL_DUMP of CL_ABAP_UNIT_ASSERT is @KERNEL code on Node; before
// fix/gogen-assert-compare the Go build dumped NOT_COMPILED on a structure
// or an object (UnitDumpToString did not exist).
func TestUnitDump(t *testing.T) {
	st := gcPair{"x", 7}
	rows := []int32{1}
	d := ""
	var o *gcObj
	cases := []struct {
		name string
		v    Data
		want string
	}{
		{"structure", Data{P: &st, T: gcPairT}, "a: x, n: 7"},
		{"table", Data{P: &rows, T: gcTabT}, "[itab]"},
		{"d never set", Data{P: &d, T: TD}, "00000000"},
	}
	t.Run("initial object throws", func(t *testing.T) {
		defer func() {
			x := recover()
			if e, ok := x.(ArithmeticError); !ok || e.Class != "OBJECTS_OBJREF_NOT_ASSIGNED" {
				t.Errorf("initial object panic = %v, want OBJECTS_OBJREF_NOT_ASSIGNED", x)
			}
		}()
		UnitDumpToString(nil, Data{P: &o, T: TObj})
	})
	for _, c := range cases {
		if got := UnitDumpToString(nil, c.v); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
	for in, want := range map[string]string{"ZCL_X": "zcl_x", "ZCL_OWNER:LCL_X": "lcl_x", "/IWBEP/CL_X": "$iwbep$cl_x"} {
		if got := jsName(in); got != want {
			t.Errorf("jsName(%s) = %s, want %s", in, got, want)
		}
	}
}
