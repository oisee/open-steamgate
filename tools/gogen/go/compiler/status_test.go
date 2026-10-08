package compiler

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestStatusJSON(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OSGO_SIDECAR", executable)
	t.Setenv("COMPILER_FAKE", "answer")
	raw, err := StatusJSON(nil, Options{Root: "test-root", Version: "test-version", CheckTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	var status Status
	if err = json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	if !status.Found || status.OSD != "test-osd" || status.Transpiler != "test-pin" || status.Contract != 1 {
		t.Fatalf("status: %+v", status)
	}
}
