package abap

import "testing"

func TestAppendBytesKeepsEveryView(t *testing.T) {
	h := string(make([]byte, 5000))
	views := []string{}
	for i := 0; i < 20000; i++ {
		h = AppendBytes(h, string([]byte{byte(i)}))
		if i%997 == 0 {
			views = append(views, h)
		}
	}
	// an older view appended to again must not overwrite the newer one
	old := views[3]
	fork := AppendBytes(old, "X")
	if len(fork) != len(old)+1 || fork[len(old)] != 'X' || fork[:len(old)] != old {
		t.Fatalf("an append to an older view is not that view and X")
	}
	for k, v := range views {
		for j := 5000; j < len(v); j++ {
			if v[j] != byte(j-5000) {
				t.Fatalf("view %d changed at %d", k, j)
			}
		}
	}
	for j := 5000; j < len(h); j++ {
		if h[j] != byte(j-5000) {
			t.Fatalf("the newest string changed at %d", j)
		}
	}
}
