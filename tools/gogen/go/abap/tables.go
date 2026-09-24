package abap

import (
	"sort"
	"strings"
	"sync"
)

// The table registry: every TABL and DDIC view the program knows, written by
// the build (frontend tableRegistry, emitted into zz_generated.go by
// emit-go), so that what a statement names only at run time -- CREATE DATA
// ... TYPE STANDARD TABLE OF (name), and later SELECT ... FROM (name) WHERE
// (cond) through the Open SQL condition parser -- can be resolved against
// the dictionary without the dictionary being in the binary.
//
// The same facts, as JSON, are the column registry of the dynamic WHERE
// parser (README, "The table registry"): one entry per table, its columns in
// DDIC order with the ABAP type kind, length and decimals, the key, the
// client flag and each column's type in the relational IR.

// Column is one column of a table or view.
type Column struct {
	Name string
	// Kind is the type kind, as cl_abap_typedescr=>typekind_* and Type.Kind:
	// C N D T I 8 F P g (string) y (xstring) X
	Kind byte
	// Len is the length in characters for C N X, in bytes for P (2*Len-1
	// digits); 0 for the kinds with a fixed or no length
	Len int
	Dec int
	Key bool
	// IR is the column's type in the relational IR (sqlscript-ir.mjs T):
	// {C,len} for C and N, {I}, {INT8}, {P,digits,dec}, {STRING}, {D},
	// {X,len}, {XSTRING}; nil for a kind the IR has no type for (T, F)
	IR *IRType
}

// Table is one table or view of the dictionary.
type Table struct {
	Name    string
	View    bool
	Client  bool     // it has a MANDT column: a SELECT reads the logon client's rows
	Key     []string // the primary key, MANDT included; empty for a view
	Columns []Column
	// Row and Rows are the descriptors of a row and of a STANDARD TABLE of
	// rows, the program's own Go types; nil when a column's type is outside
	// the subset, and Why says which
	Row  *Type
	Rows *Type
	Why  string
}

var (
	tablesMu sync.RWMutex
	tables   = map[string]*Table{}
)

// RegisterTables adds tables to the registry (the generated code does, at
// init); a later registration of a name replaces the earlier one.
func RegisterTables(ts ...*Table) {
	tablesMu.Lock()
	defer tablesMu.Unlock()
	for _, t := range ts {
		tables[strings.ToUpper(t.Name)] = t
	}
}

// TableByName finds a table or view by name, in any case, blanks around it
// ignored (A4H: CREATE DATA ... TYPE STANDARD TABLE OF ('t000') is T000).
func TableByName(name string) (*Table, bool) {
	tablesMu.RLock()
	defer tablesMu.RUnlock()
	t, ok := tables[strings.ToUpper(strings.TrimSpace(name))]
	return t, ok
}

// TableNames lists the registry, sorted.
func TableNames() []string {
	tablesMu.RLock()
	defer tablesMu.RUnlock()
	out := make([]string, 0, len(tables))
	for n := range tables {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

// Column finds a column by name, in any case.
func (t *Table) Column(name string) (*Column, bool) {
	n := strings.ToUpper(strings.TrimSpace(name))
	for i := range t.Columns {
		if t.Columns[i].Name == n {
			return &t.Columns[i], true
		}
	}
	return nil, false
}

// NewData is a new initial value of a type with a generated descriptor:
// the generic row factory (CREATE DATA through a descriptor).
func NewData(t *Type) Data {
	if t == nil || t.New == nil {
		panic(NotCompiled("CREATE DATA", "a type without a generated descriptor"))
	}
	return Data{P: t.New(), T: t}
}

func (t *Table) typeOf(table bool) *Type {
	if t.Row == nil {
		panic(NotCompiled("CREATE DATA TYPE "+t.Name, t.Why))
	}
	if table {
		return t.Rows
	}
	return t.Row
}

// NewRow is a new initial row of the table.
func (t *Table) NewRow() Data { return NewData(t.typeOf(false)) }

// NewTable is a new empty STANDARD TABLE of the table's rows.
func (t *Table) NewTable() Data { return NewData(t.typeOf(true)) }

// CreateDataByName is CREATE DATA ... TYPE (name) and, with table, TYPE
// STANDARD TABLE OF (name) for a table or view of the dictionary (A4H,
// ZCL_GOGEN_T_CRDYN: a new initial value each time, the name in any case,
// an unknown name CX_SY_CREATE_DATA_ERROR with the reference untouched).
// A name the dictionary knows as something else than a table is refused.
func CreateDataByName(name string, table bool) Data {
	if t, ok := TableByName(name); ok {
		return NewData(t.typeOf(table))
	}
	if ddicKnown(name) {
		panic(NotCompiled("CREATE DATA TYPE ("+strings.TrimSpace(name)+")", "a type of the dictionary that is not a table or view"))
	}
	panic(ArithmeticError{"CX_SY_CREATE_DATA_ERROR", "CREATE DATA TYPE (" + strings.TrimSpace(name) + ")"})
}

// ddicNames are the other names the program's dictionary has (data
// elements, table types, structures of classes): set by the generated code
var ddicNames = map[string]bool{}

// RegisterDDICNames records dictionary names that are not tables.
func RegisterDDICNames(names ...string) {
	tablesMu.Lock()
	defer tablesMu.Unlock()
	for _, n := range names {
		ddicNames[strings.ToUpper(n)] = true
	}
}

func ddicKnown(name string) bool {
	tablesMu.RLock()
	defer tablesMu.RUnlock()
	return ddicNames[strings.ToUpper(strings.TrimSpace(name))]
}
