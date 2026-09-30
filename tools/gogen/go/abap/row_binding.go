package abap

import (
	"reflect"
	"runtime"
	"sync"
	"sync/atomic"
	"weak"
)

// Weak keys let a table header and its version cell die together. No map value
// retains the table. A binding retains its own table while it is in scope.
var tableVersions sync.Map // weak.Pointer[byte] -> *atomic.Uint64

func versionCell(table any) *atomic.Uint64 {
	ptr := (*byte)(reflect.ValueOf(table).UnsafePointer())
	key := weak.Make(ptr)
	if v, ok := tableVersions.Load(key); ok {
		return v.(*atomic.Uint64)
	}
	v, loaded := tableVersions.LoadOrStore(key, new(atomic.Uint64))
	if !loaded {
		runtime.AddCleanup(ptr, func(k weak.Pointer[byte]) { tableVersions.Delete(k) }, key)
	}
	return v.(*atomic.Uint64)
}

func tableVersion(table any) uint64 { return versionCell(table).Load() }

func BumpTable(table any) {
	if v, ok := tableVersions.Load(weak.Make((*byte)(reflect.ValueOf(table).UnsafePointer()))); ok {
		v.(*atomic.Uint64).Add(1)
	}
}

// RowBinding owns its validation token; binding another symbol to the same
// slice slot cannot change this one. Access needs no global map lookup.
type RowBinding[T any] struct {
	row     *T
	table   *[]T
	version *atomic.Uint64
	at      uint64
	index   int
}

func BindRow[T any](table *[]T, index int) *RowBinding[T] {
	cell := versionCell(table)
	return &RowBinding[T]{row: &(*table)[index], table: table, version: cell, at: cell.Load(), index: index}
}

func DirectBinding[T any](row *T) *RowBinding[T] { return &RowBinding[T]{row: row} }

func CheckedRowPtr[T any](b *RowBinding[T]) *T {
	if b == nil || b.row == nil {
		panic(ArithmeticError{"GETWA_NOT_ASSIGNED", "unassigned field symbol"})
	}
	if b.table != nil && (b.version.Load() != b.at || b.index >= len(*b.table) || &(*b.table)[b.index] != b.row) {
		panic(ArithmeticError{"GETWA_NOT_ASSIGNED", "table row binding after structural mutation"})
	}
	return b.row
}
