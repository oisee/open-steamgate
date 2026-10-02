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
	return int32(time.Since(clock.origin).Microseconds())
}
