package main

import "osg/gogen/abap"

// osgo.mjs installs the generated adapter only when both ADT classes exist.
// The fallback and host lifecycle require no generated ADT types.
var bindADTSession = func(s *abap.Session) func() { return func() {} }
var hasADTSession bool

func withADTSession(s *abap.Session, work func()) {
	step := &adtENQStep{handles: make(map[int64]string)}
	adtCurrentStep = step // all dialog steps hold the work-process lock
	defer func() { adtCurrentStep = nil }()
	defer func() {
		dumped := recover()
		for sid, id := range step.handles {
			if dumped != nil {
				adtKernel.DropContext(id, sid)
			}
			adtKernel.Unpin(sid)
		}
		if dumped != nil {
			panic(dumped)
		}
	}()
	clear := bindADTSession(s)
	defer clear()
	work()
}
