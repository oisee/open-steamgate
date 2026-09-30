package tstmp

import (
	"testing"

	"osg/gogen/abap"
)

func TestSubtractSecs(t *testing.T) {
	for _, c := range []struct {
		in   string
		secs int32
		want string
	}{
		{"20260930120000", 60, "20260930115900"},
		{"20260930120000.5000000", 3600, "20260930110000"},
		{"20260101000000", 1, "20251231235959"},
		{"20260930120000", -30, "20260930120030"},
	} {
		if got := SubtractSecs(&abap.Session{}, c.in, c.secs); got != c.want {
			t.Fatalf("%s - %d: %s, want %s", c.in, c.secs, got, c.want)
		}
	}
	defer func() {
		if recover() == nil {
			t.Fatal("a value that is not a time stamp must be refused")
		}
	}()
	SubtractSecs(&abap.Session{}, "20261399000000", 1)
}
