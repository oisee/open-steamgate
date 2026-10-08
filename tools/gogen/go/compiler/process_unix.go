//go:build !windows

package compiler

import (
	"os"
	"os/exec"
	"syscall"
)

func sidecarName() string                  { return "osd" }
func executableFile(info os.FileInfo) bool { return info.Mode()&0111 != 0 }
func startProcess(cmd *exec.Cmd) (processLifecycle, error) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return processLifecycle{}, err
	}
	exited := make(chan struct{})
	go func() {
		defer close(exited)
		waitForExitWithoutReap(cmd.Process.Pid)
	}()
	return processLifecycle{
		kill:   func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) },
		wait:   func() error { return cmd.Wait() },
		exited: exited,
	}, nil
}
