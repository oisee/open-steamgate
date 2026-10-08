//go:build !windows

package compiler

import (
	"errors"
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
		// Only an observed exit closes exited: a failed wait must not make a
		// healthy sidecar look dead (the reader still sees a real death as EOF).
		// ECHILD: cleanup has already reaped it, so it has exited too.
		if err := waitForExitWithoutReap(cmd.Process.Pid); err == nil || errors.Is(err, syscall.ECHILD) {
			close(exited)
		}
	}()
	return processLifecycle{
		kill:   func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) },
		wait:   func() error { return cmd.Wait() },
		exited: exited,
	}, nil
}
