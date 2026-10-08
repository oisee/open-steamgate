//go:build linux

package compiler

import (
	"golang.org/x/sys/unix"
)

// waitForExitWithoutReap returns nil once pid has exited (still unreaped);
// an interrupted wait is retried, any other error is returned.
func waitForExitWithoutReap(pid int) error {
	for {
		var info unix.Siginfo
		var usage unix.Rusage
		err := unix.Waitid(unix.P_PID, pid, &info, unix.WEXITED|unix.WNOWAIT, &usage)
		if err != unix.EINTR {
			return err
		}
	}
}
