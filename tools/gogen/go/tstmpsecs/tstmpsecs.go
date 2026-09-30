// Package tstmpsecs is the part of CL_ABAP_TSTMP that open-abap-core writes as
// kernel code and the Go runtime answers.
// (Not "tstmp": that is the parameter of SUBTRACTSECS itself, and a Go
// package named like a local of the calling method is shadowed there.)
package tstmpsecs

import (
	"fmt"
	"strings"
	"time"

	"osg/gogen/abap"
)

// SubtractSecs is CL_ABAP_TSTMP=>SUBTRACTSECS as open-abap-core computes it:
// ADD with the seconds negated, where ADD formats the time stamp as ISO, cuts
// its fraction, adds the seconds in UTC and writes YYYYMMDDhhmmss back. That
// copies open-abap-core and is not measured on a system. A value that is no
// time stamp (a RangeError from toISOString on Node) is refused.
func SubtractSecs(s *abap.Session, tstmp string, secs int32) string {
	return addSecs("CL_ABAP_TSTMP=>SUBTRACTSECS", tstmp, -int64(secs))
}

func addSecs(where, v string, secs int64) string {
	v = strings.TrimSpace(v)
	if i := strings.IndexByte(v, '.'); i >= 0 {
		v = v[:i]
	}
	t, err := time.Parse("20060102150405", fmt.Sprintf("%014s", v))
	if err != nil {
		panic(abap.NotCompiled(where, "a value that is not a time stamp: "+v))
	}
	return t.Add(time.Duration(secs) * time.Second).UTC().Format("20060102150405")
}
