package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The package on its own: a read root opens for INPUT and refuses OUTPUT,
// a write root is readable, a name outside both and a symlink out of a
// root are refused with a message, never a panic.
func TestRootsAndRefusals(t *testing.T) {
	base := t.TempDir()
	in, out, beyond := filepath.Join(base, "in"), filepath.Join(base, "out"), filepath.Join(base, "beyond")
	for _, d := range []string{in, out, beyond} {
		if err := os.Mkdir(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(filepath.Join(in, "a.txt"), []byte("one\n"), 0o644)
	os.WriteFile(filepath.Join(beyond, "secret.txt"), []byte("no\n"), 0o644)
	os.Symlink(filepath.Join(beyond, "secret.txt"), filepath.Join(in, "link.txt"))
	sb := &Sandbox{Read: []string{in}, Write: []string{out}}
	defer sb.Close()

	h, msg := sb.Open(filepath.Join(in, "a.txt"), Input)
	if h == nil || msg != "" {
		t.Fatalf("INPUT in a read root: %q", msg)
	}
	b, _ := h.ReadAt(0, 10)
	h.Close()
	if string(b) != "one\n" {
		t.Fatalf("read %q", b)
	}
	if h, msg := sb.Open(filepath.Join(in, "a.txt"), Output); h != nil || msg == "" {
		t.Fatal("OUTPUT in a read root was allowed")
	}
	if h, msg := sb.Open(filepath.Join(out, "new.txt"), Output); h == nil || msg != "" {
		t.Fatalf("OUTPUT in a write root: %q", msg)
	} else {
		h.Close()
	}
	if h, _ := sb.Open(filepath.Join(out, "new.txt"), Input); h == nil {
		t.Fatal("a write root is not readable")
	} else {
		h.Close()
	}
	for _, name := range []string{filepath.Join(beyond, "secret.txt"), filepath.Join(in, "link.txt"), filepath.Join(in, "..", "beyond", "secret.txt")} {
		if h, msg := sb.Open(name, Input); h != nil || !strings.Contains(msg, "outside") && msg == "" {
			t.Fatalf("%s: opened (%q)", name, msg)
		}
	}
	if (&Sandbox{}).Delete(filepath.Join(out, "new.txt")) {
		t.Fatal("a sandbox without roots deleted a file")
	}
}
