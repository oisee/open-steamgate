package abap

import (
	"sort"
	"strings"
	"testing"
)

// JavaScript's localeCompare over the characters an object name holds, as
// Node 26 sorted them (ICU root collation): the order LIST answers in
func TestCollateIsLocaleCompare(t *testing.T) {
	got := []string{"ZCLA_", "ZCL1", "ZCL$", "ZCL/A", "ZCLA", "ZCL_A", "ZCL"}
	sort.SliceStable(got, func(i, j int) bool { return collateLess(got[i], got[j]) })
	want := "ZCL ZCL_A ZCL/A ZCL$ ZCL1 ZCLA ZCLA_"
	if strings.Join(got, " ") != want {
		t.Fatalf("names: %s, want %s", strings.Join(got, " "), want)
	}
	chars := strings.Split(`~ | > = < + ^ `+"`"+` % # & \ / * @ } { ] [ ) ( " ' . ? ! : ; , - _ $ 0 1 9 a A B z Z`, " ")
	sort.SliceStable(chars, func(i, j int) bool { return collateLess(chars[i], chars[j]) })
	wantChars := `_ - , ; : ! ? . ' " ( ) [ ] { } @ * / \ & # % ` + "`" + ` ^ + < = > | ~ $ 0 1 9 a A B z Z`
	if strings.Join(chars, " ") != wantChars {
		t.Fatalf("characters: %s\nwant        %s", strings.Join(chars, " "), wantChars)
	}
	if !collateLess("ab", "aB") || !collateLess("aB", "Ab") || !collateLess("Ab", "AB") {
		t.Fatalf("case breaks a tie only, lower first")
	}
}

// CAPABILITIES names what this host does, so the editor draws no Check or
// Activate button here; with no store it is the same named error as any call
func TestStoreCapabilities(t *testing.T) {
	cmd := "CAPABILITIES"
	if a := StoreCall(map[string]*string{"IV_COMMAND": &cmd}); a.Scalars["EV_ERROR"] == "" {
		t.Fatalf("no store, and yet capabilities: %v", a.Scalars)
	}
	storeState.cfg = &StoreConfig{Roots: []StoreRoot{{Path: "src", Writable: true}}}
	defer func() { storeState.cfg = nil }()
	a := StoreCall(map[string]*string{"IV_COMMAND": &cmd})
	if a.Scalars["EV_ERROR"] != "" || a.Scalars["EV_NOTE"] != "LIST READ WRITE" {
		t.Fatalf("CAPABILITIES: note %q error %q", a.Scalars["EV_NOTE"], a.Scalars["EV_ERROR"])
	}
}

// a WRITE touches only a file inside a writable root of the tree
func TestStoreConfined(t *testing.T) {
	storeState.cfg = &StoreConfig{Roots: []StoreRoot{{Path: "src", Writable: true}, {Path: "gen"}, {Path: "packs/o4d/src", Writable: true}}}
	defer func() { storeState.cfg = nil }()
	for file, want := range map[string]bool{
		"src/osd/x.prog.abap":             true,
		"packs/o4d/src/x.clas.abap":       true,
		"src/osd/..#..#x.prog.abap":       true,
		"gen/x.clas.abap":                 false,
		"src/../gen/x.clas.abap":          false,
		"../outside.prog.abap":            false,
		"/etc/passwd":                     false,
		"srcx/x.prog.abap":                false,
		"packs/o4d/src/../../../x.abap":   false,
		"src/osd/../../packs/x.prog.abap": false,
	} {
		if got := storeConfined(file); got != want {
			t.Errorf("%s: confined %v, want %v", file, got, want)
		}
	}
}
