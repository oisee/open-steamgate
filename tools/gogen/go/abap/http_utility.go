package abap

import "strings"

// EncodeBase64 is cl_http_utility=>encode_base64: Buffer.from(text), its
// UTF-8 bytes, as base64 (open-abap-core's kernel lines; authenticate's
// Basic header). A system converts the text in its own code page first;
// not measured on A4H.
func EncodeBase64(s *Session, unencoded string) string {
	return EncodeXBase64(s, unencoded)
}

// DecodeBase64 is cl_http_utility=>decode_base64: Buffer.from(encoded,
// "base64").toString(), the decoded bytes read as UTF-8, an invalid byte
// becoming U+FFFD as in Node (open-abap-core's kernel lines). Not measured
// on A4H, which converts from its own code page.
func DecodeBase64(s *Session, encoded string) string {
	return strings.ToValidUTF8(DecodeXBase64(s, encoded), "\uFFFD")
}
