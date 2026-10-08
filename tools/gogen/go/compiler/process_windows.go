package compiler

import (
	"os"
	"os/exec"
	"strconv"
)

func sidecarName() string                  { return "osd.exe" }
func executableFile(info os.FileInfo) bool { return true }
func configureProcess(cmd *exec.Cmd)       {}
func killProcess(cmd *exec.Cmd) {
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
	_ = cmd.Process.Kill()
}
