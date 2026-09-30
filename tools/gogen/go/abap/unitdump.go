package abap

import (
	"reflect"
	"strings"
)

// The value text of CL_ABAP_UNIT_ASSERT's messages. open-abap-core's local
// class LCL_DUMP writes it partly as @KERNEL JavaScript: the component names
// of a structure are Object.keys( ) of the runtime's structure object (the
// names in lower case, in their order), and an object is shown by its JS
// constructor's name (the class name in lower case, "/" as "$"). The
// front end maps both methods here (NATIVE in frontend.mjs), so a failed
// ASSERT_EQUALS of two structures, and every ASSERT_DIFFERS of structures
// or objects (it succeeds by catching ASSERT_EQUALS' failure), is not a
// NOT_COMPILED dump.

// UnitDumpToString is CL_ABAP_UNIT_ASSERT:LCL_DUMP=>TO_STRING.
func UnitDumpToString(s *Session, v Data) string {
	if v.P == nil {
		panic(notAssigned("LCL_DUMP=>TO_STRING"))
	}
	switch v.T.Kind {
	case 'u', 'v':
		return UnitDumpStructure(s, v)
	case 'h':
		return "[itab]"
	case 'r':
		obj := refTarget(v)
		if refNil(obj) {
			panic(ArithmeticError{"OBJECTS_OBJREF_NOT_ASSIGNED", "LCL_DUMP=>TO_STRING"})
		}
		return "[object, " + jsClassName(obj) + "]"
	case 'D', 'T':
		return textOf(v)
	case 'N':
		if *v.P.(*string) == "" {
			return strings.Repeat("0", v.T.Len)
		}
	}
	return FmtData(v)
}

// UnitDumpStructure is CL_ABAP_UNIT_ASSERT:LCL_DUMP=>DUMP_STRUCTURE:
// "name: value" per component, joined with ", ".
func UnitDumpStructure(s *Session, v Data) string {
	var b strings.Builder
	for i, c := range v.T.Comps {
		if i > 0 {
			b.WriteString(", ")
		}
		b.WriteString(strings.ToLower(c.Name))
		b.WriteString(": ")
		b.WriteString(UnitDumpToString(s, Data{P: c.Get(v.P), T: c.T}))
	}
	return b.String()
}

func refTarget(v Data) any {
	return derefAny(v.P)
}

// jsClassName is the name the transpiler gives a class in JavaScript
func jsClassName(obj any) string {
	if refNil(obj) {
		return ""
	}
	return jsName(ClassOf(obj))
}

// jsName: ZCL_X -> zcl_x, OWNER:LCL_X -> lcl_x, /NS/CL_X -> $ns$cl_x
func jsName(n string) string {
	if i := strings.LastIndex(n, ":"); i >= 0 {
		n = n[i+1:]
	}
	return strings.ReplaceAll(strings.ToLower(n), "/", "$")
}

// derefAny is what a pointer to a reference field holds
func derefAny(p any) any { return reflect.ValueOf(p).Elem().Interface() }
