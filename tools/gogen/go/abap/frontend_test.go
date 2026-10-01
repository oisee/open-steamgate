package abap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFrontendTextUploadDownload(t *testing.T) {
	dir := t.TempDir()
	sb := &Sandbox{Read: []string{dir}, Write: []string{dir}}
	SetDatasetHost(sb)
	t.Cleanup(func() { SetDatasetHost(nil); sb.Close() })
	input, output := filepath.Join(dir, "input.txt"), filepath.Join(dir, "output.txt")
	if err := os.WriteFile(input, []byte("one\r\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	var rows []string
	data := stringTable(&rows)
	var length int32
	var header string
	FrontendUpload(nil, input, "ASC", &length, &header, &data)
	if length != 9 || len(rows) != 2 || rows[0] != "one" || rows[1] != "two" {
		t.Fatalf("length=%d rows=%#v", length, rows)
	}
	FrontendDownload(nil, output, "ASC", 0, "X", "", data)
	got, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "one\ntwo\n" {
		t.Fatalf("download = %q", got)
	}
}

func TestFrontendTransferConfinedAndSwap(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	sb := &Sandbox{Read: []string{root}, Write: []string{root}}
	SetDatasetHost(sb)
	t.Cleanup(func() { datasetSwap = nil; SetDatasetHost(nil); sb.Close() })
	var rows []string
	data := stringTable(&rows)
	var length int32
	var header string
	for _, name := range []string{filepath.Join(outside, "outside"), filepath.Join(root, "..", filepath.Base(outside), "outside")} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("upload allowed %s", name)
				}
			}()
			FrontendUpload(nil, name, "ASC", &length, &header, &data)
		}()
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("download allowed %s", name)
				}
			}()
			FrontendDownload(nil, name, "ASC", 0, "X", "", data)
		}()
	}
	parent := filepath.Join(root, "child")
	os.Mkdir(parent, 0700)
	datasetSwap = func() {
		datasetSwap = nil
		os.Rename(parent, parent+"-old")
		os.Symlink(outside, parent)
	}
	func() {
		defer func() {
			if recover() == nil {
				t.Error("swapped parent allowed")
			}
		}()
		FrontendDownload(nil, filepath.Join(parent, "escaped"), "ASC", 0, "X", "", data)
	}()
	if _, err := os.Stat(filepath.Join(outside, "escaped")); !os.IsNotExist(err) {
		t.Fatalf("outside file created: %v", err)
	}
}

func TestFrontendFilesystemFacts(t *testing.T) {
	dir := t.TempDir()
	name := filepath.Join(dir, "three")
	if err := os.WriteFile(name, []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	if FrontendFileExist(nil, name) != "X" || FrontendFileExist(nil, dir) != "" {
		t.Fatal("file existence result is wrong")
	}
	if FrontendDirectoryExist(nil, dir) != "X" || FrontendDirectoryExist(nil, name) != "" {
		t.Fatal("directory existence result is wrong")
	}
	var size int32
	FrontendFileSize(nil, name, &size)
	if size != 3 {
		t.Fatalf("size = %d", size)
	}
}

func TestFrontendGetenv(t *testing.T) {
	t.Setenv("OSABAP_FRONTEND_TEST", "visible")
	if got := FrontendGetenv(nil, " OSABAP_FRONTEND_TEST "); got != "visible" {
		t.Fatalf("getenv = %q", got)
	}
}
