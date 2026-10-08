package main

import "osg/gogen/abap"

// osgo.mjs installs the generated adapter only when both ADT classes exist.
// The fallback and host lifecycle require no generated ADT types.
var bindADTSession = func(s *abap.Session) func() { return func() {} }
var hasADTSession bool

func withADTSession(s *abap.Session, work func()) {
	started := adtHost.Begin(s)
	defer func() {
		if started {
			recovered := recover()
			dumped := recovered != nil
			adtHost.Finish(s, dumped)
			if dumped {
				panic(recovered)
			}
		}
	}()
	clear := bindADTSession(s)
	defer clear()
	work()
}
