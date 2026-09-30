package charsearch

import (
	"testing"
	"osg/gogen/abap"
)

func TestUppercaseExpansionOnMiss(t *testing.T) {
	s := &abap.Session{}
	if WithPos(s, "aß", "x") || s.Sy.Fdpos != 3 {
		t.Fatalf("miss position = %d, want 3", s.Sy.Fdpos)
	}
}
