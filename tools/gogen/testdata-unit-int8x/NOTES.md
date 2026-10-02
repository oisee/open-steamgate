# Integer / byte conversion evidence

The `zcl_abapiti_int8x` class is the task's synthetic ABAPiti oracle:
six test methods passed on A4H 758. Its measured rows are -2 and
72623859790382856 to x8, both back, truncation to x4, and zero padding
to x16 for the positive pattern and -2. This fixture contains no SAP source.
The additional methods pin documentation-backed behavior; they have not
been measured on A4H.

SAP's [integer source rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCONVERSION_TYPE_IBS.html)
position the four/eight bytes right-aligned, truncate on the left and pad
with zero. The existing i conversion incorrectly sign-extended wide x.
SAP's [x source rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCONVERSION_TYPE_X.html)
explicitly use the last eight bytes for int8, zero-extend shorter sources,
and interpret the result as signed big-endian. The same applies to i with
four bytes. The [xstring source rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCONVERSION_TYPE_XSTRING.html)
use the x rules and explicitly give zero for an empty source. These cases
are clear, so they compile for arbitrary fixed lengths and xstring sources.

Integer to xstring is reachable in the frontend. Nonzero positive values
lose leading zero bytes; negative values retain four/eight bytes. The integer
source table also lists only 1, 2, 3, 4 or 8 bytes for int8, which leaves
five to seven significant bytes unclear. Zero is not described explicitly.
Those two cases refuse at runtime with NOT_COMPILED, before assignment.

## Next oracle rows

- int8 to xstring: 0, 4294967296 (five significant bytes),
  1099511627776 (six), 281474976710656 (seven); resolve exact lengths.
- i to xstring: 0; resolve the empty/one-byte ambiguity.
- Confirm documentation-backed extensions: FF and FFFF into int8;
  nine-byte 018000000000000000 into int8 (leading byte ignored);
  empty xstring into int8; -1/0/int8 min/max round trips;
  positive pattern into x2; i -2 into x8 (zero padding).

Go package tests cover widths 1 through 16 plus 32 and 1024, integer extrema,
short and long sources and both xstring refusals. The semantics fixture runs
through both emitters. The ABAP Unit fixture preserves the six oracle methods
and adds boundary, width, i and xstring cases.
