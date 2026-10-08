package main

import (
	"osg/gogen/abap"
	"osg/gogen/adtsystem"
	"osg/gogen/objstore"
	"strings"
)

var adtSystems adtsystem.Bindings

// Generated OSGo store calls retain the caller instead of dropping it at
// abap.StoreCall. Ordinary commands keep the runtime's scalar/table adapter.
func osgoStore(s *abap.Session, args map[string]abap.Data) {
	in := map[string]*string{}
	for k, d := range args {
		if strings.HasPrefix(strings.ToUpper(k), "IV_") {
			v := abap.DataString(d)
			in[strings.ToUpper(k)] = &v
		}
	}
	if in["IV_COMMAND"] == nil || strings.ToUpper(strings.TrimSpace(*in["IV_COMMAND"])) != "SYSTEM" || adtSystems.For(s) == nil {
		abap.ZOSD_STORE(s, args)
		return
	}
	answer := objstore.CallWithSystem(in, adtSystems.For(s))
	for k, d := range args {
		if v, ok := answer.Scalars[strings.ToUpper(k)]; ok {
			abap.MoveData(d, abap.Data{P: &v, T: abap.TString})
		}
	}
}
