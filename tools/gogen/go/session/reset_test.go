package session

import "testing"

func TestResetRefusesActiveTestClass(t *testing.T) {
	state := 7
	Register(func() { state = 0 })
	BeginTestClass()
	if state != 0 {
		t.Fatalf("class boundary did not reset state: %d", state)
	}
	state = 9
	func() {
		defer func() {
			if recover() == nil {
				t.Error("a second test class started while one was active")
			}
		}()
		BeginTestClass()
	}()
	func() {
		defer func() {
			if recover() == nil {
				t.Error("Reset accepted an active test class")
			}
		}()
		Reset()
	}()
	if state != 9 {
		t.Fatalf("active class state changed: %d", state)
	}
	EndTestClass()
	Reset()
	if state != 0 {
		t.Fatalf("Reset after the class did not clear state: %d", state)
	}
}
