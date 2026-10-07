package abap

import (
	"math"
	"math/rand"
	"os"
	"strings"
	"sync"
	"testing"
	"unicode/utf16"
)

func TestUTF16LengthAndSections(t *testing.T) {
	for _, tc := range []struct {
		v string
		n int32
	}{{"", 0}, {"abc", 3}, {"Привет", 6}, {"漢字", 2}, {"😀", 2}, {"😀A", 3}, {"aЖ界😀𝄞z", 8}} {
		if got := Strlen(tc.v); got != tc.n {
			t.Fatalf("Strlen(%q)=%d, want %d", tc.v, got, tc.n)
		}
		units := utf16.Encode([]rune(tc.v))
		for a := 0; a <= len(units); a++ {
			for b := a; b <= len(units); b++ {
				got := SubS(tc.v, int32(a), int32(b-a))
				want := UTF16String(units[a:b])
				if got != want {
					t.Fatalf("%q [%d:%d] = %x, want %x", tc.v, a, b, got, want)
				}
				if Strlen(got) != int32(b-a) {
					t.Fatalf("length of section %x", got)
				}
			}
		}
	}
	if Numofchar("😀 A  ") != 4 {
		t.Fatal("numofchar")
	}
}

func TestUTF16SurrogateHalves(t *testing.T) {
	hi, lo := "\xed\xa0\xbd", "\xed\xb8\x80"
	if SubS("😀A", 0, 1) != hi || SubS("😀A", 1, 1) != lo || SubS("😀A", 1, -1) != lo+"A" {
		t.Fatal("halves lost")
	}
	if JoinUTF16(hi, lo) != "😀" || Strlen(hi+lo) != 2 {
		t.Fatal("pair roundtrip")
	}
	if got := EncodeText("utf16le", hi); got != "\x3d\xd8" {
		t.Fatalf("half encoding: %x", got)
	}
	if got := CFit("😀", 1); got != hi {
		t.Fatalf("field cut: %x", got)
	}
	if Find("😀A", lo, 0) != 1 || Find("😀A", "A", 1) != 2 {
		t.Fatal("find half/base")
	}
	if got := ShiftFn("😀A", true, "places", 1, ""); got != lo+"A" {
		t.Fatalf("shift: %x", got)
	}
	if got := ShiftFn("😀A", false, "circular", 1, ""); got != "A😀" {
		t.Fatalf("circular: %x", got)
	}
	if got := ShiftPlaces("😀A", true, false, 2, -1); got != "A" {
		t.Fatal(got)
	}
	if got := ShiftPlaces("😀A", false, false, 1, -1); got != " 😀A" {
		t.Fatalf("right: %x", got)
	}
}

func TestUTF16FindAndReplace(t *testing.T) {
	for _, rx := range []bool{false, true} {
		ok, off, n, _ := FindStmt("😀Ж😀A", "😀A", rx, false, 0)
		if !ok || off != 3 || n != 3 {
			t.Fatalf("find rx=%v: %v %d %d", rx, ok, off, n)
		}
	}
	ok, off, n, _ := FindSection("😀Ж😀A", "A", false, 4, 2, 0)
	if !ok || off != 5 || n != 1 {
		t.Fatalf("section find %v %d %d", ok, off, n)
	}
	for _, kind := range []byte{0, 'R', 'P'} {
		p := "😀"
		if kind != 0 {
			p = "(😀)"
		}
		res := FindResults("x😀A😀", p, kind, false, true)
		if len(res) != 2 || res[0][0] != 1 || res[0][1] != 2 || res[1][0] != 4 || res[1][1] != 2 {
			t.Fatalf("results %c: %v", kind, res)
		}
		if kind != 0 && (res[1][2] != 4 || res[1][3] != 2) {
			t.Fatalf("groups %v", res)
		}
	}
	got, rc := ReplaceStmt("😀A", "A", "B", false, false, false, 2, 1, -1)
	if got != "😀B" || rc != 0 {
		t.Fatalf("replace %q %d", got, rc)
	}
	got, rc = ReplaceStmt("😀A", "", "X", false, false, false, 1, 1, -1)
	if got != "\xed\xa0\xbdX\xed\xb8\x80A" || rc != 0 {
		t.Fatalf("replace inside pair: %x %d", got, rc)
	}
	if Pad("😀", 3, "LEFT", " ") != "😀 " || ToMixed("😀_A", "_", false, "", 2) != "😀A" {
		t.Fatal("UTF-16 widths")
	}
	if SubC("😀A", 4, 2, 2) != "A" || PadC("😀", 3) != "😀 " {
		t.Fatal("fixed field")
	}
}

func TestUTF16Bounds(t *testing.T) {
	for _, args := range [][2]int32{{-1, 1}, {4, 0}, {2, 2}, {1, math.MaxInt32}} {
		func() {
			defer func() {
				p := recover()
				e, ok := p.(ArithmeticError)
				if !ok || e.Class != "CX_SY_RANGE_OUT_OF_BOUNDS" {
					t.Errorf("%v: %v", args, p)
				}
			}()
			SubS("😀A", args[0], args[1])
		}()
	}
	if SubS("😀A", 3, 0) != "" || SubS("😀A", 3, -1) != "" {
		t.Fatal("end boundary")
	}
}

func TestUTF16MemoConcurrency(t *testing.T) {
	v := strings.Repeat("Ж😀界𝄞A", 300)
	units := utf16.Encode([]rune(v))
	var wg sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func(seed int64) {
			defer wg.Done()
			rnd := rand.New(rand.NewSource(seed))
			for i := 0; i < 1000; i++ {
				off := rnd.Intn(len(units))
				n := rnd.Intn(len(units) - off + 1)
				if got := SubS(v, int32(off), int32(n)); got != UTF16String(units[off:off+n]) {
					t.Errorf("offset %d length %d", off, n)
					return
				}
			}
		}(int64(worker))
	}
	wg.Wait()
}

var benchUTF16Int int32
var benchUTF16String string

// Manifest is scratch-only: one path per line, no corpus data in the patch.
func BenchmarkUTF16Corpus(b *testing.B) {
	manifest := os.Getenv("OSGO_UTF16_CORPUS")
	if manifest == "" {
		b.Skip("set OSGO_UTF16_CORPUS to a 200-file manifest")
	}
	paths, err := os.ReadFile(manifest)
	if err != nil {
		b.Fatal(err)
	}
	var values []string
	for _, p := range strings.Split(strings.TrimSpace(string(paths)), "\n") {
		v, e := os.ReadFile(p)
		if e != nil {
			b.Fatal(e)
		}
		values = append(values, string(v))
	}
	b.Run("Strlen", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			v := values[(i/32)%len(values)]
			benchUTF16Int = Strlen(v)
		}
	})
	b.Run("Section", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			v := values[(i/32)%len(values)]
			off := int32(len(v) / 4)
			benchUTF16String = SubS(v, off, 1)
		}
	})
}
