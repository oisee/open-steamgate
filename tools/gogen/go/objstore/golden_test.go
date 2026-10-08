package objstore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

type goldenAnswer struct {
	Scalars   map[string]string `json:"scalars"`
	Objects   []Row             `json:"objects"`
	Issues    []Issue           `json:"issues"`
	Types     []Tally           `json:"types"`
	Revisions []Revision        `json:"revisions"`
}

type wireAnswer struct {
	Scalars   map[string]string `json:"-"`
	Objects   []Row             `json:"ET_OBJECT"`
	Issues    []Issue           `json:"ET_ISSUE"`
	Types     []Tally           `json:"ET_TYPE"`
	Revisions []Revision        `json:"ET_REVISION"`
}

func (w *wireAnswer) UnmarshalJSON(data []byte) error {
	var top struct {
		Scalars   map[string]string
		Objects   []Row      `json:"ET_OBJECT"`
		Issues    []Issue    `json:"ET_ISSUE"`
		Types     []Tally    `json:"ET_TYPE"`
		Revisions []Revision `json:"ET_REVISION"`
	}
	if err := json.Unmarshal(data, &top); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for key, raw := range fields {
		if !strings.HasPrefix(key, "EV_") {
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return err
		}
		if top.Scalars == nil {
			top.Scalars = map[string]string{}
		}
		top.Scalars[key] = value
	}
	*w = wireAnswer{top.Scalars, top.Objects, top.Issues, top.Types, top.Revisions}
	return nil
}

var goldenCases = []struct {
	name       string
	parameters map[string]string
}{
	{"object-class", map[string]string{"IV_COMMAND": "OBJECT", "IV_TYPE": "CLAS", "IV_NAME": "ZCLASS"}},
	{"object-tmp", map[string]string{"IV_COMMAND": "OBJECT", "IV_TYPE": "PROG", "IV_NAME": "ZTMP_PROG"}},
	{"object-library", map[string]string{"IV_COMMAND": "OBJECT", "IV_TYPE": "PROG", "IV_NAME": "ZLIBRARY"}},
	{"object-missing", map[string]string{"IV_COMMAND": "OBJECT", "IV_TYPE": "PROG", "IV_NAME": "ZMISSING"}},
	{"package-raw", map[string]string{"IV_COMMAND": "PACKAGE", "IV_JSON": `{"mode":"raw","name":"$STG"}`}},
	{"package-local", map[string]string{"IV_COMMAND": "PACKAGE", "IV_JSON": `{"mode":"local","name":"$TMP","user":"ALICE"}`}},
	{"packages-json", map[string]string{"IV_COMMAND": "PACKAGES", "IV_JSON": `{}`}},
	{"packages-lines", map[string]string{"IV_COMMAND": "PACKAGES", "IV_JSON": `{"format":"lines"}`}},
	{"packages-vfs-lines", map[string]string{"IV_COMMAND": "PACKAGES", "IV_JSON": `{"format":"vfs-lines"}`}},
	{"search-json", map[string]string{"IV_COMMAND": "SEARCH", "IV_JSON": `{"seed":"Z","limit":100}`}},
	{"search-zero", map[string]string{"IV_COMMAND": "SEARCH", "IV_JSON": `{"seed":"Z","limit":0}`}},
	{"search-lines", map[string]string{"IV_COMMAND": "SEARCH", "IV_JSON": `{"seed":"Z","type":"PROG","format":"lines"}`}},
	{"read-main", map[string]string{"IV_COMMAND": "READ", "IV_TYPE": "CLAS", "IV_NAME": "ZCLASS"}},
	{"read-include", map[string]string{"IV_COMMAND": "READ", "IV_TYPE": "CLAS", "IV_NAME": "ZCLASS", "IV_INCLUDE": "definitions"}},
	{"read-missing-include", map[string]string{"IV_COMMAND": "READ", "IV_TYPE": "CLAS", "IV_NAME": "ZCLASS", "IV_INCLUDE": "macros"}},
	{"read-library", map[string]string{"IV_COMMAND": "READ", "IV_TYPE": "PROG", "IV_NAME": "ZLIBRARY"}},
	{"history-main", map[string]string{"IV_COMMAND": "HISTORY", "IV_TYPE": "PROG", "IV_NAME": "ZPROGRAM"}},
	{"history-include", map[string]string{"IV_COMMAND": "HISTORY", "IV_TYPE": "CLAS", "IV_NAME": "ZCLASS", "IV_INCLUDE": "macros"}},
}

