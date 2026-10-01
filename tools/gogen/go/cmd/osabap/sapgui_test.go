//go:build osabap_hello

// The host's SAP GUI path against the default report's selection screen
// (tools/gogen/apps/hello): the generated types it names exist only when
// that report is the one generated last, against the pinned open-abap-gui,
// so the file builds only under the osabap_hello tag, which
// tools/gogen/osabap.test.mjs sets right after it builds hello. Any other
// report leaves cmd/osabap vettable and testable.

package main

import (
	"net"
	"strings"
	"testing"

	"github.com/oisee/open-diag-go/pkg/diag"

	"osg/gogen/reportargs"
)

func TestSAPGUIOptionIsSeparateFromReportArguments(t *testing.T) {
	cli, err := reportargs.Parse([]string{"--name", "Alice", "-sapgui=127.0.0.1:3201", "--loud"}, reportargs.HostFlags,
		reportargs.Report{Names: []string{"P_NAME", "P_LOUD"}, Checkboxes: map[string]bool{"P_LOUD": true}})
	if err != nil {
		t.Fatal(err)
	}
	enabled, launch, listen := sapGUIOption(cli.Host)
	if !enabled || !launch || listen != "127.0.0.1:3201" || len(cli.Options) != 2 {
		t.Fatalf("option: enabled=%v launch=%v listen=%q options=%v", enabled, launch, listen, cli.Options)
	}
}

func TestSAPGUIF4IsRefused(t *testing.T) {
	if !sapGUIF4([]diag.Item{{Type: diag.ItemAPPL, ID: 0x0c, SID: 0x04, Value: []byte("=F4")}}) {
		t.Fatal("F4 command was not recognized")
	}
}

func TestSAPGUINoLaunch(t *testing.T) {
	enabled, launch, listen := sapGUIOption([]reportargs.Arg{{Name: "sapgui-no-launch"}})
	if !enabled || launch || listen != defaultSAPGUIListen {
		t.Fatalf("option: enabled=%v launch=%v listen=%q", enabled, launch, listen)
	}
}

func TestSAPGUIWrapperCarriesRealClientSetup(t *testing.T) {
	wrapper, err := sapGUIWrapper()
	if err != nil {
		t.Fatal(err)
	}
	if len(wrapper.Items) < 40 {
		t.Fatalf("wrapper has only %d items", len(wrapper.Items))
	}
	menu, userBlob := false, false
	for _, item := range wrapper.Items {
		menu = menu || item.Type == diag.ItemAPPL4 && item.ID == 0x0b && item.SID == 0x02 && len(item.Value) > 1000
		userBlob = userBlob || item.Type == diag.ItemAPPL4 && item.ID == 0x04 && item.SID == 0x18 && len(item.Value) > 100
	}
	if !menu || !userBlob {
		t.Fatalf("wrapper lacks client setup: menu=%v userBlob=%v", menu, userBlob)
	}
}

func TestSAPGUISelectionValues(t *testing.T) {
	useSAPGUITestSelections(t)
	selection := ZCL_GG_HOST__TY_RESULT{
		elements: []*ZCL_GG_HOST_SCREEN__TY_ELEMENT{
			{kind: "PARAMETER", name: "P_NAME", text: "Name", visible_length: 30},
			{kind: "CHECKBOX", name: "P_LOUD", text: "Loud"},
			{kind: "SELECT_OPTION", name: "S_TAG", text: "Tags", visible_length: 30},
		},
		values: []*ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE{{name: "P_NAME", value: "world"}},
	}
	_, fields := sapGUISelectionScreen(selection)
	atoms := []diag.Atom{
		diag.InputField(2, 34, 30, "Alice"),
		diag.FieldName(2, 34, "P_NAME", diag.AttrYes3D),
		{EType: diag.AtomCheckbox, Row: 3, Col: 2, Attr: diag.AttrYes3D, State: 'X'},
		diag.FieldName(3, 2, "P_LOUD", diag.AttrYes3D),
		diag.InputField(4, 34, 50, "one, two"),
		diag.FieldName(4, 34, "S_TAG", diag.AttrYes3D),
	}
	items := []diag.Item{{Type: diag.ItemAPPL4, ID: 0x09, SID: 0x02, Value: diag.EncodeDyntAtoms(atoms)}}
	values := sapGUISelectionValues(items, fields)
	if len(values) != 3 || values[0].value != "Alice" || values[1].value != "X" {
		t.Fatalf("values: %+v", values)
	}
	if len(values[2].ranges) != 2 || values[2].ranges[0].low != "one" || values[2].ranges[1].low != "two" {
		t.Fatalf("ranges: %+v", values[2].ranges)
	}
}

