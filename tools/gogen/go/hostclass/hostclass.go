// Package hostclass exposes host replacements for selected generated ABAP
// classes. Generated code keeps the ABAP fallback and only consults these
// hooks when a host installs one.
package hostclass

import (
	"time"

	"osg/gogen/enq"
)

// Raise asks generated code to raise an ABAP exception via the required
// static Factory on Class. Text is only diagnostic text for Error(); it is
// never used to construct the exception.
type Raise struct {
	Class   string
	Factory string
	Text    string
}

func (e *Raise) Error() string {
	if e == nil {
		return "<nil>"
	}
	if e.Text == "" {
		return e.Class
	}
	return e.Class + ": " + e.Text
}

// ZCL_OSD_ENQ_KERNEL contains one field per replaced method. step is the
// calling step's *abap.Session (as any): the host keys its per-step state
// on it, since a yield inside a step lets another step run meanwhile. A second
// replaced class gets its own named variable beside this one.
var ZCL_OSD_ENQ_KERNEL = struct {
	Bind         func(step any, id, user string) (bool, error)
	End          func(step any, id string) error
	Revive       func(step any, id string) error
	ContextAlive func(step any, id string) (bool, error)
	Owns         func(step any, id string) (bool, error)
	SessionID    func(step any, id string) (string, error)
}{}

// KERNEL_LOCK is the host replacement for the one kernel lock object. A nil
// field leaves the generated caller's refusal unchanged.
var KERNEL_LOCK = struct {
	Enqueue    func(step any, r enq.Request, sleep func(time.Duration)) (enq.Result, error)
	Dequeue    func(step any, r enq.Request) error
	DequeueAll func(step any) error
}{}

// LUW is the host's part of explicit COMMIT WORK and ROLLBACK WORK.
// step is the calling *abap.Session; nil callbacks preserve database behavior.
var LUW = struct {
	Commit   func(step any, updated bool) error
	Rollback func(step any) error
}{}
