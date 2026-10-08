package abap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRound3TextFileEgress(t *testing.T) {
	f := newDatasetFixture(t)
	hi, lo := SubS("😀", 0, 1), SubS("😀", 1, 1)
	for _, tc := range []struct{ name, value, want string }{
		{"pair", ConcatLinesOf([]string{hi, lo}, ""), "😀"},
		// Unmeasured kernel behavior: the host currently writes lone WTF-8 bytes.
		{"lone", hi, hi},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name := filepath.Join(f.out, tc.name+".txt")
			f.open(name, DatasetOutput, false)
			Transfer(f.s, str(tc.value), name, -1, false)
			CloseDataset(f.s, name)
			got, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tc.want+"\n" {
				t.Errorf("DATASET bytes=%x", got)
			}
			rows := []string{tc.value}
			name = filepath.Join(f.out, tc.name+"-gui.txt")
			FrontendDownload(f.s, name, "ASC", 0, "X", "", stringTable(&rows))
			got, err = os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tc.want+"\n" {
				t.Errorf("GUI_DOWNLOAD bytes=%x", got)
			}
		})
	}
}
