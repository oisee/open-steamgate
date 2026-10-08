package abap

import "testing"

func TestRound3JSONHalf(t *testing.T) {
	hi, lo := SubS("😀", 0, 1), SubS("😀", 1, 1)
	for _, tc := range []struct{ json, want string }{{`"\uD83D"`, hi}, {`"\uDE00"`, lo}, {`"\uD83D\uDE00"`, "😀"}, {`"\uD83DA"`, hi + "A"}} {
		t.Run(tc.json, func(t *testing.T) {
			defer func() {
				if x := recover(); x != nil {
					t.Errorf("unexpected panic: %v", x)
				}
			}()
			nodes, ok := JSONNodes(tc.json)
			if !ok {
				t.Fatal("parse failed")
			}
			if len(nodes) != 3 || nodes[1].Value != tc.want {
				t.Fatalf("nodes=%+v", nodes)
			}
		})
	}
}
