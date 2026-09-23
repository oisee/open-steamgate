package abap

import "strings"

// A class CREATE OBJECT ... TYPE (name) can make: a typed nil to check the
// fit with, and a constructor without arguments.
type classEntry struct {
	zero any
	make func(*Session) any
}

// classes is filled by the generated program with every class it compiles.
var classes = map[string]classEntry{}

func RegisterClass(name string, zero any, make func(*Session) any) {
	classes[name] = classEntry{zero, make}
}

// CreateAs makes the class a name gives. The name is taken as written, trailing
// blanks aside: a lower-case name is an unknown class (A4H, 2026-09-23). As in the kernel, the fit is checked
// before the constructor runs: an unknown class is CX_SY_CREATE_OBJECT_ERROR,
// one that does not fit the target is CX_SY_MOVE_CAST_ERROR.
func CreateAs[T any](s *Session, name string) T {
	c, ok := classes[strings.TrimRight(name, " ")]
	if !ok {
		panic(ArithmeticError{"CX_SY_CREATE_OBJECT_ERROR", "CREATE OBJECT TYPE (" + name + ")"})
	}
	if _, fits := c.zero.(T); !fits {
		panic(ArithmeticError{"CX_SY_MOVE_CAST_ERROR", "CREATE OBJECT TYPE (" + name + ")"})
	}
	return c.make(s).(T)
}

// Up widens a class pointer into an interface. A nil pointer inside an
// interface is not a nil interface, and an unbound reference must stay
// initial after the move.
func Up[T any, P any](p *P) T {
	var z T
	if p == nil {
		return z
	}
	return any(p).(T)
}

// Cast is ?= and CAST: an initial reference casts to initial, anything else
// must fit the target or it is CX_SY_MOVE_CAST_ERROR.
func Cast[T any](v any) T {
	var z T
	if v == nil {
		return z
	}
	t, ok := v.(T)
	if !ok {
		panic(ArithmeticError{"CX_SY_MOVE_CAST_ERROR", "?="})
	}
	return t
}

// ClassicException is RAISE name: it ends the method that raised it, and
// only its caller's EXCEPTIONS list can take it. Method names the raiser, so
// a classic exception that passes a caller without the list is not taken by
// one further up: it goes on and ends the program, as RAISE_EXCEPTION does.
type ClassicException struct {
	Name   string
	Method string
}

func (c ClassicException) Error() string { return "RAISE_EXCEPTION " + c.Name + " in " + c.Method }

// Classic is deferred around a call with EXCEPTIONS: the exception named, or
// OTHERS, sets sy-subrc; anything else goes on.
func Classic(s *Session, method string, m map[string]int32, others int32) {
	r := recover()
	if r == nil {
		return
	}
	if c, ok := r.(ClassicException); ok && c.Method == method {
		if v, ok := m[c.Name]; ok {
			s.Sy.Subrc = v
			return
		}
		if others != 0 {
			s.Sy.Subrc = others
			return
		}
	}
	panic(r)
}
