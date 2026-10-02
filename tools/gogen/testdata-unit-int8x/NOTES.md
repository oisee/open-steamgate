# Integer / byte conversion evidence

The `zcl_abapiti_int8x` class is the task's synthetic ABAPiti oracle:
six test methods passed on A4H 758. Its measured rows are -2 and
72623859790382856 to x8, both back, truncation to x4, and zero padding
to x16 for the positive pattern and -2. This fixture contains no SAP source.
The additional methods pin supplied oracle expectations and documentation
extensions; none was measured on A4H in this task.

SAP's [integer source rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCONVERSION_TYPE_IBS.html)
position the four/eight bytes right-aligned, truncate on the left and pad
with zero. The preceding change corrected i sign extension into wide x.
SAP's [x source rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCONVERSION_TYPE_X.html)
explicitly use the last eight bytes for int8, zero-extend shorter sources,
and interpret the result as signed big-endian. The same applies to i with
four bytes. The [xstring source rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENCONVERSION_TYPE_XSTRING.html)
use the x rules and explicitly give zero for an empty source. These cases
are clear, so they compile for arbitrary fixed lengths and xstring sources.

## Supplied oracle and documentation conflict

The two additional ABAPiti oracle classes supplied locally have 33 methods.
Their expectations give int8 4294967296 -> `0100000000` (five bytes),
1099511627776 -> `010000000000` (six), and 1099511627775 -> `FFFFFFFFFF`
(five). They also pin i/int8 zero -> `00`, negative xstrings and numeric
byte comparisons. No SAP call was made in this task and their source stays
local; these are supplied oracle expectations, not new measurements here.

TASK.md's proposed 1-4-or-8-byte interpretation contradicts these oracle
rows: implementing it failed three of the 33 methods. To keep both supplied
oracle classes green, conversion follows the documented leading-zero removal
and the oracle expectations, allowing five to seven bytes for positive int8.
Zero retains the last byte, giving `00` rather than empty. Negative i/int8
retain their full four/eight-byte two's complement representation.
The integer source documentation's enumerated length list is therefore not
used to add padding to a positive int8 xstring.

## Documentation, unmeasured

The following extensions are implemented from documentation, not a supplied
oracle row. They are all **documentation, unmeasured**:

- Positive int8 needing seven bytes: drop leading zeros, following the same
  leading-zero rule confirmed by the supplied five/six-byte oracle rows.
- b/s conversion: widen to i first (the frontend's DDIC INT1/INT2 mapping).
  b gives one byte; positive s one or two, negative s four; zero gives `00`.
- [Comparison rules](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENLOGEXP_BYTE.html):
  convert x/xstring to i/int8 using the last four/eight bytes, zero-extending
  shorter values, interpreting the full width as signed, then comparing
  numerically in either operand order. Supplied rows cover selected equalities;
  reversed operands, ordering, short x1 against int8 and overlong x9 comparisons
  remain documentation, unmeasured. No integer is truncated to the x length.
- Previous documentation-backed extensions remain documentation, unmeasured:
  arbitrary fixed target widths (left truncation and zero padding), short/long
  byte sources, empty xstring to zero and round trips beyond the supplied rows.

## Next oracle rows

The exact requested rows and their supplied expectations are below. ABAPiti
should record provenance/system results for these; this task did not measure
on a SAP system. The five-byte result conflicts with TASK.md's proposed
8-byte expectation and must not be relabelled documentation, unmeasured.

| Source / comparison | Expected from supplied oracle |
| --- | --- |
| i 0 -> xstring | `00`, length 1 |
| int8 4294967296 -> xstring | `0100000000`, length 5 |
| int8 -1 -> xstring | `FFFFFFFFFFFFFFFF`, length 8 |
| i -1 -> xstring | `FFFFFFFF`, length 4 |
| x4 `FFFFFFFF` = i -1 | true |

Additional documentation, unmeasured rows to measure:
int8 281474976710656 -> `01000000000000`, length 7;
b 0/255 -> `00`/`FF`; s 0/32767/-32768 -> `00`/`7FFF`/`FFFF8000`;
x1 `FF` = int8 255 (true), = int8 511 (false), > int8 -1 (true);
x4 `FFFFFFFF` > int8 -1 (true), reversed equalities and ordering;
x9 `010000000000000000` = int8 0 (true).
Also confirm FF/FFFF into int8, nine-byte 018000000000000000 into int8,
empty xstring into int8, integer boundary round trips, positive pattern
into x2 and i -2 into x8 (zero padding).

Go package and JS tests cover widths 1-16 plus 32/1024, integer extrema,
short/long sources and xstring lengths. The semantics fixture exercises
all new rules through both emitters, including DDIC b/s inputs and comparisons
that distinguish numeric conversion from truncating the integer to x length.
The ABAP Unit fixture keeps the original six oracle methods and adds tests
for supplied expectations and documentation, unmeasured extensions.
