package abap

import "osg/gogen/nodeutf8"

// EncodeBase64 is cl_http_utility=>encode_base64: Buffer.from(text), its
// UTF-8 bytes, as base64 (open-abap-core's kernel lines; authenticate's
// Basic header). A system converts the text in its own code page first;
// not measured on A4H.
func EncodeBase64(s *Session, unencoded string) string {
	return EncodeXBase64(s, unencoded)
}

// DecodeBase64 is cl_http_utility=>decode_base64: Buffer.from(encoded,
// "base64").toString() in open-abap-core's kernel lines: the bytes read as
// UTF-8 the way Node reads them (go/nodeutf8). Not measured on A4H, which
// converts from its own code page.
func DecodeBase64(s *Session, encoded string) string {
	return nodeutf8.Decode(DecodeXBase64(s, encoded))
}
