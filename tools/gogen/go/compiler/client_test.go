package compiler

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestMain(m *testing.M) {
	if mode := os.Getenv("COMPILER_FAKE"); mode != "" {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			var request struct {
				ID       uint64 `json:"id"`
				Op       string `json:"op"`
				Contract int    `json:"contract"`
				OSGO     string `json:"osgo"`
				Root     string `json:"root"`
			}
			if json.Unmarshal(scanner.Bytes(), &request) != nil {
				os.Exit(3)
			}
			response := map[string]any{"id": request.ID}
			if request.Op == "hello" {
				if request.ID != 0 || request.Contract != 1 || request.OSGO != "test-version" || request.Root != "test-root" {
					os.Exit(4)
				}
				contract := 1
				if mode == "mismatch" {
					contract = 2
				}
				caps := []string{"check"}
				if mode == "unsupported" {
					caps = []string{}
				}
				response["contract"], response["osd"], response["transpiler"] = contract, "test-osd", "test-pin"
				response["capabilities"], response["limits"] = caps, Limits{1234, 1}
			} else {
				if marker := os.Getenv("COMPILER_MARKER"); marker != "" {
					_ = os.WriteFile(marker, []byte("sent"), 0600)
				}
				switch {
				case mode == "timeout":
					time.Sleep(time.Hour)
				case mode == "crash":
					os.Exit(5)
				case strings.HasPrefix(mode, "refuse:"):
					response["error"] = &Refusal{strings.TrimPrefix(mode, "refuse:"), "test refusal"}
				case mode == "bad-id":
					response["id"] = request.ID + 1
				default:
					response["diagnostics"] = []Diagnostic{{Severity: "E", Code: "ABAP_SYNTAX", Text: "fixture", Object: ObjectID{"CLAS", "ZCL_FIXTURE"}, Include: "src/fixture.clas.abap", Line: 3, Col: 12, EndLine: 3, EndCol: 42}}
					response["registryHash"], response["configSha"], response["inputCount"], response["virtualFiles"] = "registry", "config", 2, []string{"virtual"}
				}
			}
			_ = json.NewEncoder(os.Stdout).Encode(response)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func fake(t *testing.T, mode string) *Client {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("OSGO_SIDECAR", executable)
	t.Setenv("COMPILER_FAKE", mode)
	c := New(Options{Root: "test-root", Version: "test-version", CheckTimeout: time.Second, RestartBackoff: time.Millisecond})
	t.Cleanup(func() { _ = c.Close() })
	return c
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	var refusal *Refusal
	if !errors.As(err, &refusal) || refusal.Code != want {
		t.Fatalf("want %s, got %v", want, err)
	}
}
func TestDiscovery(t *testing.T) {
	dir := t.TempDir()
	sibling := filepath.Join(dir, sidecarName())
	override := filepath.Join(dir, "override")
	for _, path := range []string{sibling, override} {
		if err := os.WriteFile(path, []byte("fixture"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	exe := filepath.Join(dir, "osgo")
	path, err := discover(override, exe)
	if err != nil || path != override {
		t.Fatalf("env priority: %s %v", path, err)
	}
	path, err = discover(filepath.Join(dir, "missing"), exe)
	if err != nil || path != sibling {
		t.Fatalf("sibling fallback: %s %v", path, err)
	}
	if err := os.Remove(sibling); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	if err := os.WriteFile(sibling, []byte("fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	missingExe := filepath.Join(dir, "other", "osgo")
	_, err = discover("", missingExe)
	var absent *AbsentError
	if !errors.As(err, &absent) || !reflect.DeepEqual(absent.Paths, []string{filepath.Join(dir, "other", sidecarName())}) {
		t.Fatalf("PATH ignored / tried paths: %v", err)
	}
	_, err = discover(filepath.Join(dir, "absent-env"), missingExe)
	if !errors.As(err, &absent) || len(absent.Paths) != 2 {
		t.Fatalf("both paths recorded: %v", err)
	}
}
func TestHelloAndCheck(t *testing.T) {
	c := fake(t, "answer")
	if c.cmd != nil || c.Status().Found {
		t.Fatal("must be lazy")
	}
	result, err := c.Check(context.Background(), Snapshot{})
	if err != nil {
		t.Fatal(err)
	}
	if result.RegistryHash != "registry" || result.ConfigSha != "config" || result.InputCount != 2 || !reflect.DeepEqual(result.VirtualFiles, []string{"virtual"}) || len(result.Diagnostics) != 1 || result.Diagnostics[0].Col != 12 {
		t.Fatalf("answer: %+v", result)
	}
	status := c.Status()
	if !status.Found || status.Path == "" || status.OSD != "test-osd" || status.Transpiler != "test-pin" || status.Contract != 1 || status.Limits != (Limits{1234, 1}) || !reflect.DeepEqual(status.Capabilities, []string{"check"}) {
		t.Fatalf("hello: %+v", status)
	}
	status.Capabilities[0] = "mutated"
	if c.Status().Capabilities[0] != "check" {
		t.Fatal("status must be copied")
	}
}
func TestRefusals(t *testing.T) {
	for _, want := range []string{"UNSUPPORTED_OP", "SNAPSHOT_MISMATCH", "BUSY", "INTERNAL", "VERSION_MISMATCH"} {
		t.Run(want, func(t *testing.T) {
			c := fake(t, "refuse:"+want)
			_, err := c.Check(context.Background(), Snapshot{})
			code(t, err, want)
			if c.Status().LastError == "" {
				t.Fatal("last error missing")
			}
		})
	}
}
func TestUnsupportedWithoutSend(t *testing.T) {
	c := fake(t, "unsupported")
	marker := filepath.Join(t.TempDir(), "sent")
	t.Setenv("COMPILER_MARKER", marker)
	_, err := c.Check(context.Background(), Snapshot{})
	code(t, err, "UNSUPPORTED_OP")
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("check was sent: %v", err)
	}
}
func TestTimeoutRestart(t *testing.T) {
	c := fake(t, "timeout")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	c.options.CheckTimeout = 30 * time.Millisecond
	_, err := c.Check(context.Background(), Snapshot{})
	code(t, err, "TIMEOUT")
	if c.cmd != nil {
		t.Fatal("child retained")
	}
	t.Setenv("COMPILER_FAKE", "answer")
	c.options.CheckTimeout = time.Second
	if _, err = c.Check(context.Background(), Snapshot{}); err != nil {
		t.Fatal(err)
	}
	if c.Status().Restarts != 1 || !strings.Contains(c.Status().LastError, "TIMEOUT") {
		t.Fatalf("restart: %+v", c.Status())
	}
}
func TestCrashRestart(t *testing.T) {
	c := fake(t, "crash")
	_, err := c.Check(context.Background(), Snapshot{})
	code(t, err, "INTERNAL")
	if c.cmd != nil {
		t.Fatal("child retained")
	}
	t.Setenv("COMPILER_FAKE", "answer")
	if _, err = c.Check(context.Background(), Snapshot{}); err != nil {
		t.Fatal(err)
	}
	if c.Status().Restarts != 1 {
		t.Fatalf("restart count: %+v", c.Status())
	}
}
func TestContractMismatch(t *testing.T) {
	c := fake(t, "mismatch")
	err := c.Hello(context.Background())
	code(t, err, "CONTRACT_MISMATCH")
	if c.cmd != nil || c.Status().Contract != 2 {
		t.Fatal("mismatched process retained or contract lost")
	}
}
func TestBadID(t *testing.T) {
	c := fake(t, "bad-id")
	_, err := c.Check(context.Background(), Snapshot{})
	code(t, err, "INTERNAL")
	if c.cmd != nil {
		t.Fatal("bad protocol retained")
	}
}
func TestSerialized(t *testing.T) {
	c := fake(t, "answer")
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.Check(context.Background(), Snapshot{}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if c.nextID != 8 || c.Status().Restarts != 0 {
		t.Fatal("requests not serialized")
	}
}
func TestSnapshot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside")
	_ = os.WriteFile(outside, []byte("outside"), 0600)
	_ = os.WriteFile(filepath.Join(root, "file"), []byte("abc"), 0600)
	objects := []ObjectFiles{{Type: "CLAS", Name: "ZCL_FIXTURE", Version: "inactive", Files: []string{"file"}}}
	snap, err := BuildSnapshot(root, "generation", objects)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Objects[0].Files[0].SHA256 != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" || snap.Generation != "generation" || snap.Root != root {
		t.Fatalf("snapshot: %+v", snap)
	}
	if err = os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"../escape", outside, "link"} {
		objects[0].Files = []string{path}
		if _, err = BuildSnapshot(root, "generation", objects); err == nil {
			t.Fatalf("accepted escape %s", path)
		}
	}
}
