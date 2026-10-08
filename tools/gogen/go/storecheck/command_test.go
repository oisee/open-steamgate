package storecheck

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type provider struct {
	calls int
	input Input
	err   error
}

func (p *provider) Available(context.Context) error { return p.err }
func (p *provider) Check(_ context.Context, in Input) ([]Issue, error) {
	p.calls++
	p.input = in
	return []Issue{{Severity: "W", LINE: 0, COL: 0, MESSAGE: "warning"}}, nil
}
func (p *provider) Outline(context.Context, Input) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func TestSavedCheckRunAndRefusals(t *testing.T) {
	source := "unsaved"
	req := Request{Command: "CHECKRUN", Type: "CLAS", Name: "ZCLASS", Known: true, Exists: true, SourceType: true, Input: Input{Source: &source, Include: "absent"}}
	p := &provider{}
	result, err := Run(p, req)
	if err != nil || p.input.Source != nil || !p.input.CheckRun || p.input.Include != "absent" || !strings.Contains(result.Scalars["EV_JSON"], `"severity":"W","line":0,"column":0`) {
		t.Fatalf("%+v %+v %v", result, p.input, err)
	}
	req.Filter = "SOURCE"
	for _, buffer := range []*string{nil, new(string), &source} {
		req.Input.Source = buffer
		before := p.calls
		result, err = Run(p, req)
		if err != nil || !strings.Contains(result.Scalars["EV_JSON"], "IV_FILTER=SOURCE") || p.calls != before {
			t.Fatal(result, err, p.calls)
		}
	}
	req.Filter = ""
	p.err = errors.New("unavailable")
	result, err = Run(p, req)
	if err != nil || !strings.Contains(result.Scalars["EV_JSON"], "unavailable") {
		t.Fatal(result, err)
	}
	result, err = Run(nil, req)
	if err != nil || !strings.Contains(result.Scalars["EV_JSON"], "none is available") {
		t.Fatal(result, err)
	}
}
