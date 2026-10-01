// Package session resets process-wide ABAP state at an internal-session boundary.
// The unit runner calls Reset between test classes. Database state is outside
// this reset; database copies belong to a separate unit-runner change.
package session

var resetters []func()

// Register adds one reset function for a generated class or runtime store.
// Registration happens during package initialization, before unit execution.
func Register(reset func()) { resetters = append(resetters, reset) }

// Reset starts a fresh internal session. Call only while no ABAP step is running.
func Reset() {
	for _, reset := range resetters {
		reset()
	}
}
