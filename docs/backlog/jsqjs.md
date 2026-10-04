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
