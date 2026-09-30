package abap

import "testing"

// One million scalar LOOP ... ASSIGNING rows, binding and reading each slot.
func BenchmarkScalarLoopAssigningMillion(b *testing.B) {
	rows := make([]int32, 1_000_000)
	for i := range rows {
		rows[i] = int32(i)
	}
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		var sum int64
		for i := range rows {
			sum += int64(*CheckedRowPtr(BindRow(&rows, i)))
		}
		if sum != 499_999_500_000 {
			b.Fatal(sum)
		}
	}
}
