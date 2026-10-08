package compiler

import (
	"syscall"
	"testing"
)

// Adopt and reap orphan fixture descendants, including in containers whose PID 1
// does not reap zombies. Production process-group behavior is unchanged.
func enableDescendantReaping() {
	_, _, err := syscall.Syscall6(syscall.SYS_PRCTL, 36, 1, 0, 0, 0, 0) // PR_SET_CHILD_SUBREAPER
	if err != 0 {
		panic(err)
	}
}
func requireDescendantPolling(t *testing.T) {}
func descendantGone(pid int) (bool, error) {
	_, _ = syscall.Wait4(pid, nil, syscall.WNOHANG, nil)
	err := syscall.Kill(pid, 0)
	if err == syscall.ESRCH {
		return true, nil
	}
	return false, err
}
