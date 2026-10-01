package nodehdr

import "testing"

func TestMerge(t *testing.T) {
	for _, tc := range []struct{ name, want string }{
		{"content-type", "first"},
		{"cookie", "first; second"},
		{"x-test", "first, second"},
	} {
		if got := Merge(tc.name, "first", "second"); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
