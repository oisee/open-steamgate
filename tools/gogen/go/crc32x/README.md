# crc32x

Pure CRC-32 register update used by the zip reader.

`Combine(crc, data)` accepts and returns a four-byte register.
The register is MSB-first and non-inverted.
The reflected IEEE polynomial is used for the update.
Repeated calls over chunks match one call over their concatenation.
No state survives a call.
The ABAP wrapper retains the session-first API.
