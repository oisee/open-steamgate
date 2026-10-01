package gzipx

import (
	"encoding/hex"
	"testing"
)

// Node's zlib.deflateRawSync / inflateRawSync (finishFlush Z_SYNC_FLUSH)
// on the same bytes, recorded 2026-09-24
func TestDeflateInflateRaw(t *testing.T) {
	text := "hello hello hello world, a longer text to compress here"
	node := unhex(t, "CB48CDC9C957C84022CBF38B72527414121572F2F3D2538B144A522B4A144AF21592F3730B8A528B8B1532528B5201")
	out, err := InflateRaw([]byte(node))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != text || len(out) != len(text) {
		t.Fatalf("zlib's stream: %q %d", out, len(out))
	}
	z, err := DeflateRaw([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	out, err = InflateRaw(z)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != text {
		t.Fatalf("round trip %q", out)
	}
	// zlib inflates Go's stream too (checked with Node): 11223344
	out, err = InflateRaw([]byte(unhex(t, "1254327601040000FFFF")))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != unhex(t, "11223344") {
		t.Fatalf("Go's 11223344: %X", out)
	}
	// cut short: what was decoded; trailing bytes: ignored; empty: empty
	cut := unhex(t, "CB48CDC9C957C84022CBF38B72527414121572F2F3D2538B144A522B4A144AF21592F3730B8A528B8B153252")
	out, err = InflateRaw([]byte(cut))
	if err != nil {
		t.Fatal(err)
	}
	if want := unhex(t, "68656C6C6F2068656C6C6F2068656C6C6F20776F726C642C2061206C6F6E676572207465787420746F20636F6D70726573732068"); string(out) != want {
		t.Fatalf("cut: %q, Node %q", out, want)
	}
	out, err = InflateRaw([]byte(node + "\xde\xad\xbe\xef"))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != text {
		t.Fatalf("trailing: %q", out)
	}
	out, err = InflateRaw(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Fatalf("empty: %q", out)
	}
	if _, err = InflateRaw([]byte("\xff\xff\xff\xff")); err == nil {
		t.Fatal("bad DEFLATE accepted")
	}
}

func unhex(t *testing.T, h string) string {
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
