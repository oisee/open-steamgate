package abap

import (
	"reflect"
	"sync"
)

// Raised is RAISE EXCEPTION of a class-based exception: the object itself
// and the name of its class. It travels as a Go panic like the runtime's
// own exceptions (ArithmeticError), which it does not replace: those carry
// no object and are taken by the CATCHes that name their class.
type Raised struct {
	Obj   any
	Class string
}

func (r *Raised) Error() string { return "UNCAUGHT_EXCEPTION " + r.Class }

var supers = map[string]string{}

// RegisterSupers is filled by the generated program: the superclass of every
// exception class it compiles, and of their ancestors.
func RegisterSupers(m map[string]string) {
	for k, v := range m {
		supers[k] = v
	}
}

// IsA: the class is ancestor or one of its subclasses.
func IsA(class, ancestor string) bool {
	for c, n := class, 0; c != "" && n < 40; c, n = supers[c], n+1 {
		if c == ancestor {
			return true
		}
	}
	return false
}

var (
	byTypeOnce sync.Once
	byType     map[reflect.Type]string
)

// ClassOf is the ABAP class of an object, by its Go type.
func ClassOf(obj any) string {
	byTypeOnce.Do(func() {
		byType = map[reflect.Type]string{}
		for n, c := range classes {
			byType[reflect.TypeOf(c.zero)] = n
		}
	})
	return byType[reflect.TypeOf(obj)]
}

// Raise makes the panic value of RAISE EXCEPTION. class is empty when only
// the object knows it (RAISE EXCEPTION obj). An initial reference is not
// raised: A4H aborts with "Access using a 'ZERO' object reference is not
// possible", which CATCH cx_root does not take (2026-09-23).
func Raise(obj any, class string) *Raised {
	if obj == nil || (reflect.ValueOf(obj).Kind() == reflect.Pointer && reflect.ValueOf(obj).IsNil()) {
		panic(ArithmeticError{"OBJECTS_OBJREF_NOT_ASSIGNED", "RAISE EXCEPTION of an initial reference"})
	}
	if class == "" {
		class = ClassOf(obj)
		if class == "" {
			panic(NotCompiled("RAISE EXCEPTION", "the class of the object is not registered"))
		}
	}
	return &Raised{Obj: obj, Class: class}
}

// AsRaised is the exception object inside a recovered value, unwrapped.
func AsRaised(r any) (*Raised, bool) {
	if w, ok := r.(*Rethrown); ok {
		r = w.V
	}
	x, ok := r.(*Raised)
	return x, ok
}

// ClassBased: a class-based exception (raised as an object or by the
// runtime), which passes a CLEANUP; not a dump (NOT_COMPILED, ASSERTION_FAILED,
// a classic exception).
func ClassBased(r any) bool {
	if _, ok := AsRaised(r); ok {
		return true
	}
	e, ok := AsError(r)
	return ok && len(e.Class) > 3 && e.Class[:3] == "CX_"
}

// Texter is an exception object whose get_text( ) is compiled.
type Texter interface {
	IF_MESSAGE__GET_TEXT(s *Session) string
}

// TextOf is get_text( ) of an exception caught INTO a variable that also
// takes runtime exceptions: a raised object's own get_text, else the class
// and the operation.
func (e *Exception) TextOf(s *Session) string {
	if e.Obj != nil {
		if t, ok := e.Obj.(Texter); ok {
			return t.IF_MESSAGE__GET_TEXT(s)
		}
		panic(NotCompiled(e.Class+"=>GET_TEXT", "get_text( ) of the class is not compiled"))
	}
	return e.Text()
}
