//go:build !windows

package abap

import (
	"os"
	"syscall"
)

func openBrowseDirectory(root *os.Root, rel string) (*os.File, error) {
	return root.OpenFile(rel, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_DIRECTORY, 0)
}
