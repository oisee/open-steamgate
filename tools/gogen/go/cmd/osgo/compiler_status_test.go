package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"os"
	"os/exec"
	"strings"
	"testing"

	"osg/gogen/compiler"
)

func TestCompilerStatusProcess(t *testing.T) {
	switch os.Getenv("OSGO_STATUS_CHILD") {
	case "status":
		flag.CommandLine = flag.NewFlagSet("osgo", flag.ExitOnError)
		os.Args = []string{"osgo", "-compiler-status", "-root", "fixture-root"}
		main()
		os.Exit(0)
	case "sidecar":
		scanner := bufio.NewScanner(os.Stdin)
		if !scanner.Scan() {
			os.Exit(2)
		}
		var request map[string]any
		_ = json.Unmarshal(scanner.Bytes(), &request)
		if request["op"] != "hello" || request["root"] != "fixture-root" || request["osgo"] != releaseTag {
			os.Exit(3)
		}
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"id": 0, "contract": 1, "osd": "fixture-osd", "transpiler": "fixture-pin", "capabilities": []string{"check"}})
		for scanner.Scan() {
		}
		os.Exit(0)
	}
}
func TestCompilerStatusFlag(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, found := range []bool{false, true} {
		t.Run(map[bool]string{false: "absent", true: "found"}[found], func(t *testing.T) {
			sidecar := t.TempDir() + "/missing"
			if found {
				// The wrapper re-execs the test binary's protocol helper.
				sidecar = t.TempDir() + "/sidecar"
				script := "#!/bin/sh\nexport OSGO_STATUS_CHILD=sidecar\nexec '" + strings.ReplaceAll(executable, "'", "'\\''") + "' -test.run=^TestCompilerStatusProcess$\n"
				if err := os.WriteFile(sidecar, []byte(script), 0700); err != nil {
					t.Fatal(err)
				}
			}
			cmd := exec.Command(executable, "-test.run=^TestCompilerStatusProcess$")
			cmd.Env = append(os.Environ(), "OSGO_STATUS_CHILD=status", "OSGO_SIDECAR="+sidecar)
			raw, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("status must exit zero: %v %s", err, raw)
			}
			var status compiler.Status
			if err = json.Unmarshal(raw, &status); err != nil {
				t.Fatalf("JSON: %v %s", err, raw)
			}
			if status.Found != found {
				t.Fatalf("found: %+v", status)
			}
			if found && (status.OSD != "fixture-osd" || status.Transpiler != "fixture-pin" || status.Contract != 1) {
				t.Fatalf("hello: %+v", status)
			}
			if !found && !strings.Contains(status.LastError, "sidecar absent") {
				t.Fatalf("absent reason: %+v", status)
			}
		})
	}
}
