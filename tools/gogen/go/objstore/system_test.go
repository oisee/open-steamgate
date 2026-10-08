package objstore

import (
	"errors"
	"reflect"
	"testing"
)

func ptr(s string) *string { return &s }

type systemFunc func(string, string, string) (any, error)

func (f systemFunc) System(k, n, j string) (any, error) { return f(k, n, j) }
func TestRequestSystem(t *testing.T) {
	for _, kind := range []string{"SESSION", "LOCK_HANDLE", "LOCK_RELEASE", "LOCK_HOLDER"} {
		input := map[string]*string{"IV_COMMAND": ptr("SYSTEM"), "IV_TYPE": ptr(kind), "IV_NAME": ptr("CLAS Z"), "IV_JSON": ptr("{}")}
		before := Call(input)
		if !reflect.DeepEqual(before, CallWithSystem(input, nil)) {
			t.Fatal("nil changed refusal")
		}
		a := CallWithSystem(input, systemFunc(func(k, n, j string) (any, error) {
			if k != kind || n != "CLAS Z" || j != "{}" {
				t.Fatal(k, n, j)
			}
			return map[string]bool{"stateful": true}, nil
		}))
		if a.Scalars["EV_JSON"] != `{"stateful":true}` || a.Scalars["EV_ERROR"] != "" || a.Scalars["EV_MS"] != "0" {
			t.Fatal(a)
		}
		a = CallWithSystem(input, systemFunc(func(string, string, string) (any, error) { return nil, errors.New("ADT session ended") }))
		if a.Scalars["EV_ERROR"] != "ADT session ended" || a.Scalars["EV_JSON"] != `{"error":{"code":"INTERNAL","message":"ADT session ended"}}` {
			t.Fatal(a)
		}
	}
}

func TestSystemRefusalsAndReentry(t *testing.T) {
	saved := storeState.identity
	defer func() { storeState.identity = saved }()
	for _, identity := range []*Identity{nil, {SystemID: "OSD"}} {
		storeState.identity = identity
		for _, kind := range []string{"IDENTITY", "SESSION", "LOCK_HANDLE", "LOCK_RELEASE", "LOCK_HOLDER", "BUILD", "BOGUS", ""} {
			in := map[string]*string{"IV_COMMAND": ptr("SYSTEM"), "IV_TYPE": ptr(kind)}
			if !reflect.DeepEqual(Call(in), CallWithSystem(in, nil)) {
				t.Fatalf("nil changed %s", kind)
			}
		}
	}
	a := CallWithSystem(map[string]*string{"IV_COMMAND": ptr("SYSTEM"), "IV_JSON": ptr(`{"kind":"session"}`)}, systemFunc(func(k, n, j string) (any, error) {
		if k != "SESSION" {
			t.Fatal(k)
		}
		_ = Call(map[string]*string{"IV_COMMAND": ptr("COMMANDS")}) // must not deadlock
		return nil, nil
	}))
	if a.Scalars["EV_ERROR"] != "SYSTEM SESSION has no answer here" {
		t.Fatal(a)
	}
}
