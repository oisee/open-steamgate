package main

import (
	"flag"
	"path/filepath"
	"strings"
	"testing"
)

func TestSelectedPort(t *testing.T) {
	env := func(name string) string { return map[string]string{"OSD_PORT": "bad", "STG_PORT": "3030"}[name] }
	if port, _, err := selectedPort("3095", true, env); err != nil || port != 3095 {
		t.Fatalf("flag must override invalid environment: %d, %v", port, err)
	}
	if _, source, err := selectedPort("", true, env); err == nil || source != "-port" {
		t.Fatalf("explicit empty flag must be invalid: %s, %v", source, err)
	}
	if _, source, err := selectedPort("", false, env); err == nil || source != "OSD_PORT" {
		t.Fatalf("selected environment must be validated: %s, %v", source, err)
	}
	if port, _, err := selectedPort("", false, func(name string) string {
		if name == "STG_PORT" {
			return "3030"
		}
		return ""
	}); err != nil || port != 3030 {
		t.Fatalf("STG_PORT fallback: %d, %v", port, err)
	}
	if port, source, err := selectedPort("", false, func(string) string { return "" }); err != nil || port != 3095 || source != "default" {
		t.Fatalf("default port: %d, %s, %v", port, source, err)
	}
}

func TestPortFlagPresence(t *testing.T) {
	for _, tc := range []struct {
		args  []string
		value string
		set   bool
	}{
		{nil, "", false},
		{[]string{"-port="}, "", true},
		{[]string{"-port=3095"}, "3095", true},
	} {
		flags := flag.NewFlagSet("osgo", flag.ContinueOnError)
		portFlag := flags.String("port", "", "")
		if err := flags.Parse(tc.args); err != nil {
			t.Fatal(err)
		}
		present := false
		flags.Visit(func(f *flag.Flag) {
			if f.Name == "port" {
				present = true
			}
		})
		if *portFlag != tc.value || present != tc.set {
			t.Fatalf("%v: value %q, present %v", tc.args, *portFlag, present)
		}
	}
}

func TestSelectedDB(t *testing.T) {
	env := func(name string) string {
		if name == "STG_DB_PATH" {
			return "env.sqlite"
		}
		return ""
	}
	if got := selectedDB("", "", false, env); got != "env.sqlite" {
		t.Fatal(got)
	}
	if got := selectedDB("", "home", false, env); got != filepath.Join("home", "osgo.sqlite") {
		t.Fatal(got)
	}
	if got := selectedDB("flag.sqlite", "home", true, env); got != "flag.sqlite" {
		t.Fatal(got)
	}
	if got := selectedDB("", "", false, func(string) string { return "" }); got != "" {
		t.Fatal(got)
	}
}

func TestSelectedSID(t *testing.T) {
	// the rule of abap.SIDFromEnv and tools/osd-identity.mjs: OSD_SID, then
	// the alias STG_ADT_SID, then OSD; blank counts as unset
	for _, tc := range []struct{ osd, adt, want string }{
		{"", "", "OSD"}, {"", "osx", "OSX"}, {"abcde", "xyz", "ABC"}, {"  ", "os2", "OS2"},
	} {
		lookup := func(name string) (string, bool) {
			if name == "OSD_SID" {
				return tc.osd, tc.osd != ""
			}
			return tc.adt, tc.adt != ""
		}
		if got := selectedSID(lookup); got != tc.want {
			t.Fatalf("%q/%q: %q", tc.osd, tc.adt, got)
		}
	}
	if got := selectedSID(func(string) (string, bool) { return strings.Repeat("x", 4), true }); got != "XXX" {
		t.Fatal(got)
	}
	if got := selectedSID(func(name string) (string, bool) {
		if name == "OSD_SID" {
			return "", true
		}
		return "", false
	}); got != "OSD" {
		t.Fatal(got)
	}
}
