//go:build windows

package compiler

import "testing"

func makeSnapshotFifo(t *testing.T, path string) {
	t.Skip("FIFO fixture is Unix-specific")
}
