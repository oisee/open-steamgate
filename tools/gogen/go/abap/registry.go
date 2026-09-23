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
