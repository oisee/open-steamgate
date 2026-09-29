package abap

import (
	"os"
	"path/filepath"
	"testing"
)

func stringTable(value *[]string) Data {
	t := &Type{Kind: 'h', Row: TString}
	t.Lines = func(p any) int { return len(*p.(*[]string)) }
	t.At = func(p any, i int) any { return &(*p.(*[]string))[i] }
	t.Append = func(p any) any {
		table := p.(*[]string)
		*table = append(*table, "")
		return &(*table)[len(*table)-1]
	}
	t.Zero = func(p any) { *p.(*[]string) = nil }
	return Data{P: value, T: t}
}

func TestFrontendTextUploadDownload(t *testing.T) {
	dir := t.TempDir()
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
