// Package session resets process-wide ABAP state at an internal-session boundary.
// The unit runner calls Reset between test classes. Database state is outside
// this reset; database copies belong to a separate unit-runner change.
package session

import "sync"

var resetters []func()
var classMu sync.Mutex
var classRunning bool

// Register adds one reset function for a generated class or runtime store.
// Registration happens during package initialization, before unit execution.
func Register(reset func()) { resetters = append(resetters, reset) }

// Reset starts a fresh internal session. It assumes test classes run one at a
// time: generated class statics and constructor flags are process globals.
// BeginTestClass holds this invariant through the entire test class.
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
// Parallel test classes require class statics to move into Session first.
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
