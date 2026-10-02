# Integer byte assignments

Pure conversions between ABAP `i`/`int8` and byte strings. Fixed `x(n)` is
right-aligned, truncated on the left or padded on the left with zero.
Byte sources use the last four/eight bytes, zero-extending short sources.
No dependency on the ABAP runtime; errors use `abaperr`.

The six A4H 758 ABAPiti rows and documentation-backed extensions are in
[`testdata-unit-int8x`](../../testdata-unit-int8x/NOTES.md). `ToString`
refuses zero and int8 values needing five to seven significant bytes until
an oracle resolves the documentation's length wording.
