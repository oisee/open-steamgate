package abap

import (
	"strings"
	"sync"
)

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

// CALL METHOD (class)=>m: the classes the program compiled, the ones the
// registry has (so a class that exists but was not compiled dumps instead of
// reading as unknown), and adapters for the static methods dynamic calls name.
var (
	compiledClasses = map[string]bool{}
	registryClasses = map[string]bool{}
	statics         = map[string]staticEntry{}
)

type staticEntry struct {
	params map[string]bool
	call   func(*Session, map[string]Data)
}

func KnownClasses(compiled, known []string) {
	for _, c := range compiled {
		compiledClasses[c] = true
	}
	for _, c := range known {
		registryClasses[c] = true
	}
}

func RegisterStatic(name string, params []string, call func(*Session, map[string]Data)) {
	e := staticEntry{params: map[string]bool{}, call: call}
	for _, p := range params {
		e.params[p] = true
	}
	statics[name] = e
}

// CallStatic runs a static method named at run time. The class name is taken
// as written, as for CREATE OBJECT ... TYPE (name) (measured there).
func CallStatic(s *Session, class, method string, args map[string]Data) {
	c := strings.TrimRight(class, " ")
	if !compiledClasses[c] {
		if registryClasses[c] {
			panic(NotCompiled("CALL METHOD ("+c+")=>"+method, "the class exists but is not compiled in this program"))
		}
		panic(ArithmeticError{"CX_SY_DYN_CALL_ILLEGAL_CLASS", "CALL METHOD (" + c + ")=>" + method})
	}
	e, ok := statics[c+"=>"+method]
	if !ok {
		panic(ArithmeticError{"CX_SY_DYN_CALL_ILLEGAL_METHOD", "CALL METHOD (" + c + ")=>" + method})
	}
	for n := range args {
		if !e.params[n] {
			panic(ArithmeticError{"CX_SY_DYN_CALL_PARAM_NOT_FOUND", c + "=>" + method + " " + n})
		}
	}
	e.call(s, args)
}

// Local RFC destinations: CALL FUNCTION ... DESTINATION to one of these runs
// the module in this process ('NONE' on a Gateway). The transpiler runtime
// keeps them in abap.context.RFCDestinations; CALL FUNCTION is not compiled
// yet, so nothing reads this table so far.
var localDestinations sync.Map

func RegisterLocalDestination(s *Session, name string) {
	localDestinations.Store(strings.TrimRight(name, " "), true)
}
