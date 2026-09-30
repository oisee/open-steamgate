package classname

import (
	"testing"

	"osg/gogen/abap"
)

type global struct{ _ byte }
type local struct{ _ byte }

func TestInternal(t *testing.T) {
	abap.RegisterClass("ZCL_T_GLOBAL", (*global)(nil), func(*abap.Session) any { return &global{} })
	abap.RegisterClass("ZCL_T_POOL:LCL_T", (*local)(nil), func(*abap.Session) any { return &local{} })
	var got string
	Internal(&abap.Session{}, &global{}, &got)
	if got != "ZCL_T_GLOBAL" {
		t.Fatalf("global: %q", got)
	}
	Internal(&abap.Session{}, &local{}, &got)
	if got != "CLAS-ZCL_T_POOL-LCL_T" {
		t.Fatalf("local: %q", got)
	}
	defer func() {
		if r, ok := recover().(abap.ArithmeticError); !ok || r.Class != "CX_SY_REF_IS_INITIAL" {
			t.Fatalf("initial reference: %v", r)
		}
	}()
	Internal(&abap.Session{}, (*global)(nil), &got)
}
