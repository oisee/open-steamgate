// Package yieldsleep gives up the work process during an in-step sleep.
package yieldsleep

import (
	"time"
)

// Sleep commits the database LUW, as WAIT UP TO does, yields WorkProcess only
// when this Session's host step owns it, and reacquires it before returning.
type sleeper interface{ YieldSleep(time.Duration) }

func Sleep(step any, d time.Duration) {
	if s, ok := step.(sleeper); ok {
		s.YieldSleep(d)
		return
	}
	time.Sleep(d)
}
