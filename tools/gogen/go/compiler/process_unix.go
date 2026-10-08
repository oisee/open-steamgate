//go:build !windows

package compiler

import (
	"os"
	"os/exec"
	"syscall"
)

func sidecarName() string                  { return "osd" }
func executableFile(info os.FileInfo) bool { return info.Mode()&0111 != 0 }
func startProcess(cmd *exec.Cmd) (func(), error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }, nil
}
