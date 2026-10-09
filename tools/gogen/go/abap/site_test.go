package abap

import "testing"

func TestSourceSite(t *testing.T) {
	stack := "goroutine 1 [running]:\nruntime/debug.Stack()\n\t/usr/lib/go/src/runtime/debug/stack.go:26 +0x5e\npanic({0x1, 0x2})\n\t/usr/lib/go/src/runtime/panic.go:791 +0x132\nosg/gogen/abap.Div(...)\n\t/x/go/abap/arith.go:10 +0x1\nmain.ZCL_A_RUN(0xc0)\n\t/tmp/b/zcl_a.clas.abap:17 +0x2a\nmain.ZCL_B_RUN(0xc0)\n\t/tmp/b/zcl_b.clas.abap:3 +0x2a\n"
	if got := SourceSite(&Rethrown{V: "x", Stack: stack}); got != "zcl_a.clas.abap:17" {
		t.Fatalf("rethrown: %q", got)
	}
	var got string
	func() {
		defer func() { recover(); got = SourceSite(nil) }()
		panic("boom")
	}()
	if got != "" {
		t.Fatalf("no ABAP frame: %q", got)
	}
}
