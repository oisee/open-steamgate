package compiler

import (
	"golang.org/x/sys/windows"
	"testing"
)

func enableDescendantReaping()              {}
func requireDescendantPolling(t *testing.T) {}
func descendantGone(pid int) (bool, error) {
	process, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err == windows.ERROR_INVALID_PARAMETER {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(process)
	status, err := windows.WaitForSingleObject(process, 0)
	return status == windows.WAIT_OBJECT_0, err
}
