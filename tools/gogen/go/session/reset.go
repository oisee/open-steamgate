// Package session resets remaining process-wide runtime stores between test classes.
// The unit runner calls Reset between test classes. Database state is outside
// this reset; database copies belong to a separate unit-runner change.
package session

import "sync"

var resetters []func()
var classMu sync.Mutex
var classRunning bool

// Register adds a reset function for a process-wide runtime store.
// Class statics and constructor flags belong to abap.Session and need no callback.
// Registration happens during package initialization, before unit execution.
func Register(reset func()) { resetters = append(resetters, reset) }

// Reset clears registered runtime stores between test classes.
// BeginTestClass reserves those stores through the entire test class.
func Reset() {
	classMu.Lock()
	defer classMu.Unlock()
	if classRunning {
		panic("session.Reset while a test class is running")
	}
	reset()
}

func reset() {
	for _, reset := range resetters {
		reset()
	}
}

// BeginTestClass resets process state and reserves it until EndTestClass.
// Class statics are isolated by each fresh abap.Session; remaining registered
// runtime stores still require test classes to run one at a time.
func BeginTestClass() {
	classMu.Lock()
	defer classMu.Unlock()
	if classRunning {
		panic("test classes must run one at a time")
	}
	reset()
	classRunning = true
}

func EndTestClass() {
	classMu.Lock()
	defer classMu.Unlock()
	if !classRunning {
		panic("session.EndTestClass without BeginTestClass")
	}
	classRunning = false
}
