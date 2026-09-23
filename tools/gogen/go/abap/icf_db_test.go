package abap

import (
	"path/filepath"
	"strings"
	"testing"
)

// a -db file is seeded once and marked; the same build takes it back as it
// is, another build's script (or a file nobody marked) is refused
func TestOpenDBFileMark(t *testing.T) {
	f := filepath.Join(t.TempDir(), "osgo.sqlite")
	one := []byte(`["CREATE TABLE a (x TEXT)", "INSERT INTO a VALUES ('1')"]`)
	two := []byte(`["CREATE TABLE a (x TEXT, y TEXT)"]`)
	if seeded, err := OpenDBFile(f, one); err != nil || !seeded {
		t.Fatalf("new file: seeded %v, %v", seeded, err)
	}
	if seeded, err := OpenDBFile(f, one); err != nil || seeded {
		t.Fatalf("same build: seeded %v, %v", seeded, err)
	}
	if _, err := OpenDBFile(f, two); err == nil || !strings.Contains(err.Error(), "another build") {
		t.Fatalf("another build: %v", err)
	}
	g := filepath.Join(t.TempDir(), "unmarked.sqlite")
	if _, err := OpenDBFile(g, []byte(`["CREATE TABLE b (x TEXT)"]`)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("PRAGMA user_version = 0"); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenDBFile(g, one); err == nil || !strings.Contains(err.Error(), "no mark") {
		t.Fatalf("unmarked: %v", err)
	}
}
