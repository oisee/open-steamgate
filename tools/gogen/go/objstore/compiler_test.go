package objstore

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type testCompiler struct {
	request     CompilerInput
	diagnostics []Issue
	err         error
}

func (c *testCompiler) Available(context.Context) error { return c.err }
func (c *testCompiler) Check(ctx context.Context, in CompilerInput) ([]Issue, error) {
	c.request = in
	return c.diagnostics, c.err
}
func (c *testCompiler) Outline(ctx context.Context, in CompilerInput) (json.RawMessage, error) {
	c.request = in
	return json.RawMessage(`{"found":true}`), c.err
}

func TestCompilerStore(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "src"), 0700)
	os.WriteFile(filepath.Join(root, "abap_transpile.json"), []byte(`{}`), 0600)
	os.WriteFile(filepath.Join(root, "src/ztest.prog.abap"), []byte("REPORT ztest."), 0600)
	if err := SetStore(root, []byte(`{"roots":[{"path":"src","writable":true}]}`), ""); err != nil {
		t.Fatal(err)
	}
	defer SetStore("", nil, "")
	c := &testCompiler{diagnostics: []Issue{{OBJ_TYPE: "PROG", OBJ_NAME: "ZTEST", FILE: "/src/ztest.prog.abap", LINE: 2, COL: 4, RULE: "syntax", MESSAGE: "bad"}}}
	SetCompiler(c, "live-generation")
	defer SetCompiler(nil, "")
	str := func(s string) *string { return &s }
	call := map[string]*string{"IV_COMMAND": str("CHECK"), "IV_TYPE": str("PROG"), "IV_NAME": str("ZTEST")}
	a := Call(call)
	if a.Scalars["EV_ERROR"] != "" || a.Scalars["EV_COUNT"] != "1" || len(a.Issues) != 1 || a.Issues[0].COL != 4 || a.Issues[0].FILE != "/src/ztest.prog.abap" {
		t.Fatalf("check: %+v", a)
	}
	if c.request.Generation != "live-generation" || c.request.Version != "inactive" || len(c.request.Files) != 1 {
		t.Fatalf("snapshot input: %+v", c.request)
	}
	if !strings.Contains(a.Scalars["EV_JSON"], `"issues":[{"OBJ_TYPE":"PROG"`) {
		t.Fatal(a.Scalars)
	}
	call = map[string]*string{"IV_COMMAND": str("PARSE"), "IV_JSON": str(`{"kind":"OUTLINE","type":"PROG","name":"ZTEST","version":"active"}`)}
	a = Call(call)
	if a.Scalars["EV_ERROR"] != "" || len(c.request.Files) != 0 {
		t.Fatal("unproven active outline must pass an empty source list")
	}
	call["IV_JSON"] = str(`{"kind":"OUTLINE","type":"PROG","name":"ZTEST"}`)
	a = Call(call)
	if a.Scalars["EV_JSON"] != `{"found":true}` {
		t.Fatal(a.Scalars)
	}
	for _, reason := range []string{"SNAPSHOT_MISMATCH", "TIMEOUT", "UNSUPPORTED_OP"} {
		c.err = errors.New(reason + ": refused")
		a = Call(call)
		if !strings.Contains(a.Scalars["EV_ERROR"], reason) || !strings.Contains(a.Scalars["EV_JSON"], "NOT_SUPPORTED") {
			t.Fatal(a.Scalars)
		}
	}
}
