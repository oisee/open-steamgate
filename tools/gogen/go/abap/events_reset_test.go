package abap

import (
	"testing"

	"osg/gogen/session"
)

func TestInternalSessionResetClearsGlobalEventHandlers(t *testing.T) {
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
	RaiseEvent(s, "RESET_STATIC", nil, true, func() any { return nil })
	RaiseEvent(s, "RESET_ALL", &struct{}{}, false, func() any { return nil })
	if called != 2 {
		t.Fatalf("handlers survived session reset: got %d calls", called)
	}
}
