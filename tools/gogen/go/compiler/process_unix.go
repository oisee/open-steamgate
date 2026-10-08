//go:build !windows

package compiler

import (
	"os"
	"os/exec"
	"syscall"
)

func sidecarName() string                  { return "osd" }
func executableFile(info os.FileInfo) bool { return info.Mode()&0111 != 0 }
func configureProcess(cmd *exec.Cmd)       { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func killProcess(cmd *exec.Cmd)            { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
