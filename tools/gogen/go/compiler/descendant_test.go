package compiler

import (
	"strconv"
	"strings"
	"testing"
	"time"
)

func waitDescendantGone(t *testing.T, marker string) {
	t.Helper()
	pid, err := strconv.Atoi(strings.TrimSpace(string(waitFile(t, marker+".pid"))))
	if err != nil || pid <= 0 {
		t.Fatalf("invalid descendant PID: %d %v", pid, err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		gone, err := descendantGone(pid)
		if err != nil {
			t.Fatal(err)
		}
		if gone {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("descendant %d still exists", pid)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
