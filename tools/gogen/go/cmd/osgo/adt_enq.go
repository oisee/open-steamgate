package main

// The ADT session's ENQ kernel (ZCL_OSD_ENQ_KERNEL) is host-replaced, as the
// Node host does in tools/osd-enq-session.mjs: go/adtenq answers it over one
// process-wide lock server, named "osd" like Node's (tools/osd-enq.mjs).
// Bind keeps Node's contract: an ended context is (false, nil) and ABAP
// cleans its row; any other failure is an error, which the seam dumps.

import (
	"osg/gogen/adtenq"
	"osg/gogen/enq"
	"osg/gogen/hostclass"
)

var adtLocks = enq.New("osd")
var adtKernel = adtenq.New(adtLocks)

type adtENQStep struct{ handles map[int64]string }

var adtCurrentStep *adtENQStep

func init() {
	k := adtKernel
	h := &hostclass.ZCL_OSD_ENQ_KERNEL
	h.Bind = func(id, user string) (bool, error) {
		if step := adtCurrentStep; step != nil {
			current, exists := k.Handle(id)
			if _, pinned := step.handles[current]; !exists || !pinned {
				sid, ok, err := k.Pin(id, user)
				if ok && err == nil {
					step.handles[sid] = id
				}
				return ok, err
			}
		}
		return k.Bind(id, user)
	}
	h.End = func(id string) error { k.End(id); return nil }
	h.Revive = func(id string) error { k.Revive(id); return nil }
	h.ContextAlive = func(id string) (bool, error) { return k.ContextAlive(id), nil }
	h.Owns = func(id string) (bool, error) { return k.Owns(id), nil }
	h.SessionID = func(id string) (string, error) { return k.SessionID(id), nil }
}
