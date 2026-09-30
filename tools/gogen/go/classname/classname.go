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
// An initial reference is a TypeError on Node; here CX_SY_REF_IS_INITIAL.
func Internal(s *abap.Session, obj any, out *string) {
	if obj == nil {
		panic(abap.ArithmeticError{Class: "CX_SY_REF_IS_INITIAL", Op: "CL_ABAP_CLASSDESCR=>GET_CLASS_NAME of an initial reference"})
	}
	if v := reflect.ValueOf(obj); v.Kind() == reflect.Pointer && v.IsNil() {
		panic(abap.ArithmeticError{Class: "CX_SY_REF_IS_INITIAL", Op: "CL_ABAP_CLASSDESCR=>GET_CLASS_NAME of an initial reference"})
	}
	n := abap.ClassOf(obj)
	if i := strings.LastIndex(n, ":"); i >= 0 {
		n = "CLAS-" + n[:i] + "-" + n[i+1:]
	}
	*out = n
}
