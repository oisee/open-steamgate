package main

import "osg/gogen/abap"

// The ICF entry reads the handler's class-static session slot. Bind inside
// the serialized dialog step, just as Node's sessionFor creates its adapter
// inside the request's step. Clear before the step ends, including on a dump.
func withADTSession(s *abap.Session, work func()) {
	session := New_ZCL_OSD_ADT_SESSION(s, 1800, "0")
	ZCL_OSD_ADT_HANDLER_USE_SESSION(s, session)
	defer ZCL_OSD_ADT_HANDLER_USE_SESSION(s, nil)
	work()
}
