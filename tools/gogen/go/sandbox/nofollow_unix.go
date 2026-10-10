//go:build unix

package sandbox

import (
	"errors"
	"syscall"
)

// noFollow refuses to open a last component that is a symlink
const noFollow = syscall.O_NOFOLLOW

func isSymlinkLoop(err error) bool { return errors.Is(err, syscall.ELOOP) }

// A swapped FIFO must not block before the regular-file identity check.
const nonBlock = syscall.O_NONBLOCK
