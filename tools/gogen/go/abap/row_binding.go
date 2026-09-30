package abap

import (
	"sync"
	"sync/atomic"
)

// A table version invalidates bindings when a delete or insert can change
// which logical row occupies a value-slice slot. The key is the table variable,
// so aliases through generic Data share the same version.
var tableVersions sync.Map
var boundRows sync.Map

func versionCell(table any) *atomic.Uint64 {
	if v, ok := tableVersions.Load(table); ok {
		return v.(*atomic.Uint64)
	}
	v, _ := tableVersions.LoadOrStore(table, new(atomic.Uint64))
	return v.(*atomic.Uint64)
}

func tableVersion(table any) uint64 {
	return versionCell(table).Load()
}

func BumpTable(table any) {
	if v, ok := tableVersions.Load(table); ok {
		v.(*atomic.Uint64).Add(1)
	}
}

func BindRow[T any](table *[]T, index int) *T {
	row := &(*table)[index]
	version := tableVersion(table)
	boundRows.Store(row, func() bool {
		return tableVersion(table) == version && index < len(*table) && &(*table)[index] == row
	})
	return row
}

func CheckedRowPtr[T any](row *T) *T {
	if row == nil {
		panic(ArithmeticError{"GETWA_NOT_ASSIGNED", "unassigned field symbol"})
	}
	if valid, ok := boundRows.Load(row); ok && !valid.(func() bool)() {
		panic(ArithmeticError{"GETWA_NOT_ASSIGNED", "table row binding after structural mutation"})
	}
	return row
}
