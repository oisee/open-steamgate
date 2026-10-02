package sysid

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// testdata/cases.json is the one list of cases: test/osd-identity.mjs reads
// it too, so the Go and the Node hosts apply one rule.
func TestFromEnvCases(t *testing.T) {
	raw, err := os.ReadFile("testdata/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name   string            `json:"name"`
			Env    map[string]string `json:"env"`
			SID    string            `json:"sid"`
			Source string            `json:"source"`
			Error  string            `json:"error"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) < 10 {
		t.Fatalf("only %d cases", len(fixture.Cases))
	}
	for _, tc := range fixture.Cases {
		lookup := func(name string) (string, bool) {
			v, ok := tc.Env[name]
			return v, ok
		}
		sid, source, err := FromEnv(lookup)
		if tc.Error != "" {
			if err == nil || !strings.HasPrefix(err.Error(), tc.Error+"=") {
				t.Errorf("%s: want an error naming %s, got %q from %q (%v)", tc.Name, tc.Error, sid, source, err)
			}
			continue
		}
		if err != nil || sid != tc.SID || source != tc.Source {
			t.Errorf("%s: %q from %q (%v), want %q from %q", tc.Name, sid, source, err, tc.SID, tc.Source)
		}
	}
	if Describe("default") != "default" || Describe("OSD_SID") != "setting OSD_SID" {
		t.Fatal(Describe("default"), Describe("OSD_SID"))
	}
}
