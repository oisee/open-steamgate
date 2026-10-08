package charsearch

import (
	"osg/gogen/abap"
	"testing"
)

func TestOriginalPositionAfterUppercaseExpansion(t *testing.T) {
	s := &abap.Session{}
	if WithPos(s, "aß", "x") || s.Sy.Fdpos != 2 {
		t.Fatalf("miss position = %d, want 2", s.Sy.Fdpos)
	}
	if !WithPos(s, "ßa", "a") || s.Sy.Fdpos != 1 {
		t.Fatalf("expanded prefix offset = %d", s.Sy.Fdpos)
	}
	if !WithPos(s, "aß", "ss") || s.Sy.Fdpos != 1 {
		t.Fatalf("expansion match offset = %d", s.Sy.Fdpos)
	}
}
