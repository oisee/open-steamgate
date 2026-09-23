package abap

import (
	"strings"
	"sync"
)

// Generic data: TYPE any, TYPE data, ANY TABLE and REF TO data.
//
// Typed code keeps its own Go types. A generic value is a Data: a pointer to
// the storage slot it stands for (the variable, the field, the row) and the
// descriptor of that slot's ABAP type. It is a binding, never a copy, so a
// write through a field symbol or a data reference reaches the original, and
// GET REFERENCE OF a local keeps the local alive (Go moves it to the heap).
//
// The descriptors of structures and tables are generated with the program:
// a component knows how to reach its field inside a struct, a table how many
// rows it has and where row i lives. Elementary ones are here.
type Type struct {
	Kind  byte // cl_abap_typedescr=>typekind_*: I 8 F g y C X D T u h l
	Len   int
	Comps []Comp
	Row   *Type
	Lines func(p any) int
	At    func(p any, i int) any
	// Copy moves a whole structure or table of this type (tables cloned);
	// Zero clears one. Generated with the descriptor.
	Copy func(dst, src any)
	Zero func(p any)
}

type Comp struct {
	Name string
	T    *Type
	Get  func(p any) any
}

// Data is a generic value, a field symbol TYPE any, or a data reference. P
// nil is an unassigned field symbol or an initial reference.
type Data struct {
	P any
	T *Type
}

var (
	TI       = &Type{Kind: 'I', Len: 4}
	TInt8    = &Type{Kind: '8', Len: 8}
	TF       = &Type{Kind: 'F', Len: 8}
	TString  = &Type{Kind: 'g'}
	TXString = &Type{Kind: 'y'}
	TD       = &Type{Kind: 'D', Len: 8}
	TT       = &Type{Kind: 'T', Len: 6}
	TRef     = &Type{Kind: 'l'}
)

var (
	sized   sync.Map
	sizedMu sync.Mutex
)

func sizedType(kind byte, n int) *Type {
	key := string(kind) + ":" + itoa(n)
	if t, ok := sized.Load(key); ok {
		return t.(*Type)
	}
	sizedMu.Lock()
	defer sizedMu.Unlock()
	t, _ := sized.LoadOrStore(key, &Type{Kind: kind, Len: n})
	return t.(*Type)
}

// TC and TX are c and x of a length.
func TC(n int) *Type { return sizedType('C', n) }
func TX(n int) *Type { return sizedType('X', n) }

// TN is n of a length, carried as its digits.
func TN(n int) *Type { return sizedType('N', n) }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for ; n > 0; n /= 10 {
		b = append([]byte{byte('0' + n%10)}, b...)
	}
	return string(b)
}

// Component is ASSIGN COMPONENT name OF STRUCTURE d: false (sy-subrc 4) when
// d is not a structure or has no component of that name.
func Component(d Data, name string) (Data, bool) {
	if d.P == nil || d.T == nil || (d.T.Kind != 'u' && d.T.Kind != 'v') {
		return Data{}, false
	}
	n := strings.ToUpper(strings.TrimRight(name, " "))
	for _, c := range d.T.Comps {
		if c.Name == n {
			return Data{P: c.Get(d.P), T: c.T}, true
		}
	}
	return Data{}, false
}

// Lines is lines( ) of a generic table.
func Lines(d Data) int {
	if d.P == nil || d.T == nil || d.T.Kind != 'h' {
		panic(NotCompiled("lines( )", "of a generic value that is not a table"))
	}
	return d.T.Lines(d.P)
}

// Row is row i (from 0) of a generic table, bound to the row itself.
func Row(d Data, i int) Data { return Data{P: d.T.At(d.P, i), T: d.T.Row} }

// DataString is a generic elementary value moved into a string.
func DataString(d Data) string {
	switch d.T.Kind {
	case 'g', 'C', 'D', 'T', 'N':
		return *d.P.(*string)
	case 'I':
		return IToString(*d.P.(*int32))
	}
	panic(NotCompiled("move", "a generic value of type kind "+string(d.T.Kind)+" into a string"))
}

// DataI is a generic value moved into an i.
func DataI(d Data) int32 {
	switch d.T.Kind {
	case 'I':
		return *d.P.(*int32)
	}
	panic(NotCompiled("move", "a generic value of type kind "+string(d.T.Kind)+" into an i"))
}

// FmtData is a generic value in a string template.
func FmtData(d Data) string {
	switch d.T.Kind {
	case 'I':
		return FmtI(*d.P.(*int32))
	case '8':
		return FmtI8(*d.P.(*int64))
	case 'F':
		return FmtF(*d.P.(*float64))
	case 'g', 'C', 'D', 'T', 'N':
		return *d.P.(*string)
	case 'X', 'y':
		return XToHex(*d.P.(*string))
	}
	panic(NotCompiled("string template", "a generic value of type kind "+string(d.T.Kind)))
}

// IsInitialData is IS INITIAL of a generic value.
func IsInitialData(d Data) bool {
	if d.P == nil {
		return true
	}
	switch d.T.Kind {
	case 'I':
		return *d.P.(*int32) == 0
	case '8':
		return *d.P.(*int64) == 0
	case 'F':
		return *d.P.(*float64) == 0
	case 'g', 'y', 'C':
		return *d.P.(*string) == ""
	case 'D':
		v := *d.P.(*string)
		return v == "" || v == "00000000"
	case 'T':
		v := *d.P.(*string)
		return v == "" || v == "000000"
	case 'N':
		return strings.Trim(*d.P.(*string), "0") == ""
	case 'X':
		return strings.Trim(*d.P.(*string), "\x00") == ""
	case 'P':
		v := strings.TrimLeft(strings.ReplaceAll(*d.P.(*string), ".", ""), "0-")
		return v == ""
	case 'h':
		return d.T.Lines(d.P) == 0
	case 'u', 'v':
		for _, c := range d.T.Comps {
			if !IsInitialData(Data{P: c.Get(d.P), T: c.T}) {
				return false
			}
		}
		return true
	case 'l':
		return d.P.(*Data).P == nil
	}
	panic(NotCompiled("IS INITIAL", "a generic value of type kind "+string(d.T.Kind)))
}

// Condense is CONDENSE: leading and trailing blanks go and every run of
// blanks inside becomes one; NO-GAPS removes every blank.
func Condense(s string, noGaps bool) string {
	if noGaps {
		return strings.ReplaceAll(s, " ", "")
	}
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool { return r == ' ' }), " ")
}

// TObj is an object reference inside a structure seen generically.
var TObj = &Type{Kind: 'r'}

// TP is p of a length and number of decimals. A p value is carried as its
// decimal text ("0" initial) and only copied until packed arithmetic exists.
func TP(n, dec int) *Type { return sizedType('P', n*100+dec) }

// InitialCh is IS INITIAL of a d, t or n value: "" (a structure field never
// set) or its typed zero.
func InitialCh(v, zero string) bool { return v == "" || v == zero }

// IsInitialOf is IS INITIAL of a typed value through its descriptor, for a
// structure whose initial value is not Go's zero value.
func IsInitialOf[T any](v T, t *Type) bool { return IsInitialData(Data{P: &v, T: t}) }
