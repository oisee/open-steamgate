package abap

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// HISTORY and REVISION over a real repository: two versions, the older
// under the file's previous name, read back through the rename
func TestStoreHistoryFollowsRenames(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) {
		if _, err := storeGit(root, args...); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	run("init", "-q")
	run("config", "user.name", "Test Author")
	run("config", "user.email", "test@example.invalid")
	old := filepath.Join(root, "src", "zold.prog.abap")
	os.MkdirAll(filepath.Dir(old), 0o755)
	os.WriteFile(old, []byte("REPORT zold.\nWRITE 'one'.\n"), 0o644)
	run("add", ".")
	run("commit", "-q", "-m", "first")
	run("mv", "src/zold.prog.abap", "src/znew.prog.abap")
	os.WriteFile(filepath.Join(root, "src", "znew.prog.abap"), []byte("REPORT zold.\nWRITE 'one'.\nWRITE 'two'.\n"), 0o644)
	run("add", ".")
	run("commit", "-q", "-m", "second")

	revs, reason := storeHistory(root, "src/znew.prog.abap", 50)
	if reason != "" || len(revs) != 2 {
		t.Fatalf("history: %d versions, reason %q", len(revs), reason)
	}
	if revs[0].SUBJECT != "second" || revs[1].path != "src/zold.prog.abap" || revs[0].AUTHOR != "TESTAUTHOR" || len(revs[0].SHORT) != 12 || revs[0].DATE == "00000000" {
		t.Fatalf("versions: %+v", revs)
	}
	src, path, err := storeRevisionAt(root, "src/znew.prog.abap", revs[1].REVISION)
	if err != nil || path != "src/zold.prog.abap" || strings.Contains(src, "two") || !strings.HasSuffix(src, "\n") {
		t.Fatalf("older version: %q at %s, %v", src, path, err)
	}
	if _, _, err := storeRevisionAt(root, "src/znew.prog.abap", strings.Repeat("0", 40)); err == nil {
		t.Fatal("a commit that did not change the file is no version of it")
	}
	os.WriteFile(filepath.Join(root, "src", "zloose.prog.abap"), []byte("REPORT zloose.\n"), 0o644)
	if _, reason := storeHistory(root, "src/zloose.prog.abap", 50); !strings.Contains(reason, "not tracked") {
		t.Fatalf("an untracked file has no history, and says so: %q", reason)
	}
	run("add", "src/zloose.prog.abap")
	if _, reason := storeHistory(root, "src/zloose.prog.abap", 50); !strings.Contains(reason, "no commit yet") {
		t.Fatalf("a file added and never committed has no version yet: %q", reason)
	}
	if _, reason := storeHistory(t.TempDir(), "x.prog.abap", 50); reason == "" {
		t.Fatal("outside a worktree there is no history")
	}
	if storeSapUser("Alice V.") != "ALICEV" || storeSapUser("") != "UNKNOWN" || storeSapUser("someone@example.com") != "SOMEONEEXAMP" {
		t.Fatal("author mapping")
	}
}
