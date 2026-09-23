package abap

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"
)

// every case of writes.json: the statement osg-i7's ir-writes.mjs built,
// rendered by the port byte for byte as lower() renders it for SQLite, and
// run on a real SQLite seeded as the file says (the engine refuses the
// duplicate of the one "error" case, and nothing else)
func TestWritesPairs(t *testing.T) {
	var file struct {
		Seed  [][]any `json:"seed"`
		Pairs []struct {
			Name      string             `json:"name"`
			Statement IRWrite            `json:"statement"`
			Lowered   map[string]lowered `json:"lowered"`
		} `json:"pairs"`
	}
	if err := json.Unmarshal(pairsFile(t, "writes.json"), &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Pairs) == 0 {
		t.Fatal("no pairs")
	}
	for _, c := range file.Pairs {
		text, params, err := LowerWrite(&c.Statement)
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		want := c.Lowered["sqlite"]
		if text != want.SQL {
			t.Errorf("%s:\n got  %s\n want %s", c.Name, text, want.SQL)
		}
		if params == nil {
			params = []Param{}
		}
		if !reflect.DeepEqual(normal(t, params), normal(t, want.Params)) {
			t.Errorf("%s: params %v, want %v", c.Name, params, want.Params)
		}
		d, err := sql.Open("sqlite", ":memory:")
		if err != nil {
			t.Fatal(err)
		}
		d.SetMaxOpenConns(1)
		if _, err := d.Exec(`CREATE TABLE "T" ("MANDT" VARCHAR, "ID" INTEGER, "TXT" VARCHAR, PRIMARY KEY ("MANDT", "ID"))`); err != nil {
			t.Fatal(err)
		}
		for _, r := range file.Seed {
			if _, err := d.Exec(`INSERT INTO "T" VALUES (?, ?, ?)`, r...); err != nil {
				t.Fatal(err)
			}
		}
		_, err = d.Exec(text, values(params)...)
		if c.Name == "INSERT a duplicate key: the engine raises" {
			if err == nil || !duplicateKey(err) {
				t.Errorf("%s: %v, want a duplicate key", c.Name, err)
			}
		} else if err != nil {
			t.Errorf("%s: %v", c.Name, err)
		}
		d.Close()
	}
	t.Logf("%d write pairs rendered byte for byte and run on SQLite", len(file.Pairs))
}
