# Byte section regression fixtures

The original `zcl_abapiti_repro_bytes` and `zcl_abapiti_repro_mem` sources
are in `abapiti/`, copied unchanged from abapiti commit `0facf0e` except for
one provenance header per file. All 15 methods are green on A4H and osgo.
Their historical UNMEASURED comments are preserved; the added header and
`test/fixtures/kernel-oracle/expect.json` provide the measured provenance.
The recursive ABAP Unit runner discovers them in this subdirectory; they
have no static RUN entry for the top-level IR Go/JS semantics harness.

`zcl_gogen_t_byteoracle` encodes every P1/P2 oracle case as a separate ABAP
Unit method: 12 REPLACE cases and 12 FIND cases, with the complete expected
strings exactly as A4H answered. ALL OCCURRENCES with MATCH COUNT / RESULTS
is supported for a full byte field; section forms of ALL remain refused.
`zcl_gogen_t_bytesection` and `zcl_gogen_t_bytemem` retain the 18 derived
contract tests from the first pass. All five fixture classes pass: 57 methods.

```sh
flock /tmp/osd-heavy.lock env GOFLAGS=-buildvcs=false \
  node tools/gogen/unit.mjs --fixture tools/gogen/testdata --jobs 2
```

The red proof temporarily changed MATCH OFFSET to section-relative and ran
the original byte repro class: f2 failed with expected 3, actual 2; the other
10 methods passed. The change was reverted and all fixtures rerun green.

## JS REPLACE comparison (2026-10-02)

The unchanged `@abaplint/transpiler` / `@abaplint/runtime` 2.13.93 build was
checked with the actual JS-transpiled fixture methods, using:

```sh
flock /tmp/osd-heavy.lock node tools/gogen/byte-section-js-check.mjs
```

The runner deliberately exits 1 when it reports an oracle mismatch. It runs
all 12 P1 methods plus the original r1-r6: 17 SUCCESS, 1 FAILED.
The complete list of P1 discrepancies to fix in subsequent JS work is:

| Oracle case | A4H expected | JS actual |
| --- | --- | --- |
| P1 `x4 longer` (`p1_11`) | `00AABB22 rc2` | `00AABB22 rc0` |

JS gets the truncated bytes right but loses the truncation return code.
The other 11 P1 cases and all six original REPLACE repros pass, including
append, empty replacement, out-of-bounds exceptions and unchanged targets.
No JS runtime or IR-JS emitter was changed here.

The installed JS FIND runtime ignores sectionLength and searches hex digits;
that earlier observation remains outside this REPLACE comparison. Go uses
A4H's bounded whole-byte searches and absolute offsets.

A direct JS probe from the first pass of AABBCCDD with replacement 11 measured
offset -1/length 1 raising without mutation; offset 2/length -1 produces
AABB11BBCCDD with sy-subrc 0. Offset 0/length -1 and offset 2/length -3 raise
without mutation. Go rejects negative offset or length with CX_SY_RANGE_OUT_OF_BOUNDS before
assignment instead of copying the JS overlap bug. Negative REPLACE bounds
are not yet measured on A4H and are not claims about the A4H P1 oracle.

SECTION without either OFFSET or LENGTH is not a section selector in the
installed abaplint grammar. REPLACE's SECTION requires the permutation of
OFFSET/LENGTH to consume at least one operand. FIND offers SECTION OFFSET
or SECTION LENGTH; `FIND p IN SECTION OF xs` instead parses SECTION as a
subject variable with an OF option. These bare forms remain unsupported;
the frontend grammar regression test pins that distinction.

## Next oracle rows

- REPLACE with negative offset or length, including offset 2/length -1 of
  AABBCCDD with replacement 11: Go raises and leaves the target unchanged;
  this rule is not yet measured on A4H.
- ALL OCCURRENCES with an empty byte needle: refused as NOT_COMPILED until
  measured, matching the character RESULTS refusal.
- An empty needle in a section starting at the end of C3A3C3: Go currently
  returns rc0, MATCH OFFSET 3 and MATCH LENGTH 0; not measured on A4H.

The P2 ALL C3 probe read sy-subrc after its LOOP, so its rc0 records the
nonempty LOOP result. The fixture also checks FIND's rc0 before that LOOP.
The added fixed x LENGTH 2 needle repeats P2's A3C3 bounded hit using the
needle type used by the A4H probe.
