package abap

import "testing"

func TestLocalDestinationsBelongToSession(t *testing.T) {
	a, b := &Session{}, &Session{}
	RegisterLocalDestination(a, "LOCAL   ")
	if !a.localDestinations["LOCAL"] || b.localDestinations["LOCAL"] {
		t.Fatal("local destination escaped its internal session")
	}
}
