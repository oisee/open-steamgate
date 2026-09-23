package abap

import "testing"

func TestOutsideClasses(t *testing.T) {
	for _, c := range [][2]string{
		{`/sap/opu/odata/sap/([^/]+)/?([^/(?]*)`, `/sap/opu/odata/sap/(_+)/?(_*)`},
		{`a(?:b)`, `a(?:b)`},
		{`[]?(]x(?i)`, `_x(?i)`},
		{`\(?x`, `_?x`},
		{`[[:alpha:]?]+?`, `_+?`},
	} {
		if got := outsideClasses(c[0]); got != c[1] {
			t.Errorf("%s: %s, want %s", c[0], got, c[1])
		}
	}
}
