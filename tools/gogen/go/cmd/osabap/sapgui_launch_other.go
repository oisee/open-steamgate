//go:build !darwin && !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func startSAPGUI(host, port string, _ int) error {
	executable := os.Getenv("OSABAP_SAPGUI")
	if executable == "" {
		return fmt.Errorf("automatic SAP GUI launch is not configured on this platform; set OSABAP_SAPGUI")
	}
	cmd := exec.Command(executable, fmt.Sprintf("conn=/H/%s/S/%s", host, port))
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
