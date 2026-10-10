//go:build osabap_readgrants

package main

import (
	"os"
	"path/filepath"
	"testing"

	"osg/gogen/abap"
)

// Run immediately after the --read-params report build, with its embedded
// parameter policy, through the same startup path used by the native command.
func TestReadGrantUploadInspectionWithoutBrowsing(t *testing.T) {
	for _, key := range []string{"OSD_DATASET_READ", "OSD_DATASET_WRITE", "OSD_DATASET_HOME", "OSD_DATASET_AUDIT"} {
		t.Setenv(key, "")
	}
	dir := t.TempDir()
	file, sibling := filepath.Join(dir, "input.txt"), filepath.Join(dir, "sibling.txt")
	for _, name := range []string{file, sibling} {
		if err := os.WriteFile(name, []byte("content"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	datasetOptions(nil, []ZIF_GG_SELECTION_SCREEN_TYPES__TY_VALUE{{name: "P_FILE", value: file}})
	defer dialogSandbox.Close()
	defer abap.SetDatasetHost(nil)
	if _, info, err := dialogSandbox.BrowseEntry(file, false); err != nil || !info.Mode().IsRegular() {
		t.Fatal(info, err)
	}
	if h, msg := dialogSandbox.Open(file, abap.DatasetInput); h == nil {
		t.Fatal(msg)
	} else {
		h.Close()
	}
	if _, _, err := dialogSandbox.BrowseEntry(sibling, false); err == nil {
		t.Fatal("sibling inspected")
	}
	if h, _ := dialogSandbox.Open(sibling, abap.DatasetInput); h != nil {
		h.Close()
		t.Fatal("sibling opened")
	}
	if _, f, err := dialogSandbox.BrowsePath(dir, false); err == nil {
		f.Close()
		t.Fatal("directory browsing granted")
	}
	if len(dialogSandbox.BrowseRoots(false)) != 0 {
		t.Fatal("file grant advertised directory roots")
	}
}
