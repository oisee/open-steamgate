package abap

import (
	"compress/gzip"
	"io"
	"strings"
)

// GunzipWithHeader is cl_abap_gzip=>decompress_binary_with_header, which
// open-abap-core writes as zlib.gunzipSync: every gzip member in turn;
// anything that is not gzip, a truncated stream or bytes after the last
// member are a zlib error there, not the method's CX_SY_COMPRESSION_ERROR,
// so a dump here.
func GunzipWithHeader(s *Session, in string, out *string) {
	z, err := gzip.NewReader(strings.NewReader(in))
	if err != nil {
		panic(HostError{Where: "CL_ABAP_GZIP=>DECOMPRESS_BINARY_WITH_HEADER", Text: "zlib: " + err.Error()})
	}
	b, err := io.ReadAll(z)
	if err != nil {
		panic(HostError{Where: "CL_ABAP_GZIP=>DECOMPRESS_BINARY_WITH_HEADER", Text: "zlib: " + err.Error()})
	}
	*out = string(b)
}
