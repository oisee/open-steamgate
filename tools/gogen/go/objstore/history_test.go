package objstore

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
	subject := strings.Repeat("é", 100) + " full title"
	run("commit", "-q", "-m", subject)

	revs, reason := storeHistory(root, "src/znew.prog.abap", 50)
	if reason != "" || len(revs) != 2 {
		t.Fatalf("history: %d versions, reason %q", len(revs), reason)
	}
	if revs[0].SUBJECT != strings.Repeat("é", 80) || revs[0].SUBJECT_FULL != subject || revs[1].SUBJECT_FULL != "first" || revs[1].path != "src/zold.prog.abap" || revs[0].AUTHOR != "TESTAUTHOR" || revs[0].SHORT != revs[0].REVISION[:len(revs[0].SHORT)] || revs[0].DATE == "00000000" {
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
	if storeSapUser("Jörg Strauß") != "JRGSTRAU" || storeSapUser("Alice V.") != "ALICEV" || storeSapUser("") != "UNKNOWN" || storeSapUser("someone@example.com") != "SOMEONEEXAMP" {
		t.Fatal("author mapping")
	}
}

// a merge that resolved a conflict is a version (the one HEAD has), a copy
// begins a history instead of inheriting its source's, and a non-ASCII
// path comes back as a path, not git's quoted form
func TestStoreHistoryMergesCopiesPaths(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) {
		if _, err := storeGit(root, args...); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	write := func(file, text string) {
		os.MkdirAll(filepath.Dir(filepath.Join(root, file)), 0o755)
		os.WriteFile(filepath.Join(root, file), []byte(text), 0o644)
	}
	run("init", "-q", "-b", "main")
	run("config", "user.name", "Test Author")
	run("config", "user.email", "test@example.invalid")
	write("src/za.prog.abap", "a\nb\nc\nd\ne\n")
	run("add", ".")
	run("commit", "-q", "-m", "one")
	run("checkout", "-q", "-b", "side")
	write("src/za.prog.abap", "a\nB side\nc\nd\ne\n")
	run("commit", "-q", "-am", "side")
	run("checkout", "-q", "main")
	write("src/za.prog.abap", "a\nB main\nc\nd\ne\n")
	run("commit", "-q", "-am", "main")
	storeGit(root, "merge", "-q", "side") // conflicts, resolved by hand
	write("src/za.prog.abap", "a\nB resolved\nc\nd\ne\n")
	run("commit", "-q", "-am", "merge resolved")
	write("src/zé.prog.abap", "a\nB resolved\nc\nd\ne\nf\n")
	run("add", ".")
	run("commit", "-q", "-m", "copy")

	revs, reason := storeHistory(root, "src/za.prog.abap", 50)
	if reason != "" || len(revs) == 0 || revs[0].SUBJECT != "merge resolved" {
		t.Fatalf("the merge is the newest version: %+v %q", revs, reason)
	}
	src, _, err := storeRevisionAt(root, "src/za.prog.abap", revs[0].REVISION)
	if err != nil || !strings.Contains(src, "B resolved") {
		t.Fatalf("the merge's source: %q %v", src, err)
	}
	revs, reason = storeHistory(root, "src/zé.prog.abap", 50)
	if reason != "" || len(revs) != 1 || revs[0].SUBJECT != "copy" || revs[0].path != "src/zé.prog.abap" {
		t.Fatalf("a copy's history begins at the copy, at its own path: %+v %q", revs, reason)
	}
	if _, _, err := storeRevisionAt(root, "src/zé.prog.abap", revs[0].REVISION); err != nil {
		t.Fatalf("a non-ASCII path reads back: %v", err)
	}
	// a rename on a side branch, merged --no-ff (a merge button): the merge
	// is the version, the side commit is not listed again, each one reads
	run("checkout", "-q", "-b", "side2")
	run("mv", "src/za.prog.abap", "src/zb.prog.abap")
	run("commit", "-q", "-m", "rename on side")
	run("checkout", "-q", "main")
	run("merge", "-q", "--no-ff", "-m", "merge rename", "side2")
	revs, reason = storeHistory(root, "src/zb.prog.abap", 50)
	if reason != "" || len(revs) == 0 || revs[0].SUBJECT != "merge rename" {
		t.Fatalf("the merge is the version: %+v %q", revs, reason)
	}
	for _, r := range revs {
		if r.SUBJECT == "rename on side" || r.SUBJECT == "side" {
			t.Fatalf("a side commit listed beside its merge: %+v", revs)
		}
		if _, _, err := storeRevisionAt(root, "src/zb.prog.abap", r.REVISION); err != nil {
			t.Fatalf("%s does not read: %v", r.SUBJECT, err)
		}
	}
}

// the bridge: HISTORY and REVISION through Call on a store over a
// repository, as ZOSD_STORE DESTINATION 'STORE' reaches them
func TestStoreCallHistory(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) {
		if _, err := storeGit(root, args...); err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
	}
	os.WriteFile(filepath.Join(root, "abap_transpile.json"), []byte("{}"), 0o644)
	os.MkdirAll(filepath.Join(root, "src"), 0o755)
	file := filepath.Join(root, "src", "zhist.prog.abap")
	run("init", "-q")
	run("config", "user.name", "Test Author")
	run("config", "user.email", "test@example.invalid")
	os.WriteFile(file, []byte("REPORT zhist.\n"), 0o644)
	run("add", ".")
	run("commit", "-q", "-m", "first")
	os.WriteFile(file, []byte("REPORT zhist.\nWRITE 'x'.\n"), 0o644)
	run("commit", "-q", "-am", "second")
	if err := SetStore(root, []byte(`{"roots":[{"path":"src","writable":true}]}`), ""); err != nil {
		t.Fatal(err)
	}
	defer SetStore("", nil, "")
	str := func(v string) *string { return &v }
	a := Call(map[string]*string{"IV_COMMAND": str("HISTORY"), "IV_TYPE": str("PROG"), "IV_NAME": str("ZHIST")})
	if a.Scalars["EV_ERROR"] != "" || a.Scalars["EV_COUNT"] != "2" || len(a.Revisions) != 2 || a.Revisions[1].SUBJECT != "first" {
		t.Fatalf("HISTORY: %v %+v", a.Scalars, a.Revisions)
	}
	a = Call(map[string]*string{"IV_COMMAND": str("REVISION"), "IV_TYPE": str("PROG"), "IV_NAME": str("ZHIST"), "IV_REVISION": str(a.Revisions[1].REVISION)})
	if a.Scalars["EV_ERROR"] != "" || a.Scalars["EV_SOURCE"] != "REPORT zhist.\n" || a.Scalars["EV_FILE"] != "src/zhist.prog.abap" {
		t.Fatalf("REVISION: %v", a.Scalars)
	}
	a = Call(map[string]*string{"IV_COMMAND": str("HISTORY"), "IV_TYPE": str("PROG"), "IV_NAME": str("ZNONE")})
	if a.Scalars["EV_ERROR"] == "" {
		t.Fatal("an unknown object is an error, not an empty history")
	}
}
