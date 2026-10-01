package filepick

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdamore/tcell/v2"
	"osg/gogen/abap"
)

func TestLongDirectoryViewportAndNavigation(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 40; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("item%02d.txt", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	b := Browser{Sandbox: &abap.Sandbox{Read: []string{root}}, Mode: Open}
	entries, err := b.entries(root, "")
	if err != nil {
		t.Fatal(err)
	}
	s := simulated(t)
	s.SetSize(80, 10) // six visible entry rows
	for _, selected := range []int{0, 5, 6, 29, 39, 12, 0} {
		start := visibleStart(selected, 0, len(entries), 10)
		if selected < start || selected >= start+6 {
			t.Fatalf("selected row %d outside viewport starting at %d", selected, start)
		}
		b.draw(s, root, entries, selected, start, "", "", false, false)
		_, _, style, _ := s.GetContent(0, selected-start+3)
		_, _, reverse := style.Decompose()
		if reverse&tcell.AttrReverse == 0 {
			t.Fatalf("selected row %d is not highlighted", selected)
		}
	}
	for _, keys := range [][]*tcell.EventKey{
		{press(tcell.KeyEnd), press(tcell.KeyEnter)},
		{press(tcell.KeyPgDn), press(tcell.KeyPgDn), press(tcell.KeyPgUp), press(tcell.KeyHome), press(tcell.KeyEnter)},
	} {
		want := "item39.txt"
		if len(keys) > 2 {
			want = "item00.txt"
		}
		pick := simulated(t, keys...)
		pick.SetSize(80, 10)
		got, err := b.Run(pick)
		if err != nil || got != filepath.Join(root, want) {
			t.Fatalf("navigation picked %q, %v; want %s", got, err, want)
		}
	}
}

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
	outside := filepath.Join(t.TempDir(), "outside.txt")
	os.WriteFile(outside, nil, 0600)
	link := filepath.Join(root, "link.txt")
	os.Symlink(outside, link)
	if _, err := save.Sandbox.BrowseSaveName(link); err == nil {
		t.Fatal("symlink save target accepted")
	}
	for _, mode := range []Mode{Open, Save, Directory} {
		_, err := (Browser{Sandbox: &abap.Sandbox{}, Mode: mode}).Run(simulated(t))
		if err == nil || !strings.Contains(err.Error(), "-allow-") {
			t.Fatalf("mode %v: %v", mode, err)
		}
	}
}

func TestOpenAndDirectoryRequireReadGrant(t *testing.T) {
	private := t.TempDir()
	name := filepath.Join(private, "private.txt")
	if err := os.WriteFile(name, nil, 0600); err != nil {
		t.Fatal(err)
	}
	sb := &abap.Sandbox{Write: []string{private}}
	for _, mode := range []Mode{Open, Directory} {
		b := Browser{Sandbox: sb, Mode: mode, Initial: private}
		if _, err := b.initial(); err == nil || !strings.Contains(err.Error(), "-allow-read") {
			t.Fatalf("mode %v accepted write-only root: %v", mode, err)
		}
		if _, err := b.entries(private, ""); err == nil {
			t.Fatalf("mode %v listed write-only root", mode)
		}
		if _, ok := b.selected(private, entry{name: "private.txt"}); ok {
			t.Fatalf("mode %v returned write-only file", mode)
		}
	}
	if _, f, err := sb.BrowsePath(name, false); err == nil {
		f.Close()
		t.Fatal("write-only file opened by picker")
	}
	if roots := sb.BrowseRoots(true); len(roots) != 1 || roots[0] != private {
		t.Fatalf("save roots: %v", roots)
	}
}

func TestSwapAfterListingIsRefused(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	os.Mkdir(root, 0700)
	outside := filepath.Join(base, "outside")
	os.WriteFile(outside, []byte("secret"), 0600)
	for _, mode := range []Mode{Open, Save, Directory} {
		name := "target"
		path := filepath.Join(root, name)
		if mode == Directory {
			os.Mkdir(path, 0700)
		} else {
			os.WriteFile(path, nil, 0600)
		}
		b := Browser{Sandbox: &abap.Sandbox{Read: []string{root}, Write: []string{root}}, Mode: mode}
		swapped := false
		b.afterList = func() {
			if swapped {
				return
			}
			swapped = true
			os.Remove(path)
			if err := os.Symlink(outside, path); err != nil {
				t.Fatal(err)
			}
		}
		_, err := b.Run(simulated(t, press(tcell.KeyEnter), press(tcell.KeyEscape)))
		if !errors.Is(err, ErrCancel) {
			t.Fatalf("mode %v selected swapped link: %v", mode, err)
		}
		os.Remove(path)
	}
}

