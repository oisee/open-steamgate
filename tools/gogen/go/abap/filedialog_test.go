package abap

import (
	"strings"
	"testing"
)

func TestFrontendDialogInputsAndMultipleRows(t *testing.T) {
	type row struct{ filename string }
	var rows []row
	var rc, action int32
	FrontendPick = func(kind, initial, name, title string) (string, error) {
		if kind != "open-multiple|Text (*.txt)|*.txt|txt" || initial != "/starting" || title != "Choose" {
			t.Fatalf("open inputs: %q %q %q", kind, initial, title)
		}
		return "/root/a.txt\x00/root/b.txt", nil
	}
	t.Cleanup(func() { FrontendPick = nil })
	FrontendFileOpenDialog(nil, "Choose", "", "Text (*.txt)|*.txt", "txt", "/starting", "X", &rows, &rc, &action)
	if rc != 2 || action != 0 || len(rows) != 2 || rows[0].filename != "/root/a.txt" || rows[1].filename != "/root/b.txt" {
		t.Fatalf("open result: %+v %d %d", rows, rc, action)
	}
	FrontendPick = func(kind, initial, name, title string) (string, error) {
		if !strings.HasSuffix(kind, "|X") || name != "report" {
			t.Fatalf("save inputs: %q %q", kind, name)
		}
		return "/root/report.txt", nil
	}
	var filename, dir, full string
	FrontendFileSaveDialog(nil, "Save", "report", "", "txt", "/root", "X", &filename, &dir, &full, &action)
	if filename != "report.txt" || dir != "/root" || full != "/root/report.txt" || action != 0 {
		t.Fatalf("save result: %q %q %q %d", filename, dir, full, action)
	}
}
