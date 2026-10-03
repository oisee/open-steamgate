`ZCL_GOGEN_T_SINGLEBYTES=>replace_fit` follows ABAPiti's oracle 009,
measured on A4H on 2026-10-02. The tracked `ZCL_GOGEN_T_REPL009` fixture
preserves all eight oracle cases and their ABAP Unit expectations; the
semantics runner executes the same cases on Go and IR-as-JS.
The fixture renames the class, adds a `run` entry point, and renders
`sy-subrc` with a template to isolate the measured byte contract from
the sign-blank discrepancy recorded in
`ANOMALY-2026-10-02-repl009-subrc-text`; all expected strings are unchanged.

The measurement confirms `12FF/2` after replacing offset 1, length 1
of fixed x(2) `1234` with x(2) `FFFF`: the replacement splices to
`12FFFF`, then fits the fixed target to `12FF` and sets `sy-subrc` to 2.
The xstring case retains `12FFFF` and reports 0. The oracle also covers
shorter replacements with zero padding, equal-length replacements,
appending at the fixed target's end, and a longer replacement at offset 0.
`replace_fit`'s omitted-length xstring operation uses the remaining
section; oracle case 5 measures the equivalent explicit length 1.

The single-byte fixture's signed integer moves remain expectations of
our byte-conversion contract, rather than part of the 009 measurement.
