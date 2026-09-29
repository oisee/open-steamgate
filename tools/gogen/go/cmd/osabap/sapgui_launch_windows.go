//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func startSAPGUI(host, _ string, instance int) error {
	executable, err := windowsSAPGUIExecutable()
	if err != nil {
		return err
	}
	cmd := exec.Command(executable, host, fmt.Sprintf("%02d", instance))
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func windowsSAPGUIExecutable() (string, error) {
	if configured := os.Getenv("OSABAP_SAPGUI"); configured != "" {
		return configured, nil
	}
	if executable, err := exec.LookPath("sapgui.exe"); err == nil {
		return executable, nil
	}
	for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)")} {
		if root == "" {
			continue
		}
		candidate := filepath.Join(root, "SAP", "FrontEnd", "SAPGUI", "sapgui.exe")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("sapgui.exe not found in PATH or Program Files; set OSABAP_SAPGUI")
}
