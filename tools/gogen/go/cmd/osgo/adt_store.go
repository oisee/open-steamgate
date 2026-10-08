package main

import (
	"osg/gogen/abap"
	"osg/gogen/adtsystem"
	"osg/gogen/objstore"
	"strings"
)

var adtSystems adtsystem.Bindings

// The SYSTEM facts of an ADT request are answered for the calling step
// through go/abap's StoreHook (ZOSD_STORE offers every call to it first);
// any other call, or a step without a bound provider, takes the ordinary
// store path.
func init() {
	abap.StoreHook = func(step any, in map[string]*string) (abap.StoreAnswer, bool) {
		s, _ := step.(*abap.Session)
		command := in["IV_COMMAND"]
		if s == nil || command == nil || strings.ToUpper(strings.TrimSpace(*command)) != "SYSTEM" {
			return abap.StoreAnswer{}, false
		}
		provider := adtSystems.For(s)
		if provider == nil {
			return abap.StoreAnswer{}, false
		}
		return objstore.CallWithSystem(in, provider), true
	}
}
