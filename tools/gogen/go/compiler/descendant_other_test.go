//go:build !linux && !windows

package compiler

import "testing"

func enableDescendantReaping() {}
func requireDescendantPolling(t *testing.T) {
	t.Skip("direct descendant polling fixture requires Linux or Windows")
}
func descendantGone(pid int) (bool, error) { return false, nil }