func TestSAPGUISessionSelectionExecuteAndEnd(t *testing.T) {
	useSAPGUITestSelections(t)
	server, client := net.Pipe()
	defer client.Close()
	selection := ZCL_GG_HOST__TY_RESULT{
		elements: []*ZCL_GG_HOST_SCREEN__TY_ELEMENT{{kind: "PARAMETER", name: "P_NAME", text: "Name", visible_length: 30}},
		values:   []*ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE{{name: "P_NAME", value: "world"}},
	}
	done := make(chan error, 1)
	go func() {
		done <- runSAPGUISession(server, selection, func(values []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE) ZCL_GG_HOST__TY_RESULT {
			if len(values) != 1 || values[0].value != "Alice" {
				t.Errorf("execute values: %+v", values)
			}
			return ZCL_GG_HOST__TY_RESULT{lines: []string{"Hello Alice"}}
		})
	}()

	if err := writeNIFrame(client, make([]byte, diag.DPHeaderLen+diag.HeaderLen)); err != nil {
		t.Fatal(err)
	}
	selectionPayload, err := readNIFrame(client)
	if err != nil {
		t.Fatal(err)
	}
	selectionMessage, err := diag.ParseMessage(selectionPayload, false)
	if err != nil || len(diag.ParseItems(selectionMessage.Body)) == 0 {
		t.Fatalf("selection response: %v", err)
	}
	f4, err := diag.EncodeMessage(diag.Header{MsgInfo: 1}, []diag.Item{
		{Type: diag.ItemAPPL, ID: 0x0c, SID: 0x04, Value: []byte("=F4")},
		{Type: diag.ItemEOM},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeNIFrame(client, f4); err != nil {
		t.Fatal(err)
	}
	f4Payload, err := readNIFrame(client)
	if err != nil {
		t.Fatal(err)
	}
	f4Message, err := diag.ParseMessage(f4Payload, false)
	if err != nil || !strings.Contains(string(f4Message.Body), "F4 is not available in SAP GUI mode; use the terminal") {
		t.Fatalf("F4 status response: %v", err)
	}

	paiAtoms := []diag.Atom{
		diag.InputField(2, 34, 30, "Alice"),
		diag.FieldName(2, 34, "P_NAME", diag.AttrYes3D),
	}
	pai, err := diag.EncodeMessage(diag.Header{MsgInfo: 1}, []diag.Item{
		{Type: diag.ItemAPPL, ID: 0x09, SID: 0x02, Value: diag.EncodeDyntAtoms(paiAtoms)},
		{Type: diag.ItemEOM},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeNIFrame(client, pai); err != nil {
		t.Fatal(err)
	}
	resultPayload, err := readNIFrame(client)
	if err != nil {
		t.Fatal(err)
	}
	resultMessage, err := diag.ParseMessage(resultPayload, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(resultMessage.Body), "Hello Alice") {
		t.Fatalf("result does not contain report output")
	}

	if err := writeNIFrame(client, pai); err != nil {
		t.Fatal(err)
	}
	end, err := readNIFrame(client)
	if err != nil {
		t.Fatal(err)
	}
	header, err := diag.ParseHeader(end)
	if err != nil || header.ComFlag != diag.FlagTermEOC|diag.FlagTermEOP {
		t.Fatalf("end header: %+v, %v", header, err)
	}
	client.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func useSAPGUITestSelections(t *testing.T) {
	t.Helper()
	oldNames, oldCheckboxes, oldRanges := appSelectionNames, appCheckboxes, appRanges
	appSelectionNames = []string{"P_NAME", "P_LOUD", "S_TAG"}
	appCheckboxes = map[string]bool{"P_LOUD": true}
	appRanges = map[string]bool{"S_TAG": true}
	t.Cleanup(func() {
		appSelectionNames, appCheckboxes, appRanges = oldNames, oldCheckboxes, oldRanges
	})
}
