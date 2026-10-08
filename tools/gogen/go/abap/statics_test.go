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
	st := a.Static(testClassSlot).(*testClassStatics)
	addr := &st.count
	st.count, st.ran = 42, true
	a.Static(testOtherSlot) // initializing another slot preserves references
	if a.Static(testClassSlot) != st || *addr != 42 {
		t.Fatal("class storage moved")
	}
	other := b.Static(testClassSlot).(*testClassStatics)
	if other == st || other.count != 7 || other.ran {
		t.Fatal("class storage shared across sessions")
	}
	if allocs := testing.AllocsPerRun(100, func() { a.Static(testClassSlot) }); allocs != 0 {
		t.Fatalf("hot lookup allocated: %g", allocs)
	}
}

func TestSharedStatics(t *testing.T) {
	store := &Statics{}
	a, b := &Session{Statics: store}, &Session{Statics: store}
	st := a.Static(testClassSlot).(*testClassStatics)
	st.count, st.ran = 42, true
	b.Static(testOtherSlot)
	if got := b.Static(testClassSlot).(*testClassStatics); got != st || got.count != 42 || !got.ran {
		t.Fatal("shared store lost attributes or constructor state")
	}
	private := (&Session{}).Static(testClassSlot).(*testClassStatics)
	if private == st || private.count != 7 || private.ran {
		t.Fatal("private store adopted shared state")
	}
}
