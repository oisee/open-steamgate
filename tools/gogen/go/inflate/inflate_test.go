package inflate

import (
	"bytes"
	"compress/flate"
	"math/rand"
	"testing"
)

// The host decoder against compress/flate: every level (stored blocks at 0,
// fixed and dynamic codes above), fed in pieces of several sizes, with and
// without an output budget, and the bytes after the end handed back.
func TestInflateHostMatchesFlate(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	words := []string{"<row>", "</row>", "<name>", "value", " ", "\n", "DJ-50", "0123456789"}
	var plain bytes.Buffer
	for plain.Len() < 300000 {
		if r.Intn(10) == 0 {
			plain.WriteByte(byte(r.Intn(256)))
		} else {
			plain.WriteString(words[r.Intn(len(words))])
		}
	}
	tail := []byte("PK\x01\x02 after the stream")
	for _, level := range []int{0, 1, 6, 9, flate.HuffmanOnly} {
		var comp bytes.Buffer
		w, _ := flate.NewWriter(&comp, level)
		w.Write(plain.Bytes())
		w.Close()
		data := append(comp.Bytes(), tail...)
		for _, piece := range []int{1, 7, 4096, len(data)} {
			for _, budget := range []int32{0, 1, 1000, 65536} {
				reg := &Registry{}
				h := reg.Open()
				var out []byte
				var state int32
				var raw, unused, reason string
				for at := 0; state != 2; {
					var chunk string
					if state != 1 {
						if at >= len(data) {
							t.Fatalf("level %d piece %d budget %d: stream not done", level, piece, budget)
						}
						end := min(at+piece, len(data))
						chunk = string(data[at:end])
						at = end
					}
					raw, state, unused, reason = reg.Feed(h, chunk, budget)
					if reason != "" {
						t.Fatalf("level %d piece %d budget %d: %s", level, piece, budget, reason)
					}
					if budget > 0 && len(raw) > int(budget)+258+65536 {
						t.Fatalf("budget %d: %d bytes in one feed", budget, len(raw))
					}
					out = append(out, raw...)
					if state == 2 {
						unused += string(data[at:])
					}
				}
				if !bytes.Equal(out, plain.Bytes()) {
					t.Fatalf("level %d piece %d budget %d: output differs", level, piece, budget)
				}
				if unused != string(tail) {
					t.Fatalf("level %d piece %d budget %d: unused %q", level, piece, budget, unused)
				}
			}
		}
	}
}

func TestInflateHostCorrupt(t *testing.T) {
	reg := &Registry{}
	h := reg.Open()
	// a final block of type 3
	raw, state, unused, reason := reg.Feed(h, "\x07", 0)
	if raw != "" || state != 0 || unused != "" {
		t.Fatalf("corrupt feed returned data: %q %d %q", raw, state, unused)
	}
	if reason != "invalid block type 3" {
		t.Fatalf("reason %q", reason)
	}
}
