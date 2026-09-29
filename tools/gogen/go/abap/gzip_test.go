package abap

import (
	"encoding/hex"
	"strings"
	"testing"
)

func unhex(t *testing.T, h string) string {
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// Node's zlib.deflateRawSync / inflateRawSync (finishFlush Z_SYNC_FLUSH)
// on the same bytes, recorded 2026-09-24
func TestDeflateInflateRaw(t *testing.T) {
	text := "hello hello hello world, a longer text to compress here"
	node := unhex(t, "CB48CDC9C957C84022CBF38B72527414121572F2F3D2538B144A522B4A144AF21592F3730B8A528B8B1532528B5201")
	var out string
	var n int32
	InflateRaw(&Session{}, node, &out, &n)
	if out != text || n != int32(len(text)) {
		t.Fatalf("zlib's stream: %q %d", out, n)
	}
	var z string
	DeflateRaw(&Session{}, text, &z, &n)
	if n != int32(len(z)) {
		t.Fatalf("len %d of %d", n, len(z))
	}
	InflateRaw(&Session{}, z, &out, &n)
	if out != text {
		t.Fatalf("round trip %q", out)
	}
	// zlib inflates Go's stream too (checked with Node): 11223344
	InflateRaw(&Session{}, unhex(t, "1254327601040000FFFF"), &out, &n)
	if out != unhex(t, "11223344") {
		t.Fatalf("Go's 11223344: %X", out)
	}
	// cut short: what was decoded; trailing bytes: ignored; empty: empty
	cut := unhex(t, "CB48CDC9C957C84022CBF38B72527414121572F2F3D2538B144A522B4A144AF21592F3730B8A528B8B153252")
	InflateRaw(&Session{}, cut, &out, &n)
	if want := unhex(t, "68656C6C6F2068656C6C6F2068656C6C6F20776F726C642C2061206C6F6E676572207465787420746F20636F6D70726573732068"); out != want {
		t.Fatalf("cut: %q, Node %q", out, want)
	}
	InflateRaw(&Session{}, node+"\xde\xad\xbe\xef", &out, &n)
	if out != text {
		t.Fatalf("trailing: %q", out)
	}
	InflateRaw(&Session{}, "", &out, &n)
	if out != "" || n != 0 {
		t.Fatalf("empty: %q", out)
	}
	func() {
		defer func() {
			if e, ok := recover().(HostError); !ok || !strings.Contains(e.Text, "zlib") {
				t.Errorf("not DEFLATE: a dump, got %v", e)
			}
		}()
		InflateRaw(&Session{}, "\xff\xff\xff\xff", &out, &n)
	}()
}
