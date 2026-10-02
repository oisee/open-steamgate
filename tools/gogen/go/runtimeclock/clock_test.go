package runtimeclock

import (
	"testing"
	"time"
)

func TestFirstCallAndElapsedMicroseconds(t *testing.T) {
	if first := Microseconds(); first != 0 {
		t.Fatalf("first call = %d, want 0", first)
	}
	time.Sleep(time.Millisecond)
	second := Microseconds()
	if second < 1000 {
		t.Fatalf("elapsed = %d, want at least 1000 microseconds", second)
	}
	if third := Microseconds(); third < second {
		t.Fatalf("clock went backwards: %d < %d", third, second)
	}
}
