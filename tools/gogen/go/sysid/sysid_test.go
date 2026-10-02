package sysid

import "testing"

// The cases of test/osd-identity.mjs, so the Go and the Node hosts apply
// one rule: OSD_SID, then STG_ADT_SID, then OSD.
func TestFromEnv(t *testing.T) {
	for _, tc := range []struct{ osd, adt, want, source string }{
		{"", "", "OSD", "default"},
		{"  ", "", "OSD", "default"},
		{"qrs", "", "QRS", "OSD_SID"},
		{" qrstu ", "", "QRS", "OSD_SID"},
		{"", "osx", "OSX", "STG_ADT_SID"},
		{"  ", "xyz", "XYZ", "STG_ADT_SID"},
		{"abc", "xyz", "ABC", "OSD_SID"},
	} {
		lookup := func(name string) (string, bool) {
			switch name {
			case "OSD_SID":
				return tc.osd, tc.osd != ""
			case "STG_ADT_SID":
				return tc.adt, tc.adt != ""
			}
			return "", false
		}
		sid, source := FromEnv(lookup)
		if sid != tc.want || source != tc.source {
			t.Fatalf("%q/%q: %q from %q, want %q from %q", tc.osd, tc.adt, sid, source, tc.want, tc.source)
		}
	}
	if Describe("default") != "default" || Describe("OSD_SID") != "setting OSD_SID" {
		t.Fatal(Describe("default"), Describe("OSD_SID"))
	}
}
