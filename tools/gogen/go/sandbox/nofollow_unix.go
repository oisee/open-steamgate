//go:build unix

package sandbox

import (
	"errors"
	"syscall"
)

// noFollow refuses to open a last component that is a symlink
const noFollow = syscall.O_NOFOLLOW

func isSymlinkLoop(err error) bool { return errors.Is(err, syscall.ELOOP) }
