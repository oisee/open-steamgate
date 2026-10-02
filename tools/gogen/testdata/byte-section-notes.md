# Byte section regression fixtures

`zcl_gogen_t_bytesection` and `zcl_gogen_t_bytemem` are derived from the
ABAPiti contract in TASK.md. They are not copies of the external repro classes:
those files are outside the permitted workspace and were unavailable here.
The r1-r6/f1-f5 labels identify contract cases, not verified original methods.
In particular, f2 expects byte offset 3 for AABB in AABBCCAABBCC, starting
at offset 1 with length 5; the original f2 expectation remains unverified.

The installed JS runtime ignores FIND sectionLength and matches hex digits,
so it cannot establish section bounds or whole-byte matching. Go follows the
TASK.md reference contract: out-of-range sections raise, and a miss leaves
MATCH OFFSET and MATCH LENGTH unchanged.

A direct JS REPLACE probe of AABBCCDD with 11 measured offset -1/length 1
raising without mutation; offset 2/length -1 produces AABB11BBCCDD with
sy-subrc 0. Offset 0/length -1 and offset 2/length -3 raise without mutation.
Go mirrors the JS splice boundary checks, including that overlap behavior.

The parser accepts omitted OFFSET or omitted LENGTH, but refuses a SECTION
with neither operand. The runtime supports both defaults; frontend acceptance
is limited by the installed ABAP parser grammar.

Run the derived fixtures with:

```sh
node tools/gogen/unit.mjs --fixture tools/gogen/testdata \
  --class ZCL_GOGEN_T_BYTESECTION --class ZCL_GOGEN_T_BYTEMEM --jobs 2
```

All 18 methods pass. The red proof changed MATCH OFFSET to section-relative:
f2 failed with expected 3, actual 2; the other 17 passed. The change was reverted.
