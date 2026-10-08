package abap

import (
	"strings"
	"testing"
)

// Each operand occupies 64 bytes; the final ASCII byte completes the
// Hangul operand without slicing a UTF-8 character. This is the helper
// emitted for && and template joins.
func BenchmarkConcat(b *testing.B) {
	for _, tc := range []struct{ name, value string }{
		{"ASCII", strings.Repeat("a", 64)},
		{"Hangul", strings.Repeat("퀀", 21) + "x"},
	} {
		b.Run(tc.name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				benchUTF16String = Concat(tc.value, tc.value)
			}
		})
	}
}
