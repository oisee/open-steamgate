//go:build darwin

package compiler

import (
	"unsafe"

	"golang.org/x/sys/unix"
)

func waitForExitWithoutReap(pid int) error {
	for {
		var info [128]byte
		var usage unix.Rusage
		_, _, errno := unix.Syscall6(
			unix.SYS_WAITID,
			uintptr(1), // idtype_t P_PID
			uintptr(pid),
			uintptr(unsafe.Pointer(&info)),
			uintptr(unix.WEXITED|unix.WNOWAIT),
			uintptr(unsafe.Pointer(&usage)),
			0,
		)
		if errno == unix.EINTR {
			continue
		}
		if errno != 0 {
			return errno
		}
		return nil
	}
}
