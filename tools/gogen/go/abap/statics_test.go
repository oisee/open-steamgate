package abap

import "testing"

type testClassStatics struct {
	count int
	ran   bool
}

var testClassSlot = RegisterStatics(func() any { return &testClassStatics{count: 7} })
var testOtherSlot = RegisterStatics(func() any { return new(int) })

func TestStaticsIsolationAndStableAddress(t *testing.T) {
	a, b := &Session{}, &Session{}
	st := a.Statics(testClassSlot).(*testClassStatics)
	addr := &st.count
	st.count, st.ran = 42, true
	a.Statics(testOtherSlot) // initializing another slot preserves references
	if a.Statics(testClassSlot) != st || *addr != 42 {
		t.Fatal("class storage moved")
	}
	other := b.Statics(testClassSlot).(*testClassStatics)
	if other == st || other.count != 7 || other.ran {
		t.Fatal("class storage shared across sessions")
	}
	if allocs := testing.AllocsPerRun(100, func() { a.Statics(testClassSlot) }); allocs != 0 {
		t.Fatalf("hot lookup allocated: %g", allocs)
	}
}
