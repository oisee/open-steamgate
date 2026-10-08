package main

// One process-wide lock server backs both the ADT context kernel and the
// generated ENQUEUE/DEQUEUE seam. adtlock owns the step-to-session glue.
import (
	"osg/gogen/abap"

	"osg/gogen/adtenq"
	"osg/gogen/adtlock"
	"osg/gogen/enq"
)

var (
	adtLocks  = enq.New("osd")
	adtKernel = adtenq.New(adtLocks)
	adtHost   = adtlock.New(adtLocks, adtKernel)
)

func init() {
	adtHost.User = func() string { return abap.UName }
	adtHost.Install()
}