func TestSAPFilterExtensionAndMulti(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"a.txt", "b.txt", "c.bin"} {
		os.WriteFile(filepath.Join(root, name), nil, 0600)
	}
	patterns := SAPPatterns("Text (*.txt)|*.txt|Binary (*.bin)|*.bin")
	if len(patterns) != 2 {
		t.Fatalf("patterns: %v", patterns)
	}
	b := Browser{Sandbox: &abap.Sandbox{Read: []string{root}}, Mode: Open, Patterns: SAPPatterns("Text (*.txt)|*.txt"), Multi: true}
	path, err := b.Run(simulated(t, letter(' '), press(tcell.KeyDown), letter(' '), press(tcell.KeyEnter)))
	if err != nil || path != filepath.Join(root, "a.txt")+"\x00"+filepath.Join(root, "b.txt") {
		t.Fatalf("multi: %q %v", path, err)
	}
	open := Browser{Sandbox: &abap.Sandbox{Read: []string{root}}, Mode: Open, DefaultName: "a", Extension: "txt"}
	path, err = open.Run(simulated(t, letter('n'), press(tcell.KeyEnter)))
	if err != nil || path != filepath.Join(root, "a.txt") {
		t.Fatalf("open extension: %q %v", path, err)
	}
	save := Browser{Sandbox: &abap.Sandbox{Write: []string{root}}, Mode: Save, Extension: "txt", DefaultName: "new"}
	path, err = save.Run(simulated(t, letter('n'), press(tcell.KeyEnter)))
	if err != nil || path != filepath.Join(root, "new.txt") {
		t.Fatalf("extension: %q %v", path, err)
	}
	save.DefaultName, save.ConfirmOverwrite = "a.txt", true
	path, err = save.Run(simulated(t, letter('n'), press(tcell.KeyEnter), letter('n'), press(tcell.KeyEscape)))
	if !errors.Is(err, ErrCancel) || path != "" {
		t.Fatalf("overwrite declined: %q %v", path, err)
	}
	path, err = save.Run(simulated(t, letter('n'), press(tcell.KeyEnter), press(tcell.KeyEscape)))
	if !errors.Is(err, ErrCancel) || path != "" {
		t.Fatalf("overwrite Esc did not cancel: %q %v", path, err)
	}
	path, err = save.Run(simulated(t, letter('n'), press(tcell.KeyEnter), letter('n'), letter('n'), press(tcell.KeyEnter), letter('y')))
	if err != nil || path != filepath.Join(root, "a.txt") {
		t.Fatalf("overwrite N did not stay in dialog: %q %v", path, err)
	}
}

func TestOverwriteCheckRejectsSwappedSymlink(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	os.WriteFile(outside, nil, 0600)
	b := Browser{Sandbox: &abap.Sandbox{Write: []string{root}}, Mode: Save, ConfirmOverwrite: true}
	path, ok := b.saveName(root, "target.txt")
	if !ok {
		t.Fatal("save name refused")
	}
	for _, target := range []string{outside, filepath.Join(t.TempDir(), "missing.txt")} {
		if err := os.Symlink(target, path); err != nil {
			t.Fatal(err)
		}
		// No key is posted: a prompt would hang. Neither target's existence
		// may change the response to a swapped link.
		if confirmed, err := b.confirmSave(simulated(t), path); confirmed || err != nil {
			t.Fatal("swapped symlink accepted")
		}
		os.Remove(path)
	}
}

func TestBackspaceSwitchesGrantedRoots(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	wanted := filepath.Join(second, "chosen.txt")
	if err := os.WriteFile(wanted, nil, 0600); err != nil {
		t.Fatal(err)
	}
	b := Browser{Sandbox: &abap.Sandbox{Read: []string{first, second}}, Mode: Open}
	got, err := b.Run(simulated(t, press(tcell.KeyBackspace), press(tcell.KeyDown), press(tcell.KeyEnter), press(tcell.KeyEnter)))
	if err != nil || got != wanted {
		t.Fatalf("second root: %q, %v", got, err)
	}
}
