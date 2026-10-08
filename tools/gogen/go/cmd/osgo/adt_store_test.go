package main

import (
	"osg/gogen/abap"
	"testing"
)

type requestSystem func(string, string, string) (any, error)

func (f requestSystem) System(k, n, j string) (any, error) { return f(k, n, j) }
func TestStoreAdapterRetainsCallingStep(t *testing.T) {
	one, two := new(abap.Session), new(abap.Session)
	clearOne := adtSystems.Bind(one, requestSystem(func(k, n, j string) (any, error) { return map[string]bool{"stateful": true}, nil }))
	defer clearOne()
	clearTwo := adtSystems.Bind(two, requestSystem(func(k, n, j string) (any, error) { return map[string]bool{"stateful": false}, nil }))
	defer clearTwo()
	invoke := func(s *abap.Session, want string) {
		t.Helper()
		cmd, kind, json, errorText, ms := "SYSTEM", "SESSION", "stale", "stale", "stale"
		abap.ZOSD_STORE(s, map[string]abap.Data{
			"IV_COMMAND": {P: &cmd, T: abap.TString}, "IV_TYPE": {P: &kind, T: abap.TString}, "EV_JSON": {P: &json, T: abap.TString}, "EV_ERROR": {P: &errorText, T: abap.TString}, "EV_MS": {P: &ms, T: abap.TString},
		})
		if json != want || errorText != "" || ms != "0" {
			t.Fatal(json, errorText, ms)
		}
	}
	invoke(two, `{"stateful":false}`)
	invoke(one, `{"stateful":true}`)
	clearTwo()
	invoke(one, `{"stateful":true}`)
}
