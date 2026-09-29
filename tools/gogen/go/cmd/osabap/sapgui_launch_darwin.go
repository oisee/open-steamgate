//go:build darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func startSAPGUI(host, port string, _ int) error {
	connection := fmt.Sprintf("conn=/H/%s/S/%s", host, port)
	if configured := os.Getenv("OSABAP_SAPGUI"); configured != "" {
		cmd := exec.Command(configured, connection)
		if err := cmd.Start(); err != nil {
			return err
		}
		return cmd.Process.Release()
	}
	cmd := exec.Command("/usr/bin/open", "-b", "com.sap.platin", "--args", connection)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
