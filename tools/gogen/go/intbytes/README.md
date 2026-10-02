# Integer byte assignments

Pure conversions between ABAP `i`/`int8` and byte strings. Fixed `x(n)` is
right-aligned, truncated on the left or padded on the left with zero.
Byte sources use the last four/eight bytes, zero-extending short sources.
No dependency on the ABAP runtime.

The original six A4H 758 ABAPiti methods, 007 (17 cases), 008 (16 cases),
and documentation-backed extensions are in
[`testdata-unit-int8x`](../../testdata-unit-int8x/NOTES.md). `ToString`
keeps one byte for zero and drops leading zeros for positive integers.
The measured ABAPiti 007/008 oracle confirms minimal positive int8 lengths
without a leading 00, including five and six bytes,
despite the documentation table listing only 1-4 or 8; see the notes.
