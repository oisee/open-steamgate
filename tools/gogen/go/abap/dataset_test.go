package abap

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The Go side of X0, the same cases as test/dataset.mjs over the same
// sandbox rules, plus the statements' measured answers (docs/dataset.md).

type datasetFixture struct {
	s                     *Session
	base, in, out, beyond string
	audit                 []map[string]any
}

func newDatasetFixture(t *testing.T) *datasetFixture {
	t.Helper()
	base := t.TempDir()
	f := &datasetFixture{s: &Session{}, base: base, in: filepath.Join(base, "in"), out: filepath.Join(base, "out"), beyond: filepath.Join(base, "elsewhere")}
	for _, d := range []string{f.in, f.out, f.beyond} {
		if err := os.Mkdir(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	os.WriteFile(filepath.Join(f.in, "a.txt"), []byte("one\ntwo\n"), 0o644)
	os.WriteFile(filepath.Join(f.beyond, "secret.txt"), []byte("no\n"), 0o644)
	SetDatasetHost(&Sandbox{Read: []string{f.in}, Write: []string{f.out}, Audit: func(e map[string]any) { f.audit = append(f.audit, e) }})
	t.Cleanup(func() { SetDatasetHost(nil); datasetFiles.Delete(f.s) })
	return f
}

func (f *datasetFixture) open(name string, mode DatasetMode, binary bool) (int32, string) {
	msg := ""
	m := Data{P: &msg, T: TString}
	OpenDataset(f.s, name, DatasetOpen{Mode: mode, Binary: binary, Message: &m})
	return f.s.Sy.Subrc, msg
}

func str(v string) Data { return Data{P: &v, T: TString} }

func TestDatasetDenyByDefault(t *testing.T) {
	f := newDatasetFixture(t)
	SetDatasetHost(&Sandbox{})
	rc, msg := f.open(filepath.Join(f.in, "a.txt"), DatasetInput, true)
	if rc != 8 || !strings.Contains(msg, "Permission denied") {
		t.Fatalf("rc %d %q", rc, msg)
	}
}

func TestDatasetReadRootIsReadOnly(t *testing.T) {
	f := newDatasetFixture(t)
	name := filepath.Join(f.in, "a.txt")
	if rc, _ := f.open(name, DatasetInput, false); rc != 0 {
		t.Fatalf("open rc %d", rc)
	}
	line := ""
	ReadDataset(f.s, name, Data{P: &line, T: TString}, -1, nil)
	if line != "one" {
		t.Fatalf("line %q", line)
	}
	CloseDataset(f.s, name)
	if rc, _ := f.open(filepath.Join(f.in, "new.txt"), DatasetOutput, true); rc != 8 {
		t.Fatalf("write into a read root: rc %d", rc)
	}
	DeleteDataset(f.s, name)
	if f.s.Sy.Subrc != 4 {
		t.Fatalf("delete in a read root: rc %d", f.s.Sy.Subrc)
	}
}

func TestDatasetEscapes(t *testing.T) {
	f := newDatasetFixture(t)
	os.Symlink(filepath.Join(f.beyond, "secret.txt"), filepath.Join(f.in, "link.txt"))
	os.Symlink(f.beyond, filepath.Join(f.out, "dir"))
	os.Symlink(filepath.Join(f.beyond, "created.txt"), filepath.Join(f.out, "dangling.txt"))
	os.Mkdir(f.in+"2", 0o755)
	os.WriteFile(filepath.Join(f.in+"2", "b.txt"), []byte("b\n"), 0o644)
	cases := []struct {
		name string
		mode DatasetMode
	}{
		{filepath.Join(f.in, "..", "elsewhere", "secret.txt"), DatasetInput},
		{filepath.Join(f.out, "..", "elsewhere", "x.txt"), DatasetOutput},
		{filepath.Join(f.in, "link.txt"), DatasetInput},
		{filepath.Join(f.out, "dir", "planted.txt"), DatasetOutput},
		{filepath.Join(f.out, "dangling.txt"), DatasetOutput},
		{filepath.Join(f.out, "dangling.txt"), DatasetAppending},
		{filepath.Join(f.out, "dangling.txt"), DatasetUpdate},
		{filepath.Join(f.in+"2", "b.txt"), DatasetInput},
	}
	for _, c := range cases {
		if rc, msg := f.open(c.name, c.mode, true); rc != 8 {
			t.Errorf("%s %s: rc %d %q", c.mode, c.name, rc, msg)
		}
	}
	for _, p := range []string{filepath.Join(f.beyond, "x.txt"), filepath.Join(f.beyond, "planted.txt"), filepath.Join(f.beyond, "created.txt")} {
		if _, err := os.Stat(p); err == nil {
			t.Errorf("%s was created outside the roots", p)
		}
	}
}

func TestDatasetRefusalIsNoOracle(t *testing.T) {
	f := newDatasetFixture(t)
	_, one := f.open(filepath.Join(f.base, "no-such-dir", "x.txt"), DatasetInput, true)
	_, two := f.open(filepath.Join(f.beyond, "none.txt"), DatasetInput, true)
	if !strings.Contains(one, "Permission denied") || !strings.Contains(two, "Permission denied") {
		t.Fatalf("%q / %q", one, two)
	}
}

func TestDatasetMissingAndUpdate(t *testing.T) {
	f := newDatasetFixture(t)
	if rc, msg := f.open(filepath.Join(f.in, "none.txt"), DatasetInput, true); rc != 8 || msg != "No such file or directory" {
		t.Fatalf("rc %d %q", rc, msg)
	}
	if rc, _ := f.open(filepath.Join(f.out, "none.bin"), DatasetUpdate, true); rc != 8 {
		t.Fatalf("UPDATE of a missing file: rc %d", rc)
	}
}

func TestDatasetBinaryAndText(t *testing.T) {
	f := newDatasetFixture(t)
	name := filepath.Join(f.out, "b.bin")
	f.open(name, DatasetOutput, true)
	x := "\x00\xff\x0d\x0a\x41"
	Transfer(f.s, Data{P: &x, T: TXString}, name, -1, false)
	CloseDataset(f.s, name)
	f.open(name, DatasetInput, true)
	// a fixed x(3) read short at the end: rc 4, padded, ACTUAL LENGTH in bytes
	want := []struct {
		rc  int32
		hex string
		n   int32
	}{{0, "00FF0D", 3}, {4, "0A4100", 2}, {4, "000000", 0}}
	for _, w := range want {
		v := strings.Repeat("\x00", 3)
		var n int32
		ReadDataset(f.s, name, Data{P: &v, T: TX(3)}, -1, &Data{P: &n, T: TI})
		if f.s.Sy.Subrc != w.rc || XToHex(v) != w.hex || n != w.n {
			t.Errorf("got rc %d %s %d, want %+v", f.s.Sy.Subrc, XToHex(v), n, w)
		}
	}
	CloseDataset(f.s, name)

	text := filepath.Join(f.out, "t.txt")
	f.open(text, DatasetOutput, false)
	c10 := "ab"
	Transfer(f.s, Data{P: &c10, T: TC(10)}, text, -1, false)
	Transfer(f.s, str("cd "), text, -1, false)
	c4 := "ab"
	CloseDataset(f.s, text)
	if got, _ := os.ReadFile(text); string(got) != "ab\ncd \n" {
		t.Errorf("text %q", got)
	}
	f.open(text, DatasetAppending, true)
	Transfer(f.s, Data{P: &c4, T: TC(4)}, text, -1, false)
	CloseDataset(f.s, text)
	if got, _ := os.ReadFile(text); XToHex(string(got[7:])) != "6100620020002000" {
		t.Errorf("binary c(4) appended: %s", XToHex(string(got)))
	}
}

func TestDatasetLinesAcrossChunks(t *testing.T) {
	f := newDatasetFixture(t)
	lines := []string{strings.Repeat("a", datasetChunk-1), strings.Repeat("b", datasetChunk), strings.Repeat("c", 2*datasetChunk+3), "tail"}
	name := filepath.Join(f.in, "long.txt")
	os.WriteFile(name, []byte(strings.Join(lines, "\n")), 0o644)
	f.open(name, DatasetInput, false)
	for _, want := range lines {
		got := ""
		var n int32
		ReadDataset(f.s, name, Data{P: &got, T: TString}, -1, &Data{P: &n, T: TI})
		if f.s.Sy.Subrc != 0 || got != want || int(n) != len(want) {
			t.Fatalf("rc %d len %d/%d", f.s.Sy.Subrc, len(got), n)
		}
	}
	got := "zz"
	ReadDataset(f.s, name, Data{P: &got, T: TString}, -1, nil)
	if f.s.Sy.Subrc != 4 || got != "" {
		t.Fatalf("end: rc %d %q", f.s.Sy.Subrc, got)
	}
}

func TestDatasetExceptionsAndPositions(t *testing.T) {
	f := newDatasetFixture(t)
	raises := func(class string, fn func()) {
		t.Helper()
		defer func() {
			r := recover()
			if e, ok := r.(ArithmeticError); !ok || e.Class != class {
				t.Errorf("want %s, got %v", class, r)
			}
		}()
		fn()
	}
	name := filepath.Join(f.in, "a.txt")
	raises("CX_SY_FILE_OPEN_MODE", func() { Transfer(f.s, str("q"), filepath.Join(f.out, "g.txt"), -1, false) })
	raises("CX_SY_FILE_OPEN_MODE", func() { ReadDataset(f.s, name, str(""), -1, nil) })
	f.open(name, DatasetInput, false)
	raises("CX_SY_FILE_OPEN_MODE", func() { Transfer(f.s, str("q"), name, -1, false) })
	raises("CX_SY_FILE_OPEN", func() { f.open(name, DatasetInput, false) })
	line := ""
	ReadDataset(f.s, name, Data{P: &line, T: TString}, -1, nil)
	var pos int64
	GetDatasetPosition(f.s, name, Data{P: &pos, T: TInt8})
	if pos != 4 {
		t.Errorf("position %d", pos)
	}
	SetDatasetPosition(f.s, name, 0, false)
	ReadDataset(f.s, name, Data{P: &line, T: TString}, -1, nil)
	if line != "one" {
		t.Errorf("after SET 0: %q", line)
	}
	SetDatasetPosition(f.s, name, 0, true)
	ReadDataset(f.s, name, Data{P: &line, T: TString}, -1, nil)
	if f.s.Sy.Subrc != 4 {
		t.Errorf("after END OF FILE: rc %d", f.s.Sy.Subrc)
	}
	CloseDataset(f.s, name)
	CloseDataset(f.s, name)
	if f.s.Sy.Subrc != 0 {
		t.Errorf("CLOSE of a closed file: rc %d", f.s.Sy.Subrc)
	}
	if _, err := os.Stat(filepath.Join(f.out, "g.txt")); err == nil {
		t.Errorf("TRANSFER to a file not open created it")
	}
}

func TestDatasetAudit(t *testing.T) {
	f := newDatasetFixture(t)
	name := filepath.Join(f.in, "a.txt")
	f.open(name, DatasetInput, true)
	CloseDataset(f.s, name)
	f.open(filepath.Join(f.beyond, "secret.txt"), DatasetInput, true)
	DeleteDataset(f.s, filepath.Join(f.out, "none.txt"))
	var got []string
	for _, e := range f.audit {
		got = append(got, e["op"].(string)+"/"+map[bool]string{true: "y", false: "n"}[e["allowed"].(bool)])
	}
	if strings.Join(got, " ") != "OPEN/y OPEN/n DELETE/n" {
		t.Fatalf("audit %v", got)
	}
}
