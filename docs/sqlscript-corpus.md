# The AMDP corpus on A4H: what it is before it is counted

The other half of the SQLScript table (`docs/sqlscript-surface.md`, which is
the surface read off the book) is **frequency**: which constructs appear, how
often, and which never appear at all. This file is the step before that count,
and it exists because the count would otherwise have been confidently wrong.

## The warning that prompted it

fable-osd, reading the book, found that its whole chapter 9 is about BW
transformation routines written as AMDP -- start, end, expert and field
routines. Those are **generated**, so a corpus dominated by them would measure
a generator's habits and be read as "how people write SQLScript". A histogram
like that is worse than none: it is round, it is well distributed, and it
answers a question nobody asked.

So the corpus was classified before it was counted.

## What is actually there, measured 2026-09-18

195 classes implement `IF_AMDP_MARKER_HDB` on the A4H sandbox (`SEOMETAREL`
joined to `TADIR`). Three of them are ours.

| package | classes | what it is |
| --- | --- | --- |
| `SABAPDEMOS` (+ `SABAP_DEMOS_*`) | 31 | the demos of the ABAP documentation |
| `SABP_COMPILER_TEST` (+ `SABP_COMPILER`) | 23 | kernel compiler test fixtures |
| `S_INTSCN_LM_*`, `SHDB_HEMI`, `RS_ANA_UMM_*` | 33 | machine learning / predictive |
| `SABP_UNIT_DOUBLE_*_DEMO` | 7 | test-double demos for ABAP Unit |
| `SYCM_APS` | 8 | custom-code analysis |
| `SWF_FLEX_*`, `SWD`, `SWX`, `SWH` | 11 | workflow |
| everything else (48 packages) | ~79 | dictionary, CTS, security, MDG, search, ... |
| `$ZADT_VSP`, `$Z80_00`, `$ZADT_AMDP` | 3 | ours |

**`GENFLAG` is empty for all 195.** Nothing here is marked generated in
`TADIR`, and there is **not one BW transformation routine**: the four
BW-adjacent classes (`BW4_PREVIEW_TEST`, `BW4_PT_CHARTS`, `RS2HANA_AUTH`,
`RSROA_VAR`) are none of them a transformation routine, and this sandbox has
no BW content activated at all. So the warning does not materialise here.

## The bias that does exist, and it is the mirror image

About **60 of the 195 -- a third -- are demos and compiler test fixtures**
(`SABAPDEMOS`, `SABP_COMPILER_TEST`, the unit-double demos, the SQL chess
demo). They are written on purpose to cover the corners of the language:
client handling, session variables, ABAP types, calling AMDP from AMDP,
scalar functions, table functions on CDS.

That biases a histogram the **opposite** way from the one we were warned
about. Rare constructs will look common, because a teaching corpus is a
surface list with one occurrence each. Reading such a histogram as "how people
write SQLScript" would be exactly as wrong as reading a generated one, and it
would be wrong in the direction that flatters us: it would say we need to
support everything equally.

**So the count is two histograms and not one:**

- **the teaching corpus** -- demos, compiler tests, unit-double demos. This is
  close to a second surface list, arrived at independently of the book, and it
  is the right place to look for constructs the book does not mention.
- **the working corpus** -- the remaining ~135 classes, SAP standard code
  written to do a job. This is the one that answers "which ten constructs
  cover ninety percent of bodies".

Where the two agree, a construct is genuinely common. Where only the teaching
corpus has it, we have surface without frequency -- worth supporting, not
worth prioritising. Where only the working corpus has it, that is the most
interesting row in the table.

## Limits of this classification, stated rather than implied

- `GENFLAG` empty is not proof of "hand-written": generated objects are not
  always flagged. The absence of BW routines is the stronger evidence, and it
  is an absence in **this** sandbox, not in the world.
- One system, one release. A customer's system would have a different
  distribution, and almost certainly the BW routines this one lacks.
- SAP standard code is written by people who know the database. A customer
  corpus would likely be simpler and narrower, not wider.
- Nothing here is a count of constructs yet. This is only the answer to
  "what am I about to count?", which is the question that was missing.
