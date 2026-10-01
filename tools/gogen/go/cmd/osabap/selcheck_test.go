//go:build osabap_selcheck

package main

import (
	"strings"
	"testing"

	"osg/gogen/abap"
	"osg/gogen/termgui"
)

// apps/selcheck through the loop main runs in the terminal: each run of the
// host and what the next form shows
func selcheckRun(t *testing.T, values map[string]selectionInput, retry selectionRetry) (ZCL_GG_HOST__TY_RESULT, selectionRetry, bool) {
	t.Helper()
	s := &abap.Session{}
	report := newReport(s)
	input := selectionValues(values)
	var result ZCL_GG_HOST__TY_RESULT
	confirm := retry.confirms(input)
	abap.DialogStep(func() { result = hostRunRequest(s, report, input, "", "", "", confirm) })
	next, again := selectionAgain(result, input)
	return result, next, again
}

func lines(result ZCL_GG_HOST__TY_RESULT) string {
	return strings.Join(result.lines, "\n")
}

func TestSelectionErrorOnFieldLocksTheOthers(t *testing.T) {
	result, retry, again := selcheckRun(t, map[string]selectionInput{"P_A": {value: "ok"}, "P_B": {value: "BAD"}}, selectionRetry{})
	if !again || retry.kind != "E" || retry.text != "B is wrong" || retry.field != "P_B" || retry.ready != "P_B" {
		t.Fatalf("retry %+v again %v", retry, again)
	}
	if lines(result) != "" {
		t.Fatalf("START-OF-SELECTION ran: %q", lines(result))
	}
	form := retry.apply(termgui.Form{Fields: []termgui.Field{{Name: "P_A"}, {Name: "P_B"}}})
	if form.Focus != "P_B" || !form.Fields[0].Locked || form.Fields[1].Locked || form.Message != "Error: B is wrong" {
		t.Fatalf("form %+v", form)
	}
	// the values kept for the screen sent again
	kept := map[string]string{}
	for _, v := range result.values {
		kept[strings.TrimSpace(v.name)] = strings.TrimSpace(v.value)
	}
	if kept["P_A"] != "ok" || kept["P_B"] != "BAD" {
		t.Fatalf("values %v", kept)
	}

	result, _, again = selcheckRun(t, map[string]selectionInput{"P_A": {value: "ok"}, "P_B": {value: "good"}}, retry)
	if again || !strings.Contains(lines(result), "ran") {
		t.Fatalf("after the fix: again %v lines %q", again, lines(result))
	}
}

func TestSelectionWarningIsConfirmedByEnter(t *testing.T) {
	values := map[string]selectionInput{"P_A": {value: "WARN"}, "P_B": {value: "x"}}
	result, retry, again := selcheckRun(t, values, selectionRetry{})
	if !again || retry.kind != "W" || retry.ready != "" || lines(result) != "" {
		t.Fatalf("retry %+v again %v lines %q", retry, again, lines(result))
	}
	// changed values: the checks run again and warn again
	_, retry2, again := selcheckRun(t, map[string]selectionInput{"P_A": {value: "WARN"}, "P_B": {value: "y"}}, retry)
	if !again || retry2.kind != "W" {
		t.Fatalf("changed values were confirmed: %+v", retry2)
	}
	// the same values: Enter confirms and the report runs
	result, _, again = selcheckRun(t, values, retry)
	if again || !strings.Contains(lines(result), "ran") {
		t.Fatalf("confirmed: again %v lines %q messages %+v", again, lines(result), result.messages)
	}
	for _, m := range result.messages {
		if m.type_ == "W" {
			t.Fatalf("a confirmed warning came back: %+v", m)
		}
	}
}

func TestSelectionObligatoryKeepsEveryFieldReady(t *testing.T) {
	// P_B is wrong too, but the empty OBLIGATORY P_A is checked first
	_, retry, again := selcheckRun(t, map[string]selectionInput{"P_B": {value: "BAD"}}, selectionRetry{})
	if !again || retry.kind != "E" || retry.field != "P_A" || retry.ready != "" {
		t.Fatalf("retry %+v again %v", retry, again)
	}
}

func TestSelectionSecondWarningIsSentAfterTheFirst(t *testing.T) {
	values := map[string]selectionInput{"P_A": {value: "WARN2"}, "P_B": {value: "x"}}
	_, retry, again := selcheckRun(t, values, selectionRetry{})
	if !again || retry.text != "Are you sure" {
		t.Fatalf("first: %+v", retry)
	}
	_, retry, again = selcheckRun(t, values, retry)
	if !again || retry.kind != "W" || retry.text != "Really sure" {
		t.Fatalf("second: %+v again %v", retry, again)
	}
}
