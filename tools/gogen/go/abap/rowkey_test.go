package abap

import "testing"

func TestRowByKeyReadsAndWritesTheActualRow(t *testing.T) {
	type row struct {
		Name  string
		Value string
	}
	table := []row{{Name: "A", Value: "one"}, {Name: "B", Value: "two"}}

	found := RowByKey(&table, func(r row) bool { return r.Name == "B" })
	if found.Value != "two" {
		t.Fatalf("found value %q, want two", found.Value)
	}
	found.Value = "changed"
	if table[1].Value != "changed" {
		t.Fatalf("table row was not changed: %#v", table[1])
	}
}

func TestRowByKeyMissRaisesItabLineNotFound(t *testing.T) {
	defer func() {
		got, ok := recover().(ArithmeticError)
		if !ok || got.Class != "CX_SY_ITAB_LINE_NOT_FOUND" {
			t.Fatalf("panic = %#v, want CX_SY_ITAB_LINE_NOT_FOUND", got)
		}
	}()
	table := []string{"A"}
	RowByKey(&table, func(row string) bool { return row == "B" })
}
