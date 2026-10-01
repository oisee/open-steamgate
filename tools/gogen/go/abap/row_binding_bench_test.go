package abap

import (
	"runtime"
	"testing"
)

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

func BenchmarkBumpTableHot(b *testing.B) {
	rows := []int{1}
	binding := BindRow(&rows, 0)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		BumpTable(&rows)
	}
	b.StopTimer()
	runtime.KeepAlive(binding)
}

func BenchmarkBumpTableNoBinding(b *testing.B) {
	rows := []int{1}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		BumpTable(&rows)
	}
	runtime.KeepAlive(&rows)
}
