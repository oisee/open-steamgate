//go:build !windows

package compiler

import (
	"syscall"
	"testing"
)

func makeSnapshotFifo(t *testing.T, path string) {
	t.Helper()
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
}