func TestStoreDestinationGoldens(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "test", "fixtures", "osgo-store")
	config, err := os.ReadFile(filepath.Join(root, "store.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := SetStore(root, config, ""); err != nil {
		t.Fatal(err)
	}
	defer SetStore("", nil, "")
	goldenBytes, err := os.ReadFile(filepath.Join(root, "destination-golden.json"))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]wireAnswer
	if err := json.Unmarshal(goldenBytes, &raw); err != nil {
		t.Fatal(err)
	}
	timeLike := regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$`)
	for _, test := range goldenCases {
		t.Run(test.name, func(t *testing.T) {
			input := map[string]*string{}
			for key, value := range test.parameters {
				value := value
				input[key] = &value
			}
			answer := Call(input)
			answer.Scalars["EV_MS"] = "0"
			for key, value := range answer.Scalars {
				if timeLike.MatchString(value) {
					answer.Scalars[key] = "<time>"
				}
			}
			for i, row := range answer.Objects {
				if timeLike.MatchString(row.CHANGED_AT) {
					answer.Objects[i].CHANGED_AT = "<time>"
				}
			}
			want := goldenAnswer{raw[test.name].Scalars, raw[test.name].Objects,
				raw[test.name].Issues, raw[test.name].Types, raw[test.name].Revisions}
			got := goldenAnswer{answer.Scalars, answer.Objects, answer.Issues, answer.Types, answer.Revisions}
			if !reflect.DeepEqual(got, want) {
				gotJSON, _ := json.MarshalIndent(got, "", "  ")
				wantJSON, _ := json.MarshalIndent(want, "", "  ")
				t.Fatalf("answer differs\n got: %s\nwant: %s", gotJSON, wantJSON)
			}
		})
	}
}

func TestStoreHistoryStateUsesGitStatus(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	storeState.root = root
	defer func() { storeState.root = "" }()
	state, changed := storeHistoryState(root, "file")
	if state != "modified" {
		t.Fatalf("state outside a repository: %q", state)
	}
	if _, err := time.Parse(time.RFC3339, strings.Replace(changed, "Z", "+00:00", 1)); err != nil && changed != "1970-01-01T00:00:00.000Z" {
		t.Fatalf("changed time: %q (%v)", changed, err)
	}
}

func TestStoreReadActiveVersion(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "src", "active.prog.abap")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("REPORT active.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "src", "unproven.prog.abap"), []byte("REPORT unproven.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "abap_transpile.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer SetStore("", nil, "")
	if err := SetStore(root, []byte(`{"roots":[{"path":"src","writable":true,"library":false}]}`), ""); err != nil {
		t.Fatal(err)
	}
	storeState.cfg.Built = map[string]string{"src/active.prog.abap": storeDigest("src/active.prog.abap")}
	str := func(value string) *string { return &value }
	answer := Call(map[string]*string{"IV_COMMAND": str("READ"), "IV_TYPE": str("PROG"), "IV_NAME": str("ACTIVE"), "IV_REVISION": str("active")})
	if answer.Scalars["EV_ERROR"] != "" || answer.Scalars["EV_SOURCE"] != "REPORT active.\n" {
		t.Fatalf("active read: %v", answer.Scalars)
	}
	answer = Call(map[string]*string{"IV_COMMAND": str("READ"), "IV_TYPE": str("PROG"), "IV_NAME": str("UNPROVEN"), "IV_REVISION": str("active")})
	if answer.Scalars["EV_ERROR"] != "PROG UNPROVEN active version (main) does not exist" {
		t.Fatalf("active refusal: %v", answer.Scalars)
	}
}
