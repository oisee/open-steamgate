package reportargs

import "testing"

func TestNoDefaultReadsHostFlag(t *testing.T) {
	r, err := Parse([]string{"-no-default-reads", "--file", "input.txt"}, HostFlags, Report{Names: []string{"P_FILE"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Host) != 1 || r.Host[0].Name != "no-default-reads" || len(r.Options) != 1 {
		t.Fatalf("%+v", r)
	}
}
