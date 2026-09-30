package abap

import "testing"

func TestDataBound(t *testing.T) {
	var ref Data
	if DataBound(Data{P: &ref, T: TRef}) {
		t.Fatal("initial data reference is bound")
	}
	x := int32(1)
	ref = Data{P: &x, T: TI}
	if !DataBound(Data{P: &ref, T: TRef}) {
		t.Fatal("assigned data reference is not bound")
	}
	var obj *struct{}
	if DataBound(Data{P: &obj, T: TObj}) {
		t.Fatal("initial object reference is bound")
	}
	obj = &struct{}{}
	if !DataBound(Data{P: &obj, T: TObj}) {
		t.Fatal("assigned object reference is not bound")
	}
	var objSlot any = (*struct{})(nil)
	if DataBound(Data{P: &objSlot, T: TObj}) {
		t.Fatal("interface slot holding an initial object reference is bound")
	}
	objSlot = &struct{}{}
	if !DataBound(Data{P: &objSlot, T: TObj}) {
		t.Fatal("interface slot holding an assigned object reference is not bound")
	}
}
