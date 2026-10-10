package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSingleFileGrant(t *testing.T) {
	dir := t.TempDir()
	file, sibling := filepath.Join(dir, "file"), filepath.Join(dir, "sibling")
	for _, path := range []string{file, sibling} {
		if err := os.WriteFile(path, []byte(path), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	h, message := sb.Open(file, Input)
	if h == nil {
		t.Fatal(message)
	}
	h.Close()
	for _, path := range []string{sibling, dir, filepath.Join(dir, ".."), filepath.Join(file, "..", "sibling")} {
		if h, _ := sb.Open(path, Input); h != nil {
			h.Close()
			t.Fatalf("allowed %s", path)
		}
	}
	for _, mode := range []Mode{Output, Appending, Update} {
		if h, _ := sb.Open(file, mode); h != nil {
			h.Close()
			t.Fatal("write granted", mode)
		}
	}
	if sb.Delete(file) {
		t.Fatal("delete granted")
	}
	if len(sb.BrowseRoots(false)) != 0 {
		t.Fatal("file grant widened browser")
	}
}

func TestFileGrantSymlinkAndSwap(t *testing.T) {
	dir := t.TempDir()
	file, sibling, link := filepath.Join(dir, "file"), filepath.Join(dir, "sibling"), filepath.Join(t.TempDir(), "link")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(sibling, []byte("secret"), 0600)
	if err := os.Symlink(file, link); err != nil {
		t.Skip(err)
	}
	sb := &Sandbox{ReadFiles: []string{link}}
	defer sb.Close()
	h, message := sb.Open(link, Input)
	if h == nil {
		t.Fatal(message)
	}
	h.Close()
	sb.BeforeOpen = func() {
		os.Remove(file)
		if err := os.Symlink(sibling, file); err != nil {
			t.Fatal(err)
		}
	}
	if h, _ := sb.Open(file, Input); h != nil {
		h.Close()
		t.Fatal("final symlink swap allowed")
	}
}

func TestFileGrantParentSwap(t *testing.T) {
	base := t.TempDir()
	parent, outside := filepath.Join(base, "parent"), filepath.Join(base, "outside")
	os.Mkdir(parent, 0700)
	os.Mkdir(outside, 0700)
	file := filepath.Join(parent, "file")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(filepath.Join(outside, "file"), []byte("secret"), 0600)
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	sb.BeforeOpen = func() {
		if err := os.Rename(parent, parent+"-old"); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, parent); err != nil {
			t.Fatal(err)
		}
	}
	h, message := sb.Open(file, Input)
	if h == nil {
		return
	} // refusal is also safe
	defer h.Close()
	data, _ := h.ReadAt(0, 100)
	if string(data) != "allowed" {
		t.Fatal(message, string(data))
	}
}

func TestFileGrantReplacementRefused(t *testing.T) {
	dir := t.TempDir()
	file, replacement := filepath.Join(dir, "file"), filepath.Join(dir, "replacement")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(replacement, []byte("secret"), 0600)
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	// Materialize grants at startup, then replace the file without a symlink.
	sb.BrowseRoots(false)
	if err := os.Rename(replacement, file); err != nil {
		t.Fatal(err)
	}
	if h, _ := sb.Open(file, Input); h != nil {
		h.Close()
		t.Fatal("replacement gained grant")
	}
}

func TestCheckedGrantInstallation(t *testing.T) {
	for _, directory := range []bool{false, true} {
		t.Run(map[bool]string{false: "file", true: "directory"}[directory], func(t *testing.T) {
			base := t.TempDir()
			parent, outside := filepath.Join(base, "parent"), filepath.Join(base, "outside")
			os.Mkdir(parent, 0700)
			os.Mkdir(outside, 0700)
			target := filepath.Join(parent, "target")
			secret := filepath.Join(outside, "target")
			name := target
			if directory {
				os.Mkdir(target, 0700)
				os.Mkdir(secret, 0700)
				name = filepath.Join(target, "child")
				secret = filepath.Join(secret, "child")
			}
			os.WriteFile(name, []byte("allowed"), 0600)
			os.WriteFile(secret, []byte("secret"), 0600)
			g, err := PinRead(target)
			if err != nil {
				t.Fatal(err)
			}
			defer g.Close()
			sb := &Sandbox{}
			defer sb.Close()
			sb.BeforeGrantInstall = func() {
				if err := os.Rename(parent, parent+"-old"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, parent); err != nil {
					t.Skip(err)
				}
			}
			sb.InstallRead(g)
			// Restore the pathname after installation: a bad pin would now be
			// pointing into outside even though lexical checks see parent again.
			os.Remove(parent)
			os.Rename(parent+"-old", parent)
			h, msg := sb.Open(name, Input)
			if h == nil {
				t.Fatal(msg)
			}
			defer h.Close()
			data, _ := h.ReadAt(0, 100)
			if string(data) != "allowed" {
				t.Fatal("installation reopened pathname", string(data))
			}
		})
	}
}

func TestStartupIdentitySwapRefused(t *testing.T) {
	for _, directory := range []bool{false, true} {
		t.Run(map[bool]string{false: "file", true: "directory"}[directory], func(t *testing.T) {
			base := t.TempDir()
			parent, outside := filepath.Join(base, "parent"), filepath.Join(base, "outside")
			os.Mkdir(parent, 0700)
			os.Mkdir(outside, 0700)
			target, secret := filepath.Join(parent, "target"), filepath.Join(outside, "target")
			if directory {
				os.Mkdir(target, 0700)
				os.Mkdir(secret, 0700)
			} else {
				os.WriteFile(target, []byte("allowed"), 0600)
				os.WriteFile(secret, []byte("secret"), 0600)
			}
			sb := &Sandbox{BeforeGrantOpen: func() {
				if err := os.Rename(parent, parent+"-old"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(outside, parent); err != nil {
					t.Skip(err)
				}
			}}
			g, err := sb.PinRead(target)
			if g != nil {
				g.Close()
				t.Fatal("startup swapped identity accepted")
			}
			if err == nil {
				t.Fatal("missing pin failure")
			}
		})
	}
}

func TestHardLinkAndTrailingSeparator(t *testing.T) {
	dir := t.TempDir()
	file, alias := filepath.Join(dir, "file"), filepath.Join(dir, "alias")
	os.WriteFile(file, []byte("allowed"), 0600)
	if err := os.Link(file, alias); err != nil {
		t.Skip(err)
	}
	sb := &Sandbox{}
	defer sb.Close()
	g, err := PinRead(file + string(filepath.Separator))
	if err != nil {
		t.Fatal(err)
	}
	sb.InstallRead(g)
	if h, _ := sb.Open(alias, Input); h != nil {
		h.Close()
		t.Fatal("hard link sibling gained authority")
	}
	// A hard link restored at the granted name is the same pinned object.
	os.Remove(file)
	if err := os.Link(alias, file); err != nil {
		t.Fatal(err)
	}
	if h, msg := sb.Open(file+string(filepath.Separator), Input); h == nil {
		t.Fatal(msg)
	} else {
		h.Close()
	}
	g, err = PinRead(dir + string(filepath.Separator))
	if err != nil || !g.IsDir() {
		t.Fatal(err)
	}
	sb.InstallRead(g)
	if h, msg := sb.Open(alias, Input); h == nil {
		t.Fatal(msg)
	} else {
		h.Close()
	}
}

func TestPinFilesystemRoot(t *testing.T) {
	cwd, _ := os.Getwd()
	root := filepath.VolumeName(cwd) + string(filepath.Separator)
	g, err := PinRead(root)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	if !g.IsDir() {
		t.Fatal("filesystem root is not a directory")
	}
}

func TestFileGrantDoesNotNarrowExplicitRoot(t *testing.T) {
	dir := t.TempDir()
	file, replacement := filepath.Join(dir, "file"), filepath.Join(dir, "replacement")
	os.WriteFile(file, []byte("old"), 0600)
	os.WriteFile(replacement, []byte("new"), 0600)
	var decisions []bool
	sb := &Sandbox{Read: []string{dir}, Audit: func(entry map[string]any) {
		decisions = append(decisions, entry["allowed"].(bool))
	}}
	defer sb.Close()
	g, err := PinRead(file)
	if err != nil {
		t.Fatal(err)
	}
	sb.InstallRead(g)
	if err := os.Rename(replacement, file); err != nil {
		t.Fatal(err)
	}
	h, msg := sb.Open(file, Input)
	if h == nil {
		t.Fatal("exact file narrowed an explicit root", msg)
	}
	defer h.Close()
	data, _ := h.ReadAt(0, 100)
	if string(data) != "new" {
		t.Fatal(string(data))
	}
	if len(decisions) != 1 || !decisions[0] {
		t.Fatal("directory grant audited as refusal", decisions)
	}
}

func TestFileGrantCaseFallbackSeam(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "Input.txt")
	sibling := filepath.Join(dir, "Sibling.txt")
	for _, name := range []string{file, sibling} {
		if err := os.WriteFile(name, []byte("content"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	sb.roots()
	// Stand in for EvalSymlinks preserving a different parent/volume spelling.
	// The pinned handles and candidate open still use the actual filesystem.
	grant := sb.files[file]
	delete(sb.files, file)
	sb.files[filepath.Join(strings.ToUpper(dir), filepath.Base(file))] = grant
	if h, msg := sb.Open(file, Input); h == nil {
		t.Fatal(msg)
	} else {
		h.Close()
	}
	if _, info, err := sb.BrowseEntry(file, false); err != nil || !info.Mode().IsRegular() {
		t.Fatal(info, err)
	}
	for _, name := range []string{sibling, dir} {
		if h, _ := sb.Open(name, Input); h != nil {
			h.Close()
			t.Fatal("allowed", name)
		}
		if _, _, err := sb.BrowseEntry(name, false); err == nil {
			t.Fatal("inspected", name)
		}
	}
	if _, f, err := sb.BrowsePath(dir, false); err == nil {
		f.Close()
		t.Fatal("directory browsing allowed")
	}
	if !unambiguousGrantName("Input.txt", "INPUT.TXT", []string{"Input.txt"}) {
		t.Fatal("case-insensitive entry lookup refused")
	}
	if unambiguousGrantName("Input.txt", "INPUT.TXT", []string{"Input.txt", "INPUT.TXT"}) {
		t.Fatal("distinct case-sensitive hard-link name accepted")
	}
}

func TestFileGrantCaseVariant(t *testing.T) {
	dir := t.TempDir()
	file, variant := filepath.Join(dir, "Input.txt"), filepath.Join(dir, "INPUT.TXT")
	if err := os.WriteFile(file, []byte("allowed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(variant); err != nil {
		t.Skip("temporary filesystem is case-sensitive; fallback covered by seam")
	}
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	if h, msg := sb.Open(variant, Input); h == nil {
		t.Fatal(msg)
	} else {
		h.Close()
	}
	sibling := filepath.Join(dir, "Sibling.txt")
	if err := os.WriteFile(sibling, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if h, _ := sb.Open(sibling, Input); h != nil {
		h.Close()
		t.Fatal("sibling allowed")
	}
}

func TestFileGrantCaseHardLinkRefused(t *testing.T) {
	dir := t.TempDir()
	file, alias := filepath.Join(dir, "Input.txt"), filepath.Join(dir, "INPUT.TXT")
	if err := os.WriteFile(file, []byte("allowed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(file, alias); err != nil {
		t.Skip("distinct case-variant hard link unavailable:", err)
	}
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	if h, _ := sb.Open(alias, Input); h != nil {
		h.Close()
		t.Fatal("case-variant hard link gained authority")
	}
	if _, _, err := sb.BrowseEntry(alias, false); err == nil {
		t.Fatal("hard link inspected")
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if h, _ := sb.Open(alias, Input); h != nil {
		h.Close()
		t.Fatal("surviving case-variant hard link gained authority")
	}
}

func TestFileGrantInspectionReplacement(t *testing.T) {
	dir := t.TempDir()
	file, sibling := filepath.Join(dir, "file"), filepath.Join(dir, "sibling")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(sibling, []byte("secret"), 0600)
	sb := &Sandbox{ReadFiles: []string{file}}
	defer sb.Close()
	sb.BeforeOpen = func() {
		if err := os.Rename(sibling, file); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := sb.BrowseEntry(file, false); err == nil {
		t.Fatal("replacement inspected")
	}
}
