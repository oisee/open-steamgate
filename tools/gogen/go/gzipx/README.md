# gzipx

Node-zlib-compatible raw DEFLATE helpers.

`DeflateRaw` compresses a byte slice without a wrapper header.
`InflateRaw` decodes a raw stream into bytes.
Both functions return an error for a failed operation.
Truncated input yields partial decoded output without an error.
Invalid DEFLATE data returns an error.
The session-first ABAP wrappers convert those errors to HostError.
