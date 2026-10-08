//go:build linux

package compiler

import (
	"golang.org/x/sys/unix"
)

func waitForExitWithoutReap(pid int) {
	var info unix.Siginfo
	var usage unix.Rusage
	_ = unix.Waitid(unix.P_PID, pid, &info, unix.WEXITED|unix.WNOWAIT, &usage)
}
