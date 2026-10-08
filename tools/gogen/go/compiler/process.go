package compiler

import "os/exec"

func watchProcessExit(cmd *exec.Cmd) (<-chan struct{}, <-chan error) {
	dead, waited := make(chan struct{}), make(chan error, 1)
	go func() {
		waited <- cmd.Wait()
		close(dead)
	}()
	return dead, waited
}
