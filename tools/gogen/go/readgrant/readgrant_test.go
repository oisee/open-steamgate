package readgrant

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"osg/gogen/sandbox"
)

func readable(t *testing.T, sb *sandbox.Sandbox, path string, want bool) {
	t.Helper()
	h, message := sb.Open(path, sandbox.Input)
	if (h != nil) != want {
		t.Fatalf("%s: readable=%v want=%v: %s", path, h != nil, want, message)
	}
	if h != nil {
		h.Close()
	}
}

func TestGrantsAndLists(t *testing.T) {
	dir := t.TempDir()
	file, sibling, list, sub := filepath.Join(dir, "file"), filepath.Join(dir, "sibling"), filepath.Join(dir, "deps.txt"), filepath.Join(dir, "sub")
	os.Mkdir(sub, 0700)
	child := filepath.Join(sub, "child")
	absolute := filepath.Join(t.TempDir(), "absolute")
	for _, p := range []string{file, sibling, child, absolute} {
		if err := os.WriteFile(p, []byte("data"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(list, []byte("# comment\n\nfile\nsub\n"+absolute+"\nmissing\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	sb := &sandbox.Sandbox{}
	Apply(sb, map[string]string{"P_LIST": list}, nil, []string{"P_LIST"}, false, &stderr)
	defer sb.Close()
	for _, p := range []string{file, list, child, absolute} {
		readable(t, sb, p, true)
	}
	readable(t, sb, sibling, false)
	readable(t, sb, filepath.Join(dir, "missing"), false)
	want := "read: " + list + " (P_LIST) + 3 from deps.txt\n"
	if !strings.HasSuffix(stderr.String(), want) || strings.Count(stderr.String(), "warning:") != 1 {
		t.Fatalf("%q want %q", stderr.String(), want)
	}
}

func TestEmptyMissingDisabledAndExplicit(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	os.WriteFile(file, []byte("data"), 0600)
	for _, values := range []map[string]string{{"P_FILE": ""}, {"P_FILE": filepath.Join(dir, "missing")}} {
		sb := &sandbox.Sandbox{}
		var out bytes.Buffer
		Apply(sb, values, []string{"P_FILE"}, nil, false, &out)
		readable(t, sb, file, false)
		sb.Close()
		if values["P_FILE"] == "" && out.Len() != 0 {
			t.Fatal(out.String())
		}
		if values["P_FILE"] != "" && strings.Count(out.String(), "warning:") != 1 {
			t.Fatal(out.String())
		}
	}
	for _, explicit := range []bool{false, true} {
		sb := &sandbox.Sandbox{}
		if explicit {
			sb.Read = []string{dir}
		}
		var out bytes.Buffer
		Apply(sb, map[string]string{"P_FILE": file, "P_LIST": file}, []string{"P_FILE"}, []string{"P_LIST"}, true, &out)
		readable(t, sb, file, explicit)
		sb.Close()
		if out.Len() != 0 {
			t.Fatal(out.String())
		}
	}
}

func TestRelativeParameterAndDirectory(t *testing.T) {
	dir := t.TempDir()
	child := filepath.Join(dir, "child")
	os.WriteFile(child, []byte("data"), 0600)
	cwd, _ := os.Getwd()
	relative, _ := filepath.Rel(cwd, child)
	sb := &sandbox.Sandbox{}
	var out bytes.Buffer
	Apply(sb, map[string]string{"P_FILE": relative}, []string{"P_FILE"}, nil, false, &out)
	readable(t, sb, relative, true)
	sb.Close()
	if out.String() != "read: "+child+" (P_FILE)\n" {
		t.Fatal(out.String())
	}
	sb = &sandbox.Sandbox{}
	Apply(sb, map[string]string{"P_DIR": dir}, []string{"P_DIR"}, nil, false, &out)
	readable(t, sb, child, true)
	sb.Close()
}

func TestUnreadableListOneWarningNoGrants(t *testing.T) {
	sb := &sandbox.Sandbox{}
	defer sb.Close()
	var out bytes.Buffer
	missing := filepath.Join(t.TempDir(), "missing")
	Apply(sb, map[string]string{"P_LIST": missing}, nil, []string{"P_LIST"}, false, &out)
	if strings.Count(out.String(), "\n") != 1 || !strings.Contains(out.String(), "warning:") {
		t.Fatal(out.String())
	}
	if len(sb.Read)+len(sb.ReadFiles) != 0 {
		t.Fatal("unreadable list granted")
	}
}

func TestDirectorySymlinkValue(t *testing.T) {
	dir := t.TempDir()
	target := t.TempDir()
	child := filepath.Join(target, "child")
	if err := os.WriteFile(child, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias")
	if err := os.Symlink(target, alias); err != nil {
		t.Skip(err)
	}
	sb := &sandbox.Sandbox{}
	defer sb.Close()
	var out bytes.Buffer
	Apply(sb, map[string]string{"P_DIR": alias}, []string{"P_DIR"}, nil, false, &out)
	readable(t, sb, filepath.Join(alias, "child"), true)
	readable(t, sb, dir, false)
}

func TestDatasetBaseUnaffected(t *testing.T) {
	cwd, _ := os.Getwd()
	root, _ := filepath.Rel(cwd, filepath.Join(cwd, "..", "sandbox"))
	for _, home := range []string{"", root} {
		sb := &sandbox.Sandbox{Read: []string{root}, Home: home}
		var out bytes.Buffer
		Apply(sb, map[string]string{"P_FILE": "README.md"}, []string{"P_FILE"}, nil, false, &out)
		defer sb.Close()
		if sb.Home != home {
			t.Fatal("grant moved dataset home", sb.Home)
		}
		h, message := sb.Open("README.md", sandbox.Input)
		if h == nil {
			t.Fatal(message)
		}
		data, _ := h.ReadAt(0, 100)
		h.Close()
		if !strings.HasPrefix(string(data), "# sandbox") {
			t.Fatal("DATASET ignored explicit root/home", string(data))
		}
		// The parameter itself was resolved against cwd, regardless of home.
		readable(t, sb, filepath.Join(cwd, "README.md"), true)
	}
	// Default directory grants must not become a new implicit home either.
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "child"), []byte("data"), 0600)
	sb := &sandbox.Sandbox{}
	defer sb.Close()
	Apply(sb, map[string]string{"P_DIR": dir}, []string{"P_DIR"}, nil, false, &bytes.Buffer{})
	readable(t, sb, "child", false)
	readable(t, sb, filepath.Join(dir, "child"), true)
}

func TestBOMCRLFAndLimits(t *testing.T) {
	dir := t.TempDir()
	for _, list := range []string{"\ufefffile\r\n # comment\r\n\r\nsub/\r\n", "\ufeff# comment\r\nfile\r\nsub/\r\n"} {
		paths, err := ParseList(strings.NewReader(list), dir)
		if err != nil || len(paths) != 2 || paths[0] != filepath.Join(dir, "file") || paths[1] != filepath.Join(dir, "sub") {
			t.Fatal(paths, err)
		}
	}
	for _, data := range []string{
		strings.Repeat("file\n", MaxListEntries+1),
		"file\n" + strings.Repeat("# padding\n", MaxListBytes/10+1),
		"file\n" + strings.Repeat("x", 1024*1024),
	} {
		list := filepath.Join(dir, "deps")
		os.WriteFile(list, []byte(data), 0600)
		os.WriteFile(filepath.Join(dir, "file"), []byte("data"), 0600)
		sb := &sandbox.Sandbox{}
		var out bytes.Buffer
		Apply(sb, map[string]string{"P_LIST": list}, nil, []string{"P_LIST"}, false, &out)
		readable(t, sb, list, false)
		readable(t, sb, filepath.Join(dir, "file"), false)
		sb.Close()
		if strings.Count(out.String(), "warning:") != 1 || strings.Count(out.String(), "\n") != 1 {
			t.Fatal(out.String())
		}
	}
	for _, data := range []string{strings.Repeat("file\n", MaxListEntries), strings.Repeat("#\n", MaxListBytes/2)} {
		if _, err := ParseList(strings.NewReader(data), dir); err != nil {
			t.Fatal("exact limit refused", err)
		}
	}
}

func TestListInstallationKeepsParsedFile(t *testing.T) {
	dir := t.TempDir()
	list, file, secret := filepath.Join(dir, "deps"), filepath.Join(dir, "file"), filepath.Join(dir, "secret")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(secret, []byte("secret"), 0600)
	os.WriteFile(list, []byte("file\ndeps\n"), 0600)
	sb := &sandbox.Sandbox{}
	defer sb.Close()
	sb.BeforeGrantInstall = func() {
		sb.BeforeGrantInstall = nil
		if err := os.Rename(list, list+"-old"); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(list, 0700); err != nil {
			t.Fatal(err)
		}
		os.WriteFile(filepath.Join(list, "secret"), []byte("secret"), 0600)
	}
	var out bytes.Buffer
	Apply(sb, map[string]string{"P_LIST": list}, nil, []string{"P_LIST"}, false, &out)
	readable(t, sb, file, true)
	readable(t, sb, list, false)
	readable(t, sb, filepath.Join(list, "secret"), false)
	readable(t, sb, secret, false)
}

func TestListContentsNeverRegrant(t *testing.T) {
	dir := t.TempDir()
	list, file, secret := filepath.Join(dir, "deps"), filepath.Join(dir, "file"), filepath.Join(dir, "secret")
	os.WriteFile(file, []byte("allowed"), 0600)
	os.WriteFile(secret, []byte("secret"), 0600)
	// Self-listing grants that file only, without recursively parsing it.
	os.WriteFile(list, []byte("file\ndeps\n"), 0600)
	sb := &sandbox.Sandbox{}
	defer sb.Close()
	Apply(sb, map[string]string{"P_LIST": list}, nil, []string{"P_LIST"}, false, &bytes.Buffer{})
	os.WriteFile(list, []byte(secret+"\n"), 0600)
	readable(t, sb, list, true)
	readable(t, sb, file, true)
	readable(t, sb, secret, false)
}

func TestPinFailureWarns(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	os.WriteFile(file, []byte("allowed"), 0600)
	sb := &sandbox.Sandbox{}
	defer sb.Close()
	sb.BeforeGrantOpen = func() { os.Remove(file) }
	var out bytes.Buffer
	Apply(sb, map[string]string{"P_FILE": file}, []string{"P_FILE"}, nil, false, &out)
	if strings.Count(out.String(), "warning:") != 1 {
		t.Fatal(out.String())
	}
	readable(t, sb, file, false)
}
