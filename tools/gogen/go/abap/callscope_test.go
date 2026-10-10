package abap

import "testing"

//go:noinline
func scopeLeaf(s *Session) { s.Sy.Index++ }

func BenchmarkCallScope(b *testing.B) {
	s := &Session{}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		func() { defer MessageCallScope(s, "LEAF", nil, -1).Restore(s); scopeLeaf(s) }()
	}
}

func TestMessageCallMaskAndUnwind(t *testing.T) {
	s := &Session{}
	defer MessageCallScope(s, "RECURSE", map[string]int32{"BOOM": 7}, -1).Restore(s)
	func() {
		defer MessageCallScope(s, "RECURSE", nil, -1).Restore(s)
		MessageRaise(s, "zz", "S", "7", "BOOM", "RECURSE", "nested")
	}()
	if s.Sy.Msgid != "ZZ" || s.Sy.Msgno != "007" || s.Sy.Msgv1 != "nested" {
		t.Fatal(s.Sy)
	}
	func() {
		defer Classic(s, "RECURSE", map[string]int32{"BOOM": 7}, -1)
		MessageRaise(s, "zz", "S", "7", "BOOM", "RECURSE")
		t.Fatal("outer mapping was not restored")
	}()
	if s.Sy.Subrc != 7 {
		t.Fatal(s.Sy.Subrc)
	}
	// Restore must also run when an unrelated class exception passes the call.
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("missing panic")
			}
		}()
		defer MessageCallScope(s, "OTHER", nil, -1).Restore(s)
		panic(ArithmeticError{Class: "CX_SY_ZERODIVIDE"})
	}()
	if s.messageCall.method != "RECURSE" {
		t.Fatal("panic lost caller mapping")
	}
}

func TestClassicImmediateCaller(t *testing.T) {
	s := &Session{}
	func() {
		defer func() {
			r := recover()
			if c, ok := r.(ClassicException); !ok || c.Method != "LEAF" {
				t.Fatalf("outer took nested RAISE: %v", r)
			}
		}()
		defer Classic(s, "MIDDLE", nil, 9)
		func() {
			defer MessageCallScope(s, "LEAF", nil, -1).Restore(s)
			panic(ClassicException{Name: "BOOM", Method: "LEAF"})
		}()
	}()
}

func TestMessageCallZeroAndSessions(t *testing.T) {
	a, b := &Session{}, &Session{}
	MessageRaise(a, "zz", "S", "1", "BOOM", "")
	defer MessageCallScope(a, "LEAF", nil, 0).Restore(a)
	MessageRaise(b, "zz", "S", "2", "BOOM", "LEAF")
	func() {
		defer Classic(a, "LEAF", nil, 0)
		MessageRaise(a, "zz", "S", "3", "BOOM", "LEAF")
		t.Fatal("assigned zero did not raise")
	}()
	if a.Sy.Subrc != 0 || b.Sy.Msgno != "002" {
		t.Fatal("session mappings interfered")
	}
}
