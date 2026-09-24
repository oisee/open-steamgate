package abap

import (
	"encoding/json"
	"testing"
)

// The parser's column shape, byte for byte what test/fixtures/ir-pairs/
// osql-where.json (branch feat/ir-osql-where) carries as "columns": CHAR3,
// NUMC4, INT4, P 15,2, STRING.
func TestWhereColumnsShape(t *testing.T) {
	tb := &Table{Name: "SFLIGHT_LIKE", Columns: []Column{
		{Name: "CARRID", Kind: 'C', Len: 3, IR: &IRType{Abap: "C", Len: 3}},
		{Name: "CONNID", Kind: 'N', Len: 4, IR: &IRType{Abap: "C", Len: 4}},
		{Name: "SEATSMAX", Kind: 'I', IR: &IRType{Abap: "I"}},
		{Name: "PRICE", Kind: 'P', Len: 8, Dec: 2, IR: &IRType{Abap: "P", Len: 15, Dec: 2}},
		{Name: "NOTE", Kind: 'g', IR: &IRType{Abap: "STRING"}},
		{Name: "FLTIME", Kind: 'T'},
	}}
	got, _ := json.Marshal(tb.WhereColumns())
	want := `{"CARRID":{"type":{"abap":"C","len":3}},"CONNID":{"type":{"abap":"C","len":4},"kind":"NUMC"},"NOTE":{"type":{"abap":"STRING"}},"PRICE":{"type":{"abap":"P","len":15,"dec":2}},"SEATSMAX":{"type":{"abap":"I"}}}`
	if string(got) != want {
		t.Errorf("got %s\nwant %s", got, want)
	}
	if (&IRType{Abap: "P", Len: 15, Dec: 2}).seam() != "P(15,2)" {
		t.Errorf("seam of P: %s", (&IRType{Abap: "P", Len: 15, Dec: 2}).seam())
	}
}

func TestClientTable(t *testing.T) {
	RegisterTables(&Table{Name: "ZC_T_CDS", View: true, SQLView: "ZV_T_SQL"}, &Table{Name: "ZV_T_SQL", View: true, Client: true, CDS: "ZC_T_CDS"})
	if c, ok := ClientTable("zc_t_cds"); !ok || c.Name != "ZV_T_SQL" || !c.Client {
		t.Errorf("ClientTable(zc_t_cds) = %v %v", c, ok)
	}
	if _, ok := ClientTable("ZC_T_NONE"); ok {
		t.Error("an unknown name found")
	}
}
