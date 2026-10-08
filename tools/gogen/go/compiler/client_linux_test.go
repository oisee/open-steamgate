package compiler

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestExitedLeaderIsNotReapedBeforeGroupCleanup(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("zombie-state proof is Linux-specific")
	}
	marker := filepath.Join(t.TempDir(), "marker")
	t.Setenv("COMPILER_MARKER", marker)
	c := fake(t, "idle-descendant-exit")
	if err := c.Hello(context.Background()); err != nil {
		t.Fatal(err)
	}
	proc := c.proc
	select {
	case <-proc.exited:
	case <-time.After(time.Second):
		t.Fatal("leader exit was not observed")
	}
	raw, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", proc.pid()))
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(string(raw[strings.LastIndex(string(raw), ")")+1:]))
	if fields[0] != "Z" {
		t.Fatalf("leader state before cleanup is %q, want zombie", fields[0])
	}
	c.stop()
	select {
	case <-proc.dead:
	case <-time.After(time.Second):
		t.Fatal("cleanup did not reap leader")
	}
	waitDescendantGone(t, marker)
}
