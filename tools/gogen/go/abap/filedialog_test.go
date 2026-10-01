package abap

import (
	"errors"
	"testing"
)

func TestFrontendDialogInputsAndMultipleRows(t *testing.T) {
	type row struct{ filename string }
	var rows []row
	var rc, action int32
	FrontendPick = func(options FrontendPickOptions) (string, error) {
		if options != (FrontendPickOptions{Kind: "open-multiple", Initial: "/starting", Title: "Choose", Filter: "Text (*.txt)|*.txt|All (*.*)|*.*", Extension: "txt"}) {
			t.Fatalf("open inputs: %+v", options)
		}
		return "/root/a.txt\x00/root/b.txt", nil
	}
	t.Cleanup(func() { FrontendPick = nil })
	FrontendFileOpenDialog(nil, "Choose", "", "Text (*.txt)|*.txt|All (*.*)|*.*", "txt", "/starting", "X", &rows, &rc, &action)
	if rc != 2 || action != 0 || len(rows) != 2 || rows[0].filename != "/root/a.txt" || rows[1].filename != "/root/b.txt" {
		t.Fatalf("open result: %+v %d %d", rows, rc, action)
	}
	FrontendPick = func(options FrontendPickOptions) (string, error) {
		if options != (FrontendPickOptions{Kind: "save", Initial: "/root", Name: "report", Title: "Save", Filter: "Text (*.txt)|*.txt|All (*.*)|*.*", Extension: "txt", Prompt: "X"}) {
			t.Fatalf("save inputs: %+v", options)
		}
		return "/root/report.txt", nil
	}
	var filename, dir, full string
	FrontendFileSaveDialog(nil, "Save", "report", "Text (*.txt)|*.txt|All (*.*)|*.*", "txt", "/root", "X", &filename, &dir, &full, &action)
	if filename != "report.txt" || dir != "/root" || full != "/root/report.txt" || action != 0 {
		t.Fatalf("save result: %q %q %q %d", filename, dir, full, action)
	}
}

func TestFrontendOpenCancelAndFailureCodes(t *testing.T) {
	type row struct{ filename string }
	for _, tc := range []struct {
		name string
		err  error
		rc   int32
	}{
		{"cancel", ErrFrontendPickCancel, 0},
		{"no grant", errors.New("no -allow-read root"), -1},
		{"sandbox refusal", errors.New("outside sandbox"), -1},
		{"I/O error", errors.New("read failed"), -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			FrontendPick = func(FrontendPickOptions) (string, error) { return "", tc.err }
			t.Cleanup(func() { FrontendPick = nil })
			rows := []row{{filename: "stale"}}
			var rc, action int32
			FrontendFileOpenDialog(nil, "", "", "", "", "", "", &rows, &rc, &action)
			if rc != tc.rc || action != 9 || len(rows) != 0 {
				t.Fatalf("rc=%d action=%d rows=%+v", rc, action, rows)
			}
		})
	}
}

func TestFrontendSaveAndDirectoryKeepFieldsOnCancelOrFailure(t *testing.T) {
	for _, err := range []error{ErrFrontendPickCancel, errors.New("no -allow-write root")} {
		FrontendPick = func(FrontendPickOptions) (string, error) { return "", err }
		filename, dir, full, folder := "old.txt", "/old", "/old/old.txt", "/old"
		var action int32
		FrontendFileSaveDialog(nil, "", "", "", "", "", "", &filename, &dir, &full, &action)
		FrontendDirectoryBrowse(nil, "", "", &folder)
		if action != 9 || filename != "old.txt" || dir != "/old" || full != "/old/old.txt" || folder != "/old" {
			t.Fatalf("err=%v action=%d save=%q %q %q directory=%q", err, action, filename, dir, full, folder)
		}
	}
	FrontendPick = nil
}
