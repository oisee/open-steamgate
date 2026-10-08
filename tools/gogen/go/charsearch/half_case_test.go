package charsearch

import (
	"osg/gogen/abap"
	"testing"
)

func TestRound3HalfOperators(t *testing.T) {
	hi := abap.SubS("😀", 0, 1)
	s := &abap.Session{}
	if !WithPos(s, hi+"A", "a") || s.Sy.Fdpos != 1 {
		t.Errorf("CS offset %d", s.Sy.Fdpos)
	}
	if WithPos(s, hi+"A", "b") || s.Sy.Fdpos != 2 {
		t.Errorf("CS miss offset %d", s.Sy.Fdpos)
	}
	if abap.CP(hi+"A", "�a", false) {
		t.Error("CP confuses surrogate and replacement character")
	}
	if !abap.CP(hi+"A", "+a", false) {
		t.Error("CP + must match one surrogate unit")
	}
}
