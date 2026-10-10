//go:build windows

package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsFileGrantCaseAndDrive(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "Input.txt")
	sibling := filepath.Join(dir, "Sibling.txt")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(sibling, []byte("secret"), 0600)
	g, err := PinRead(strings.ToLower(file))
	if err != nil {
		t.Fatal(err)
	}
	sb := &Sandbox{}
	defer sb.Close()
	sb.InstallRead(g)
	for _, name := range []string{file, strings.ToUpper(file), strings.ToLower(file[:2]) + file[2:], file + `\`} {
		if h, msg := sb.Open(name, Input); h == nil {
			t.Fatal(name, msg)
		} else {
			h.Close()
		}
	}
	for _, name := range []string{strings.ToUpper(sibling), dir, filepath.Join(dir, "..", "Sibling.txt")} {
		if h, _ := sb.Open(name, Input); h != nil {
			h.Close()
			t.Fatal("widened", name)
		}
	}
}

// UNC names stay on their specified volume, while relative DATASET names use
// the explicit home. These lexical checks need no network share or credentials.
func TestWindowsUNCResolution(t *testing.T) {
	sb := &Sandbox{Home: `\\example.invalid\share\input`}
	for name, want := range map[string]string{
		`file.txt`:                         `\\example.invalid\share\input\file.txt`,
		`..\file.txt`:                      `\\example.invalid\share\file.txt`,
		`\\example.invalid\other\file.txt`: `\\example.invalid\other\file.txt`,
	} {
		got, err := sb.datasetName(name)
		if err != nil || got != want {
			t.Fatal(name, got, want, err)
		}
	}
}
