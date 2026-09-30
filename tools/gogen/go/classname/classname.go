// Package classname answers the one kernel line of
// CL_ABAP_CLASSDESCR=>GET_CLASS_NAME: the name the transpiler runtime gives
// the class of an object (constructor.INTERNAL_NAME). The ABAP around it
// (kernel_internal_name=>internal_to_rtti) makes the RTTI name from it.
package classname

import (
	"reflect"
	"strings"

	"osg/gogen/abap"
)

// Internal is a global class's name, CLAS-<pool>-<local> for a local class of
// a class pool, as on Node, so the RTTI name becomes \CLASS-POOL=<pool>\CLASS=<local>.
// An initial reference is a TypeError on Node and a dump on a system, so it
// is OBJECTS_OBJREF_NOT_ASSIGNED here, which CATCH cx_root does not take
// (as abap.Raise); a class the program does not register is not compiled.
func Internal(s *abap.Session, obj any, out *string) {
	if obj == nil || (reflect.ValueOf(obj).Kind() == reflect.Pointer && reflect.ValueOf(obj).IsNil()) {
		panic(abap.ArithmeticError{Class: "OBJECTS_OBJREF_NOT_ASSIGNED", Op: "CL_ABAP_CLASSDESCR=>GET_CLASS_NAME of an initial reference"})
	}
	n := abap.ClassOf(obj)
	if n == "" {
		panic(abap.NotCompiled("CL_ABAP_CLASSDESCR=>GET_CLASS_NAME", "the class of the object is not registered"))
	}
	if i := strings.LastIndex(n, ":"); i >= 0 {
		n = "CLAS-" + n[:i] + "-" + n[i+1:]
	}
	*out = n
}
