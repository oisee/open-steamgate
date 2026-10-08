package abap

import (
	"reflect"
	"testing"
)

func TestRound3LiteralHalfIgnoringCase(t *testing.T) {
	hi, lo := SubS("😀", 0, 1), SubS("😀", 1, 1)
	t.Run("count", func(t *testing.T) {
		defer func() {
			if x := recover(); x != nil {
				t.Errorf("unexpected panic: %v", x)
			}
		}()
		if n := FindAllCount("😀", lo, false, true); n != 1 {
			t.Fatal(n)
		}
	})
	t.Run("replace", func(t *testing.T) {
		defer func() {
			if x := recover(); x != nil {
				t.Errorf("unexpected panic: %v", x)
			}
		}()
		v, rc := ReplaceStmt("😀", lo, "X", false, false, true, 0, NoLength, -1)
		if v != hi+"X" || rc != 0 {
			t.Fatalf("%x %d", v, rc)
		}
	})
	t.Run("results", func(t *testing.T) {
		defer func() {
			if x := recover(); x != nil {
				t.Errorf("unexpected panic: %v", x)
			}
		}()
		v := FindResults("😀A😀", lo, 0, true, true)
		if !reflect.DeepEqual(v, [][]int32{{1, 1}, {4, 1}}) {
			t.Fatal(v)
		}
	})
}
