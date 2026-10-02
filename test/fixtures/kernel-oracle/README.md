# Kernel oracle: what A4H answers (2026-10-02)

The expected behaviour (EXPECT = A4H) for the points ABAPiti's generated code depends on.
These are the WASM/LLVM to ABAP compatibility items 1 to 7 that abapiti-7c raised; the owners
are stoker (1, 2) and dell (3 to 8).

- `probe.testclasses.abap.txt`: the probe, a local test class. It is kept as `.txt` so that
  neither the build nor abaplint picks it up from `test/`.
- `expect.json`: A4H's answer for each case, 127 cases in all. An exception appears as its
  class name, `rcN` is `sy-subrc`, and `oN`/`lN` are `MATCH OFFSET`/`MATCH LENGTH`.

abapiti's own repro classes (oisee/abapiti, branch `wip/m1-osd`, commit `0facf0e`,
`abap/osd_repro/`) ran on the same system on the same day: 26 of 26 green. Their expectations,
including the lines that had been marked UNMEASURED, are what the kernel does.

What the runtimes here should take from it (the answers, not a diagnosis of the code):
- **i overflow raises.** Arithmetic in `i` raises `CX_SY_ARITHMETIC_OVERFLOW`, and so do `min DIV -1`,
  `abs( min )` and `0 - min`. `min MOD -1` is 0. Assigning out of range from f, p, int8, c or string
  raises `CX_SY_CONVERSION_OVERFLOW`; rounding counts, so p `2147483647.5` overflows and
  `-2147483648.4` does not. A p target makes the calculation type p (`p = max + 1` gives
  2147483648), and a p operand with an i target overflows on the way back (`ARITHMETIC_OVERFLOW`).
  `i / 0` raises `CX_SY_ZERODIVIDE`, while `0 / 0` is 0. `/` rounds half away from zero.
- **x <-> i.**
  - `x(4)` to i is big-endian and signed.
  - `x(1)` and `x(2)` to i are unsigned (`FFFF` gives 65535).
  - `x(8)` to i takes the low 4 bytes.
  - i to a shorter x keeps the rightmost bytes and raises nothing (`x2 = 65536` gives `0000`,
    `x1 = 300` gives `2C`).
  - i to `x(8)` is zero-extended (`-1` gives `00000000FFFFFFFF`), while int8 to `x(8)` is
    two's complement.
  - xstring from i has no leading zero bytes (`256` gives `0100`, `-1` gives `FFFFFFFF`).
- **REPLACE SECTION ... IN BYTE MODE.** On an xstring the length follows the replacement. A section
  past the end raises `CX_SY_RANGE_OUT_OF_BOUNDS`, and offset = length appends. On a fixed `x(4)`
  a longer result is cut off with `sy-subrc` 2, and a shorter one is padded with `00`.
- **FIND ... IN BYTE MODE.**
  - Matches only at byte boundaries (`3C` in `C3A3C3`: rc 4).
  - LENGTH bounds the section.
  - A section past the end raises `CX_SY_RANGE_OUT_OF_BOUNDS`.
  - An empty needle matches at 0.
- **Packed.** Exact decimal arithmetic with commercial rounding into the field: `p2 = 0.125` gives
  0.13 and `-0.125` gives -0.13, while from f `2.675` gives 2.67. Overflow into a too-short p
  raises `ARITHMETIC_OVERFLOW` in arithmetic and `CONVERSION_OVERFLOW` on assignment.
  `0 / 0` is 0.
- **GENERATE SUBROUTINE POOL.** It works in ABAP Unit. A semantic error gives `sy-subrc` 4 with
  MESSAGE, LINE and WORD filled, and no exception. A syntax error gives `sy-subrc` 4 with WORD
  `SYS$$INCOMPLETE$$`.

## GENERATE SUBROUTINE POOL: where a pool lives (`subpool.json`)

Asked by dell for point 7, measured on A4H on 2026-10-02:
- **Not a repository object.** A pool is named like `%_T002QE` (`%_T` and 5 characters, counting
  up per generation) and has no row in TADIR, TRDIR or REPOSRC.
- **Its lifetime is the internal session.** It survives `COMMIT WORK` (`PERFORM` after it still
  answers 42). A second internal session (`SUBMIT ... AND RETURN`) does not find it:
  `PERFORM ... IN PROGRAM (name) IF FOUND` does nothing.
- **At most 36 pools per internal session.** The 37th `GENERATE` is a runtime error,
  `GENERATE_SUBPOOL_DIR_FULL`. It is not catchable and does not set `sy-subrc`.
