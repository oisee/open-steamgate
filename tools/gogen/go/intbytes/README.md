# Integer byte assignments

Pure conversions between ABAP `i`/`int8` and byte strings. Fixed `x(n)` is
right-aligned, truncated on the left or padded on the left with zero.
Byte sources use the last four/eight bytes, zero-extending short sources.
No dependency on the ABAP runtime.

The six A4H 758 ABAPiti rows and documentation-backed extensions are in
[`testdata-unit-int8x`](../../testdata-unit-int8x/NOTES.md). `ToString`
keeps one byte for zero and drops leading zeros for positive integers.
The supplied ABAPiti oracle confirms int8 lengths of five and six bytes,
despite the documentation table listing only 1-4 or 8; see the notes.
