package abap

import (
	"math"
	"math/rand"
	"strconv"
	"testing"
)

// A packed literal changes the calculation type. Native final assignment
// must agree even with 31-significant-digit / and boundary rounding.
func TestInt8PackedAssignmentEquivalent(t *testing.T) {
	ops := []struct {
		native func(int64, int64) int64
		packed func(string, string) string
	}{
		{AddI8, AddP}, {SubI8, SubP}, {MulI8, MulP}, {DivI8, DivP}, {DivIntI8, DivIntP}, {ModI8, ModP},
	}
	check := func(a, b int64) {
		for i, op := range ops {
			native := catch(func() string { return strconv.FormatInt(op.native(a, b), 10) })
			packed := catch(func() string {
				return strconv.FormatInt(PToI8(op.packed(strconv.FormatInt(a, 10), strconv.FormatInt(b, 10)), true), 10)
			})
			if native != packed {
				t.Fatalf("op %d, %d/%d: native %s packed %s", i, a, b, native, packed)
			}
		}
	}
	edges := []int64{math.MinInt64, math.MinInt64 + 1, -4611686018427387904, -7, -1, 0, 1, 2, 3, 7, 4294967296, 4611686018427387904, math.MaxInt64}
	for _, a := range edges {
		for _, b := range edges {
			check(a, b)
		}
	}
	random := rand.New(rand.NewSource(2))
	for i := 0; i < 1000; i++ {
		check(int64(random.Uint64()), int64(random.Uint64()))
	}
}
