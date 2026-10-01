package abap

// EncodeBase64 is cl_http_utility=>encode_base64: Buffer.from(text), its
// UTF-8 bytes, as base64 (open-abap-core's kernel lines; authenticate's
// Basic header). A system converts the text in its own code page first;
// not measured on A4H.
func EncodeBase64(s *Session, unencoded string) string {
	return EncodeXBase64(s, unencoded)
}
