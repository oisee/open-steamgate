package abap

import (
	"cmp"
	"sort"
	"strings"
)

// Sorted secondary keys of standard tables (ultra/json; frontend
// secondaryKey). Measured on A4H 2026-09-24 (ZCL_GOGEN_T_SECKEY): the key's
// order is its components ascending, and rows with an equal key come newest
// first. The front end admits only tables whose rows are added at the end,
// so "newest" is the higher primary index. The order is computed where it is
// used, never cached, so a key changed in place is always seen.

// CmpS compares two character values as the other comparisons of this
// runtime do.
func CmpS(a, b string) int { return strings.Compare(a, b) }

// CmpNum compares two numbers.
func CmpNum[T int32 | int64 | float64](a, b T) int { return cmp.Compare(a, b) }

// KeyOrder is the primary indexes (from 0) of n rows in a secondary key's
// order. unique names a unique key: a value held twice is refused, since
// what a system does then is not measured.
func KeyOrder(n int, c func(a, b int) int, unique string) []int {
	ord := make([]int, n)
	for i := range ord {
		ord[i] = n - 1 - i
	}
	sort.SliceStable(ord, func(x, y int) bool { return c(ord[x], ord[y]) < 0 })
	if unique != "" {
		for i := 1; i < n; i++ {
			if c(ord[i-1], ord[i]) == 0 {
				panic(NotCompiled("secondary key "+unique, "a unique key holds a value twice"))
			}
		}
	}
	return ord
}

// KeyRead is READ TABLE ... WITH KEY k COMPONENTS over n rows: c(i) compares
// row i with the values. Found: the row (the newest of equal ones), its
// position in the key's order (from 1), sy-subrc 0. Not found: -1, the
// position the value would take, and sy-subrc 4, or 8 when that is past the
// last row.
func KeyRead(n int, c func(i int) int, unique string) (int, int32, int32) {
	less, pick, equal := 0, -1, 0
	for i := 0; i < n; i++ {
		switch r := c(i); {
		case r < 0:
			less++
		case r == 0:
			equal++
			if i > pick {
				pick = i
			}
		}
	}
	if unique != "" && equal > 1 {
		panic(NotCompiled("secondary key "+unique, "a unique key holds a value twice"))
	}
	if pick >= 0 {
		return pick, int32(less + 1), 0
	}
	if less == n {
		return -1, int32(less + 1), 8
	}
	return -1, int32(less + 1), 4
}

// UniqueKeyCheck refuses an APPEND that would repeat a unique secondary
// key's value: dup reports whether row i has the new row's value.
func UniqueKeyCheck(n int, dup func(i int) bool, key string) {
	for i := 0; i < n; i++ {
		if dup(i) {
			panic(NotCompiled("APPEND", "a row repeating the value of the unique secondary key "+key+" (not measured on A4H)"))
		}
	}
}
