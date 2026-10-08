package abap

import (
	"runtime"
	"strings"
	"sync"
	"testing"
)

func uncachedUTF16LE(v string) string {
	u := UTF16Units(v)
	b := make([]byte, 2*len(u))
	for i, c := range u {
		b[2*i], b[2*i+1] = byte(c), byte(c>>8)
	}
	return string(b)
}

func TestEncodeTextMemo(t *testing.T) {
	values := []string{"", "ASCII", "Привет世界", "😀A", "\xed\xa0\xbd", "\xed\xb8\x80", strings.Repeat("😀Привет", 100)}
	// Same pointer with different lengths, and equal content with independent
	// backing memory, must remain correct across hits and repeated eviction.
	long := strings.Repeat("abcdef😀", 100)
	values = append(values, long, long[:256], long[:257], strings.Clone(long))
	for round := 0; round < 10; round++ {
		for _, v := range values {
			want := uncachedUTF16LE(v)
			for _, encoding := range []string{"utf16le", "utf-16le"} {
				if got := EncodeText(encoding, v); got != want {
					t.Fatalf("%s %q: got %x, want %x", encoding, v, got, want)
				}
			}
			if got := EncodeText("utf8", v); got != v {
				t.Fatal("UTF-8 changed")
			}
		}
		runtime.GC()
	}
}

func TestEncodeTextMemoConcurrent(t *testing.T) {
	// More identities than slots exercise publication and eviction races.
	var wg sync.WaitGroup
	for worker := 0; worker < 12; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				v := strings.Repeat(string(rune('A'+worker))+"😀世界\xed\xa0\xbd", 32+i%8)
				want := uncachedUTF16LE(v)
				for n := 0; n < 3; n++ {
					if got := EncodeText("utf16le", v); got != want {
						t.Errorf("worker %d iteration %d: stale conversion", worker, i)
						return
					}
				}
			}
		}(worker)
	}
	wg.Wait()
}
