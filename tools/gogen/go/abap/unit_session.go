package abap

import (
	"osg/gogen/amc"
	"osg/gogen/session"
)

// EndTestClass releases session-owned resources before the next test class.
func EndTestClass(s *Session) {
	CloseSessionDatasets(s)
	amc.Current().Forget(s)
	session.EndTestClass()
}
