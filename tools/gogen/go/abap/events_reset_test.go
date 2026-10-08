package abap

import (
	"testing"

	"osg/gogen/session"
)

func TestFreshInternalSessionHasNoEventHandlers(t *testing.T) {
	s := &Session{}
	called := 0
	handler := func(*Session, any, any) { called++ }
	SetHandler(s, "RESET_STATIC", nil, false, true, nil, "STATIC", nil, handler, true)
	SetHandler(s, "RESET_ALL", nil, true, false, nil, "ALL", nil, handler, true)
	RaiseEvent(s, "RESET_STATIC", nil, true, func() any { return nil })
	RaiseEvent(s, "RESET_ALL", &struct{}{}, false, func() any { return nil })
	if called != 2 {
		t.Fatalf("handlers before reset: got %d calls, want 2", called)
	}
	session.Reset()
	// A reset of host runtime stores must not erase a live private store.
	RaiseEvent(s, "RESET_STATIC", nil, true, func() any { return nil })
	if called != 3 {
		t.Fatalf("live private registration lost: %d", called)
	}
	s = &Session{}
	RaiseEvent(s, "RESET_STATIC", nil, true, func() any { return nil })
	RaiseEvent(s, "RESET_ALL", &struct{}{}, false, func() any { return nil })
	if called != 3 {
		t.Fatalf("fresh session inherited handlers: got %d calls", called)
	}
}
