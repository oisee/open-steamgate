package compiler

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"time"
)

func sidecarName() string                  { return "osd.exe" }
func executableFile(info os.FileInfo) bool { return true }
func configureProcess(cmd *exec.Cmd)       {}
func killProcess(cmd *exec.Cmd) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, "taskkill", "/F", "/T", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
	_ = cmd.Process.Kill()
}
