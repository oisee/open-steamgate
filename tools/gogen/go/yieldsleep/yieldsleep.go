// Package yieldsleep gives up the work process during an in-step sleep.
package yieldsleep

import (
	"time"

	"osg/gogen/abap"
)

// Sleep commits the database LUW, as WAIT UP TO does, yields WorkProcess only
// when this Session's host step owns it, and reacquires it before returning.
func Sleep(s *abap.Session, d time.Duration) {
	abap.CommitWork(s)
	if s == nil || !s.HoldsWorkProcess {
		time.Sleep(d)
		return
	}
	abap.WorkProcess.Unlock()
	time.Sleep(d)
	abap.WorkProcess.Lock()
}
