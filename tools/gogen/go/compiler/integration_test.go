package compiler

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Opt in from the registered mocha suite; unit tests require no Node installation.
func TestRealSidecar(t *testing.T) {
	launcher := os.Getenv("OSGO_COMPILER_INTEGRATION")
	if launcher == "" {
		t.Skip("real sidecar is exercised by test/osgo-compiler.mjs")
	}
	t.Setenv("OSGO_SIDECAR", launcher)
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	config := `{"syntax":{"version":"v702"}}`
	for name, raw := range map[string]string{"abap_transpile.json": `{"input_folder":["src"],"libs":[]}`, "abaplint.jsonc": config} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
	}
	c := New(Options{Root: root, Version: "integration"})
	t.Cleanup(func() { _ = c.Close() })
	path := "src/zcl_fixture.clas.abap"
	fixture := func(method string) Snapshot {
		raw := fmt.Sprintf("CLASS zcl_fixture DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    METHODS %s.\nENDCLASS.\nCLASS zcl_fixture IMPLEMENTATION.\n  METHOD %s.\n  ENDMETHOD.\nENDCLASS.\n", method, method)
		if err := os.WriteFile(filepath.Join(root, path), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		snap, err := BuildSnapshot(root, "fixture-generation", []ObjectFiles{{Type: "CLAS", Name: "ZCL_FIXTURE", Version: "inactive", Files: []string{path}}})
		if err != nil {
			t.Fatal(err)
		}
		return snap
	}
	t.Run("clean", func(t *testing.T) {
		result, err := c.Check(context.Background(), fixture("run"))
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Diagnostics) != 0 || len(result.RegistryHash) != 64 || result.ConfigSha != fmt.Sprintf("%x", sha256.Sum256([]byte(config))) || result.InputCount != 1 || len(result.VirtualFiles) != 0 {
			t.Fatalf("clean verdict: %+v", result)
		}
		if c.Status().Contract != 1 || !c.Status().Found || c.Status().Transpiler == "" || c.Status().OSD == "" {
			t.Fatalf("hello: %+v", c.Status())
		}
	})
	t.Run("syntax", func(t *testing.T) {
		result, err := c.Check(context.Background(), fixture(strings.Repeat("a", 31)))
		if err != nil {
			t.Fatal(err)
		}
		for _, issue := range result.Diagnostics {
			if issue.Line == 3 && issue.Col == 12 && issue.EndLine == 3 && issue.EndCol == 42 && issue.Severity == "E" && issue.Code == "ABAP_SYNTAX" && issue.Include == path && issue.Object == (ObjectID{"CLAS", "ZCL_FIXTURE"}) && issue.Text != "" {
				return
			}
		}
		t.Fatalf("syntax coordinates: %+v", result.Diagnostics)
	})
	t.Run("hash-lie", func(t *testing.T) {
		snap := fixture("run")
		snap.Objects[0].Files[0].SHA256 = strings.Repeat("0", 64)
		_, err := c.Check(context.Background(), snap)
		code(t, err, "SNAPSHOT_MISMATCH")
	})
}
