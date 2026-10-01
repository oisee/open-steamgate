package abap

import "osg/gogen/gzipx"

// DeflateRaw exposes CL_ABAP_GZIP to the session-first host convention.
func DeflateRaw(s *Session, in string, out *string, n *int32) {
	b, err := gzipx.DeflateRaw([]byte(in))
	if err != nil {
		panic(HostError{Where: "CL_ABAP_GZIP=>COMPRESS_BINARY", Text: "zlib: " + err.Error()})
	}
	*out, *n = string(b), int32(len(b))
}

// InflateRaw preserves the host's error identity and output lengths.
func InflateRaw(s *Session, in string, out *string, n *int32) {
	b, err := gzipx.InflateRaw([]byte(in))
	if err != nil {
		panic(HostError{Where: "CL_ABAP_GZIP=>DECOMPRESS_BINARY", Text: "zlib: " + err.Error()})
	}
	*out, *n = string(b), int32(len(b))
}
