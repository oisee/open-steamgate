# nodeutf8

`Decode` reads a byte string as UTF-8 the way Node's `Buffer.toString()`
does (the WHATWG decoder): well-formed sequences pass through, and each
maximal subpart of an ill-formed one becomes a single U+FFFD.

The generated runtime uses it where open-abap-core decodes bytes in
`@KERNEL` lines with `Buffer.toString()` (`cl_http_utility=>decode_base64`),
so osgo answers what the Node host answers. It imports nothing of the
runtime; a cross-check against Node on 3000 random byte strings gave no
difference (2026-10-08).
