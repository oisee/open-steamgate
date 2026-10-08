//go:build windows

package compiler

import "os"

func openSnapshotFile(root *os.Root, path string) (*os.File, error) {
	return root.OpenFile(path, os.O_RDONLY, 0)
}
