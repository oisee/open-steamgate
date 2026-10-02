// Package runtimeclock implements GET RUN TIME FIELD for the Go host.
package runtimeclock

import (
	"sync"
	"time"
)

var clock struct {
	sync.Mutex
	origin time.Time
}

// Microseconds counts from the run's first GET RUN TIME (FIX.md).
// time.Now retains Go's monotonic reading; wall-clock changes cannot affect it.
// Conversion to int32 gives the ABAP i field its signed 32-bit representation.
func Microseconds() int32 {
	clock.Lock()
	defer clock.Unlock()
	if clock.origin.IsZero() {
		clock.origin = time.Now()
		return 0
	}
	// The origin is per process, and an i of microseconds wraps after
	// about 35.8 minutes; what a system answers past that is not measured
	// (byte-section-notes.md, next oracle rows), so a long-running server
	// should measure short spans only.
	return int32(time.Since(clock.origin).Microseconds())
}
