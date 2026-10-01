package main

import (
	"reflect"
	"strings"

	"osg/gogen/termgui"
)

// selectionRetry is a selection screen sent again after a MESSAGE E or W of
// its events (ZCL_GG_HOST's selection_error): the message for the status
// line, the field the cursor goes to and, after AT SELECTION-SCREEN ON
// <field>, the one field that is ready for input. A warning is confirmed by
// Enter with the values it was given, as in SAP GUI; changed values run the
// checks again without the confirmation.
type selectionRetry struct {
	kind, text, field, ready string
	warned                   []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE
}

// selectionAgain says whether the result is a selection screen to send again.
func selectionAgain(result ZCL_GG_HOST__TY_RESULT, input []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE) (selectionRetry, bool) {
	e := result.selection_error
	kind := strings.TrimSpace(e.type_)
	if result.selection_active != "X" || (kind != "E" && kind != "W") {
		return selectionRetry{}, false
	}
	return selectionRetry{kind: kind, text: strings.TrimSpace(e.text), field: strings.TrimSpace(e.field),
		ready: strings.TrimSpace(e.ready), warned: input}, true
}

// confirms is the host's iv_confirm_warnings for the next run: "X" when a
// warning was shown and the values are the ones it was given.
func (r selectionRetry) confirms(input []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE) string {
	if r.kind == "W" && reflect.DeepEqual(r.warned, input) {
		return "X"
	}
	return ""
}

func (r selectionRetry) apply(form termgui.Form) termgui.Form {
	switch r.kind {
	case "E":
		form.Message = "Error: " + r.text
	case "W":
		form.Message = "Warning: " + r.text + " (Enter: continue)"
	default:
		return form
	}
	form.Focus = r.field
	if r.ready != "" {
		for i := range form.Fields {
			// a select-option's HIGH row belongs to its field
			name := strings.SplitN(form.Fields[i].Name, "-", 2)[0]
			form.Fields[i].Locked = name != r.ready
		}
	}
	return form
}
