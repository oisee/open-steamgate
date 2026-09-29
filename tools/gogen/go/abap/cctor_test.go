package abap

import "testing"

// ultra/events (fix round): a class constructor that raised leaves its
// class not initialised (the next use runs it again) and reaches the caller
// as a CctorDump, which no CATCH takes; NOT_COMPILED goes on unchanged
func TestCctorGuard(t *testing.T) {
	done := false
	ensure := func(p any) (r any) {
		defer func() { r = recover() }()
		if done {
			return nil
		}
		done = true
		defer CctorGuard("ZCL_X", &done)
		panic(p)
	}
	r := ensure(ArithmeticError{"CX_SY_ZERODIVIDE", "/"})
	w, ok := r.(*Rethrown)
	if !ok {
		t.Fatalf("want a *Rethrown CctorDump, got %T %v", r, r)
	}
	d, ok := w.V.(CctorDump)
	if !ok || d.Error() != "RUNTIME_ERROR in ZCL_X=>CLASS_CONSTRUCTOR: CX_SY_ZERODIVIDE in /" || ClassBased(r) {
		t.Fatalf("got %v (class-based %v)", w.V, ClassBased(r))
	}
	if done {
		t.Fatal("the flag stays set after a failed class constructor")
	}
	nc := NotCompiled("ZCL_X=>CLASS_CONSTRUCTOR", "x")
	if r := ensure(nc); r != any(nc) || done {
		t.Fatalf("NOT_COMPILED changed: %v, flag %v", r, done)
	}
}
