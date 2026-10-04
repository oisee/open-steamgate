# Generated QuickJS on the JavaScript host

The wasm-generated QuickJS corpus contains 15 classes and 13 interfaces,
252K lines, and one test owner with nine tests. Its state class uses a
1,179,648-byte xstring as wasm linear memory. Small stores use `REPLACE
SECTION ... IN BYTE MODE`; loads use xstring slices.

## Which green result applies

The read-only [ABAPiti](https://github.com/oisee/abapiti) checkout examined was
`8cdf57212c23772baf6293cb3d8784181521c8e4`. Its `.github/workflows/osd-m1.yml`
uses three shards of a pinned OSD binary (`vscode-v0.6.1531`), started by
`.github/ci/osd-up.sh`. `.github/ci/osd-m1.sh` generates the M1 fixtures,
deploys interfaces, state, chunks and facades through ADT with vsp, and runs
each owner's tests through HTTP. It checks exact passed counts.

Those M1 fixtures are not this QuickJS corpus. The checkout's README calls
Lars Hvam's [zqjs](https://github.com/larshp/zqjs) a separate handwritten ABAP
engine and leaves the generated QuickJS OSG-JS result blank. The supplied
87/87 claim has no corresponding setup/result in the examined checkout.
It cannot be used as evidence that the generated 252K-line folder works.
Our folder runner builds all checkout layers in isolation, imports the
modules and runs the chosen test owners directly in Node.

## Cause and workaround

The runtime's xstring SECTION replacement slices and validates both sides,
concatenates them and validates the entire replacement value. Every tiny
store therefore costs O(memory size), rather than O(store size). The class
line count is a build cost; it does not explain the execution stall.

A synthetic benchmark of 1,000 four-byte stores measured:

| Buffer bytes | Original ms | Buffered ms |
|---:|---:|---:|
| 1,024 | 8 | 8 |
| 65,536 | 230 | 1 |
| 1,179,648 | 4,182 | 2 |

`tools/osd-xstring-buffer.mjs`, installed by the shared `test/setup.mjs`,
promotes xstrings of at least 64 KiB on an equal-width SECTION write.
It keeps a private byte buffer and materializes a hex snapshot only when
requested. Small slice reads and `xstrlen` avoid full materialization.
Clones and assignments preserve ABAP value semantics. Clear and full
assignment invalidate the buffer; size-changing writes, invalid ranges,
other offset types and other REPLACE forms fall back to upstream behavior.
No tests are skipped or capped to obtain a passing count.

This is a runtime performance defect, not a newly measured SAP semantic
divergence, so it belongs in this backlog rather than ANORMALIES.md.
An upstream draft is local and unsent at `.local/jsqjs-upstream.md`.

## Measured corpus result, 2026-10-04

Node v26.9.0, runtime/transpiler 2.13.93, private file-backed SQLite 3.53.4,
`NODE_OPTIONS=--max-old-space-size=12288`. Both corpus runs used CPU profiling.
The unchanged runtime completed `E0_ONE_PLUS_TWO` in 306.255 s, then was
stopped during `E1_SUM_LOOP` by the 900 s diagnostic deadline (forced exit
137 after the termination grace period). This was one completed passing
method, not a complete baseline suite. Its import took 3.562 s, transpile
195.349 s and module write 2.591 s. The missing class result was also hidden
by buffering the child stderr and waiting for all nine methods before JSON.

The patched run finished **9/9 SUCCESS, zero failures/errors/skips**, in
492.1 s including profiling/cleanup, at a sampled peak RSS of 8,972 MiB
for its own process tree (2 s samples; below the 14 GiB ceiling). The nine
methods took 42.599 s altogether. The first was 91.6 times faster.

| Phase | Seconds |
|---|---:|
| Stage input | 0.177 |
| Compatibility scan | 117.942 |
| Copy isolated checkout | 0.371 |
| Parse/discover input tests | 118.187 |
| Build including transpile/write | 205.925 |
| Transpile (part of build) | 196.604 |
| Write modules (part of build) | 2.569 |
| Import modules including first database setup | 3.433 |
| First database setup (part of import) | 0.679 |
| Existing second initialization/database setup | 0.156 |
| Load test class / class setup | 0.001 / 0.000 |
| Run all methods including per-method setup/teardown | 42.599 |

Scanning and compilation still dominate the total; this change addresses
execution. Individual results:

| Method | Status | Seconds |
|---|---|---:|
| E0_ONE_PLUS_TWO | SUCCESS | 3.345 |
| E1_SUM_LOOP | SUCCESS | 7.994 |
| E2_SORT | SUCCESS | 2.191 |
| E3_JSON | SUCCESS | 1.993 |
| E4_FIB | SUCCESS | 19.923 |
| E5_STRING | SUCCESS | 2.132 |
| E6_MATH | SUCCESS | 2.862 |
| E7_MAP_REGEXP | SUCCESS | 2.121 |
| P_PRINTF | SUCCESS | 0.038 |

A separate 4.534 s CPU profile of the synthetic baseline attributed 4.109 s
(90.6%) of sampled self time to `RegExp: ^[0-9A-F]*`, plus 0.289 s to
`XString.set`; GC was 0.061 s. That identifies repeated hex validation,
not a GC death spiral, as the hot path. The patched corpus profile instead
spends time in generated arithmetic/dispatch, including the Fibonacci case.

## Reproduction and verification

Set `OSGJS_TRACE=1` on `osgjs:unit` to stream phase events, elapsed times,
RSS and heap use to stderr while keeping JSON on stdout. Result rows carry
per-test `ms`; `timingMs` records phases. Trace covers staging, compatibility
scan, checkout, parser, build, transpile, module writing, import, database
setup, test-class import and each method including setup/teardown.

The cheap `test/xstring-buffer.mjs` exercises snapshot and overlap semantics,
boundaries, size-changing fallback, ordinary replacement, range errors and
multiple runtime instances. Its benchmark regression forbids whole-buffer
reads during 1,000 stores, slices and length queries; it has no flaky time
threshold and needs no corpus. `test/osgjs-unit.mjs` checks the actual folder
runner's per-test and phase timing fields.

Run heavy checks with `OSD_HEAVY_RANGE=50-59 tools/osd-heavy.sh timeout ...`.
Local diagnostic logs/profiles stay under `.local/jsqjs/`; a watchdog stops
only the run's own descendants above 14 GiB or a phase deadline.

## Round 2: backing-field correctness and isolated comparisons

Promoted instances retain an enumerable `value` property with a getter that
materializes current buffered bytes. Its setter invalidates the buffer, so
native assignments and direct field writes cannot leave an old buffer active.
JSON serialization, structured clone, native clone, and direct `.value` reads
all observe buffered writes immediately. The hot-path regression forbids both
`get()` and backing-field reads during small stores, slices and length queries.

The native and buffered differential variants now run in separate processes.
Each child verifies that its runtime prototype starts unpatched. They transpile
and execute identical ABAP covering value/reference parameters, assignment,
APPEND/MODIFY/READ INTO/SORT, CONCATENATE/FIND/REPLACE IN BYTE MODE, string and
fixed-hex conversions, range failures, the real `cl_abap_conv_in_ce` and
`cl_abap_conv_out_ce` classes, and a RAWSTRING table INSERT/SELECT through the
runtime's binding path and the real SQLite client. Known expected outputs are
asserted as well as compared.

SECTION write acceleration now requires runtime `Integer` operands. `Integer8`
and mixed SECTION operands retain native exceptions. No evidence establishing
SAP legality for int8 SECTION operands was found in ANORMALIES.md or the
supplied ABAPiti checkout; that checkout contains no inbox in this snapshot.
This fix makes no new SAP semantic claim.

The synthetic benchmark still takes 7 / 1 / 2 ms for 1,000 writes at
1,024 / 65,536 / 1,179,648 bytes, versus 7 / 222 / 4,099 ms natively.

The corrected QuickJS run passed **9/9 SUCCESS, zero failures/errors/skips**
in 474.1 s overall, with 41.595 s in methods and sampled peak process-tree RSS
of 9,327 MiB (2 s samples). The same Node/runtime/database/heap settings as the
first run were used, without CPU profiling. Method results:

| Method | Status | Seconds |
|---|---|---:|
| E0_ONE_PLUS_TWO | SUCCESS | 3.352 |
| E1_SUM_LOOP | SUCCESS | 7.743 |
| E2_SORT | SUCCESS | 2.167 |
| E3_JSON | SUCCESS | 1.926 |
| E4_FIB | SUCCESS | 19.376 |
| E5_STRING | SUCCESS | 1.867 |
| E6_MATH | SUCCESS | 2.920 |
| E7_MAP_REGEXP | SUCCESS | 2.210 |
| P_PRINTF | SUCCESS | 0.034 |

The targeted xstring and folder-runner suites pass **13/13** (74 s overall).
The suites registry check passes. The branch-aware size guard (`--changed
origin/main`) passes and reports five inherited breaches; the whole-tree guard
still reports those breaches in unrelated paths. No budgets were raised.

## Round 3: CI setup and result-comparison regressions

The xstring installer now returns before changing any prototype when the host
lacks `types.XString`, `statements` or `builtin`. Database-only setup doubles
need none of those runtime operations. The five DuckDB migration and pack-seed
failures reproduced locally before the guard; real-runtime differential and
buffer hot-path checks remain enabled.

The kernel scanner CI failure compared independent method timings as part of
row equality: the same successful test took 2 ms in one run and 1 ms in another.
Two local runs of the original comparison passed when the rounded timings
coincided; the CI log supplies the failing 2-versus-1-ms comparison.
The subprocess comparison now validates each JS timing as a nonnegative integer
and compares every other row field, totals, warnings and exit codes. An added
direct regression verifies complete row preservation, including the recorded
milliseconds, for a scanner error in ordinary and strict modes.

The warm-xref missing-superclass error also reproduces on unchanged
`origin/main` at `e07b7e8f`: running `adt-xref-warm.mjs` together with
`shadowed-objects.mjs` gives 15 passing tests and one failed setup hook.
The latter suite's module-load `compileAll("src", "gen/stg")` sweeps generated
pack projects from the checkout. Warm-xref now carries its webapp assets and
runs the generators in its own copied tree before the cold baseline, so it
does not depend on the checkout's remaining generated pack classes.

With CI's exact transpiler/runtime pin `e34d6a1f`, the installer rerun passes
**9/9 QuickJS tests, zero failures/errors/skips** in **476.1 s overall**,
**41.506 s in methods**, at **8,899 MiB sampled peak process-tree RSS**.
Kernel scanning took 118.590 s, input parsing 116.124 s, transpiling 184.589 s,
module writing 2.507 s, importing 2.792 s and database setup 0.932 s.
Node's heap limit remains 12,288 MiB and the database is `--db file`.

| Method | Status | Seconds |
|---|---|---:|
| E0_ONE_PLUS_TWO | SUCCESS | 3.097 |
| E1_SUM_LOOP | SUCCESS | 7.622 |
| E2_SORT | SUCCESS | 2.084 |
| E3_JSON | SUCCESS | 1.937 |
| E4_FIB | SUCCESS | 20.114 |
| E5_STRING | SUCCESS | 1.745 |
| E6_MATH | SUCCESS | 2.819 |
| E7_MAP_REGEXP | SUCCESS | 2.053 |
| P_PRINTF | SUCCESS | 0.035 |

Validation covers **78 distinct focused tests**: 15 database migration,
10 seeding, 7 xstring, 4 warm-xref, 15 shadowed-object, 20 kernel compatibility
and 7 folder-runner cases. All 71 cases in the first six suites passed in the
combined run. Its additional folder-runner cleanup hook observed the concurrent
QuickJS staging directory; after QuickJS exited, the complete folder-runner
suite passed 7/7 in isolation (77.31 s), with the cleanup assertion unchanged.
The suites registry check passes (289 ordinary and 7 grouped suites), as does
the branch-aware size guard; its five inherited breaches remain unchanged.
