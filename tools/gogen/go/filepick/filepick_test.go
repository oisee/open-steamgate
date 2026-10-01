package filepick

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdamore/tcell/v2"
	"osg/gogen/abap"
)

func simulated(t *testing.T, keys ...*tcell.EventKey) tcell.SimulationScreen {
	t.Helper()
	s := tcell.NewSimulationScreen("UTF-8")
	if err := s.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Fini)
	s.SetSize(100, 16)
	for _, key := range keys {
		s.PostEvent(key)
	}
	return s
}

func press(key tcell.Key) *tcell.EventKey { return tcell.NewEventKey(key, 0, tcell.ModNone) }
func letter(r rune) *tcell.EventKey       { return tcell.NewEventKey(tcell.KeyRune, r, tcell.ModNone) }

func TestOpenConfinedAndCancel(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	wanted := filepath.Join(root, "alpha.txt")
	if err := os.WriteFile(wanted, []byte("a"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(outside, []byte("b"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	b := Browser{Sandbox: &abap.Sandbox{Read: []string{root}}, Mode: Open}
	entries, err := b.entries(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].name != "alpha.txt" {
		t.Fatalf("visible entries: %+v", entries)
	}
	if _, _, err := b.Sandbox.BrowsePath(outside, false); err == nil {
		t.Fatal("path outside root accepted")
	}
	if _, _, err := b.Sandbox.BrowsePath(filepath.Join(root, "escape.txt"), false); err == nil {
		t.Fatal("symlink escape accepted")
	}
	s := simulated(t, press(tcell.KeyBackspace), press(tcell.KeyEnter))
	got, err := b.Run(s)
	if err != nil || got != wanted {
		t.Fatalf("picked %q: %v", got, err)
	}
	s = simulated(t, press(tcell.KeyEscape))
	_, err = b.Run(s)
	if !errors.Is(err, ErrCancel) {
		t.Fatalf("cancel: %v", err)
	}
}

func TestFilterSaveAndMissingGrants(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"alpha.txt", "beta.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	b := Browser{Sandbox: &abap.Sandbox{Read: []string{root}}, Mode: Open}
	s := simulated(t, letter('/'), letter('b'), press(tcell.KeyEnter), press(tcell.KeyEnter))
	got, err := b.Run(s)
	if err != nil || got != filepath.Join(root, "beta.txt") {
		t.Fatalf("filtered pick %q: %v", got, err)
	}
	save := Browser{Sandbox: &abap.Sandbox{Write: []string{root}}, Mode: Save, DefaultName: "new.txt"}
	s = simulated(t, letter('n'), press(tcell.KeyEnter))
	got, err = save.Run(s)
	if err != nil || got != filepath.Join(root, "new.txt") {
		t.Fatalf("save %q: %v", got, err)
	}
	if _, err := save.Sandbox.BrowseSaveName(filepath.Join(root, "..", "outside.txt")); err == nil {
		t.Fatal("save outside root accepted")
	}
	if _, err := save.Sandbox.BrowseSaveName(root); err == nil {
		t.Fatal("directory accepted as a save filename")
	}
	for _, mode := range []Mode{Open, Save, Directory} {
		_, err := (Browser{Sandbox: &abap.Sandbox{}, Mode: mode}).Run(simulated(t))
		if err == nil || !strings.Contains(err.Error(), "-allow-") {
			t.Fatalf("mode %v: %v", mode, err)
		}
	}
}
