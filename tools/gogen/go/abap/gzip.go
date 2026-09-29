package abap

import (
	"bytes"
	"compress/flate"
	"errors"
	"io"
)

// DeflateRaw is cl_abap_gzip=>compress_binary, which open-abap-core writes
// as zlib.deflateRawSync (Node): raw DEFLATE, RFC 1951, no header, at
// zlib's default level; COMPRESS_LEVEL is ignored there and here. The
// bytes are Go's compress/flate and not zlib's -- a different encoder,
// the same stream: what inflates back is the input, which is what
// cl_abap_zip and a zip reader need (for 11223344 zlib writes
// 135432760100, Go 1254327601040000FFFF: a sync marker before the final
// empty block). GZIP_OUT_LEN is xstrlen( gzip_out ), as the ABAP after the
// kernel line computes it.
func DeflateRaw(s *Session, in string, out *string, n *int32) {
	var b bytes.Buffer
	w, err := flate.NewWriter(&b, flate.DefaultCompression)
	if err == nil {
		_, err = w.Write([]byte(in))
	}
	if err == nil {
		err = w.Close()
	}
	if err != nil {
		panic(HostError{"CL_ABAP_GZIP=>COMPRESS_BINARY", "zlib: " + err.Error()})
	}
	*out = b.String()
	*n = int32(b.Len())
}

// InflateRaw is cl_abap_gzip=>decompress_binary, zlib.inflateRawSync with
// finishFlush Z_SYNC_FLUSH on Node, measured there (parity-wave2): a
// stream cut short gives what it decoded so far, bytes after the final
// block are ignored, an empty input is empty, and bytes that are not
// DEFLATE throw Z_DATA_ERROR, which the method does not catch: a dump.
// RAW_OUT_LEN is xstrlen( raw_out ).
func InflateRaw(s *Session, in string, out *string, n *int32) {
	r := flate.NewReader(bytes.NewReader([]byte(in)))
	b, err := io.ReadAll(r)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		panic(HostError{"CL_ABAP_GZIP=>DECOMPRESS_BINARY", "zlib: " + err.Error()})
	}
	*out = string(b)
	*n = int32(len(b))
}
