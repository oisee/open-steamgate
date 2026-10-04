# Isolation detector run record

## Generated-output invariant, working tree over 9bd399d8 (2026-10-04)

The new `gen` invariant observes sorted relative paths, size and `mtimeMs`
before/after both file imports and execution. Only differing files still
present receive content hashes. Removed files are named from baseline metadata.
A metadata rewrite remains a change even when bytes are identical. No detector
path restores output; this check is separate from the tree hash excluding `gen/`.

The deletion regression was run before changing the hook: its inner three
files all passed, so the parent assertion failed (one pass, one failure).
With the invariant, the deleting file goes red naming
`gen/pack/probe.clas.abap`, the file stays deleted and unchanged neighbors pass.
Final focused detector/runner validation: **118 passing, exit 0**. Cases cover
import-time sweeps in unselected files, added/same-size changed outputs, no
reads of unchanged contents, bounded allowances and unallowable hash errors.

A hooked scan ran `shadowed-objects`, `stg-compile`, `osd-packs`, `osd-bsp`,
`segw` and `generation-hash`: **86 passing, one invariant failure**.
`test/shadowed-objects.mjs` calls `compileAll("src", "gen/stg")` during import,
omitting generated CDS and pack models. It removed **50 files** under four CDS
service folders plus `zvdb_100`, and rewrote **74 files** under nine retained
service folders. Its removed `zcl_zvdb_100_dpc.clas.abap` is the superclass
of the pack's hand-written DPC_EXT, needed by the old xref fixture.
[PR #575's final commit](https://github.com/oisee/open-steamgate/pull/575)
describes regenerating that fixture independently of swept pack outputs.
Other scanned files inherited the state and were not blamed. The allowance
bounds each of the 14 service prefixes by its observed file count and links
to [the stoker repair](backlog/misc.md#isolation-shadowed-objects-gen).
An external transpile restored `gen/` before the ADT run.

A standalone metadata benchmark on the real generated tree used 10 warm-ups
and 101 timed snapshots: **582 files, 3.721 ms median per boundary**.
Run accounting includes import observations and comparisons as well as
execution snapshots; it measures added observation work, not an estimated
causal change in total suite wall time.

The first ADT mode-0 fragment run checked 48 files: **2,311 passing, one
generation hook failure**, with no `gen` violation. Shard 1 was started
before the final ADT cases finished; its `cds-check` fixture temporarily
edited checkout sources during `osd-adt-fork`'s generation snapshot. That
overlap invalidates the run as an isolation validation and is retained as
`adt-overlap.log`, with no allowance added. Its `gen` accounting was
192 manifest boundaries, 748.591 ms manifest time, 3.751 ms median per
boundary, 27.118 ms comparison/hash time, **775.710 ms added observation**.

Required shard 1 via `node tools/osd-suites.mjs --shard 1/4`: **1,974
passing, 27 pending, exit 0**, 71 files checked. Reporter completion is true,
with zero failures and zero internal retries; the retry report is empty.
No new `gen` leak was observed. Its manifest total was 1,107.694 ms over
284 boundaries, median 3.807 ms/boundary, plus 39.143 ms comparison/hash
time: **1,146.837 ms total added `gen` observation**.

After shard 1 finished, an external transpile established the baseline and
the complete sorted ADT fragment ran sequentially with
`OSD_ADT_ONE_RUNTIME=0` and `--require ./tools/osd-test-isolation.cjs`:
**2,311 passing, zero failures, exit 0**, 48 files, 441.078 s wall time.
Its 192 manifest boundaries cost **744.029 ms**, median **3.826 ms/boundary**;
comparison/hash cost **26.835 ms**, for **770.865 ms total added `gen`
observation work**. There were no `gen` violations or new ADT allowances.

The six-file originating-sweep scan was repeated with the bounded exception:
**86 passing, zero failures, exit 0**. It still printed all 124 `gen` changes
and the `stoker` ownership/backlog evidence as `TEMPORARY ALLOW`. Only
`shadowed-objects` was named; other files remained unblamed. An external
transpile after the scan restored generated outputs. Final suite registration,
changed-file leak scan (seven files, zero matches) and `git diff --check` pass.

Every heavy command used `OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4`
and `tools/osd-heavy.sh`; the build ran first. Local evidence is retained
under `.local/gen-invariant/` (ignored): red/green logs, originating sweep scan,
ADT/shard logs and manifest benchmark output. HEAD and branch are unchanged;
no commit or Git metadata write was made.

## Fix round 2, working tree over 822da6d7 (2026-10-04)

The warm proof fixture now generates its UUID with `randomUUID()`, matching
the real fixture and the existing restrictive allowance. Each of its seven
variants verifies the edited source and activated link. Extra-input and
active-copy mutations verify their bytes; the fresh-live case verifies its
new target. Parent assertions require a reached-mutation marker. Cases that
mutate after the proof also require a passing body followed by a failing
generation invariant. The three added-input variants similarly verify the
sidecar/config mutation and body completion. An early proof rejection can no
longer make a later-mutation case pass.

The initial focused run had 98 passing tests and one outer generation hook
failure. Its first-file entry and exit both recorded live `cabd92f40e45988d`
and tree `975161d8e16d54e4`: the mismatch existed before the synthetic cases
ran, and neither hash changed during them. An explicit external
`npm run transpile` restored live to the tree hash; the same focused command
then passed all 98 tests. The detector was unchanged. A new regression
requires an unchanged, already stale generation at the first file boundary
to stay red, with its body passing and identical entry/exit evidence. Hand-run
instructions now include the external baseline build.

Worker comparison controls use complete Git archives of `origin/main`
(`e07b7e8f`) and branch HEAD (`822da6d7`) under `.local/fix-round2/`, with
identical existing node_modules, pinned libraries, linked transpiler and
fetched pack sources. Their generated trees and databases are separate. A
single heavy-wrapper invocation holds instance 91 for all six plain-Mocha
runs, alternating main and branch three times each. Each run has fresh
extension storage; an explicit build establishes its tree baseline. The
results were:

| Alternating round | Main | Branch |
| --- | --- | --- |
| 1 | exit 1, 43.746 s | exit 1, 48.277 s |
| 2 | exit 0, 96.761 s | exit 0, 99.541 s |
| 3 | exit 0, 99.023 s | exit 1, 44.589 s |

All failures occur at the initial `SUBMITTED` assertion. This reproduces the
standalone failure on main, without the isolation detector or branch production modules.
The locking failure is pre-existing and timing dependent; the critic's
passing relocated original fixture alone could not establish attribution.

Evidence and executable controls are retained under `.local/fix-round2/`:
`focused-before.log`, `rebaseline.log`, `focused-rebuilt.log`,
`focused-fixed.log`, `compare.cjs`, `compare.json`, and the individual
`main-*-plain.log` / `branch-*-plain.log` files. Earlier failures are retained.
The deterministic `lock-probe.mjs` also demonstrates that main and branch's
unchanged `legacyCountUsed()` reader throws SQLite error 5 (`database is
locked`) while another connection holds an exclusive operations-store lock,
and succeeds after release. That probe establishes the reader's behavior;
worker diagnostics are separate evidence for the actual failing call.

The intermediate commit (`4456b459`) also fails the initial `SUBMITTED`
assertion under plain Mocha on instance 91 (exit 1, 42.208 s). There is no
passing-to-failing boundary between main and the two isolation-hook commits
for this intermittent error. `bisect.cjs` / `bisect.json` retain that control
separately from the six unmodified runs.

The corrected main diagnostic captured the actual HTTP response: `ok:false`,
empty text, `error.message:"database is locked"`, mapped to `JOB_OPEN`'s
`ZOSD_JOB_PORT` call; the detector was absent from `require.cache`. It failed
the original `SUBMITTED` assertion (exit 1, 42.472 s). The corrected branch
diagnostic passed the original test (exit 0, 100.237 s). See
`diagnostics.json`, `main-diagnostic-corrected.log` and
`branch-diagnostic-corrected.log`. No branch-specific production fix is
justified by these results. The separate reader lock probe illustrates a
shared susceptibility; the mapped HTTP error does not identify its exact
native SQL statement.

The first, invalid deep diagnostics preloaded `Launcher`, which also cached
the worker guard before its CLI entry point and made workers exit. Their
post-submission failures are instrumentation artifacts, excluded from the
attribution evidence. `diagnostic-invalid.cjs` and the original
`main-diagnostic.log` / `branch-diagnostic.log` retain them. The corrected
logger observes core EventEmitter events without importing project modules.

The hooked ADT fragment, sorted directly from `test/suites.d/adt.json`, passed
in mode 0: 2,275 tests, 47 files checked, exit 0, 450.616 s Mocha wall time.
Reporter completion is retained in `adt-timings.json`; snapshot accounting is
44,373.854 ms total and 885.485 ms median per file. The detector's only ADT
allowance was the existing facade temporary-root exception. The manifest
check still reports 290 ordinary and six grouped suites, with no drift.

The final focused command is
`npx mocha --require ./tools/osd-test-isolation.cjs test/osd-test-isolation.mjs test/osd-suites.mjs`,
through the heavy wrapper after an external build: **99 passing, exit 0,
11.385 s wrapper wall time**. This includes the new first-file stale-generation
regression and all mutation-reached assertions. Snapshot accounting is
1,017.850 ms total and 508.925 ms median per file.

The actual worker fixture also ran in this working tree after explicit
baseline builds:

| Check | Result | Wrapper wall time |
| --- | --- | ---: |
| Plain `npx mocha test/vscode-job-worker-integration.mjs` | exit 1; initial `SUBMITTED` assertion | 46.999 s |
| Hooked, same fixture | exit 2; body proof and generation invariant fail | 47.397 s |
| Plain, fetch-only diagnostic | exit 1; same `JOB_OPEN` database lock; detector absent | 47.062 s |
| Hooked, fetch-only diagnostic repeat | exit 0; 1 passing, full activation and second job completed | 99.960 s |

The hooked failure's proof has `identity:true`, `content:false`: the initial
submission failure prevents the fixture from reaching its later activation,
so its pack still contains the original probe rather than the measured final
content. The narrow generation allowance correctly refuses this unfinished
fixture. Cleanup still stops the launcher and removes its storage. This
additional failure is retained in `worker-hooked-final.log`; the fetch-only
diagnostic records the underlying response without changing it. No assertion
or allowance was relaxed. `validation.json` and `worker-response.json` retain
all working-tree runs, including the external baseline builds.

The successful hooked diagnostic repeat performs the cold activation required
by a SUBMIT source and exercises the complete mutation path. Its final
restored-pack proof earns the existing `TEMPORARY ALLOW`; snapshot accounting
is 1,349.076 ms. It does not replace either initial red result. Final external
build restores the working tree's live generation; no detector cleanup is
involved. Changed-file leak scan (`--paths` on the three edited files) and
`git diff --check` pass. HEAD remains `822da6d7`; no commit was made.

## Fix round 1, f2716315 (2026-10-04)

This working-tree fix replaces 63 invariant allowances across 62 files with
**13 originating entries**: ten root identities/count limits and three measured
generation drifts. All have owners and individual
[backlog items](backlog/misc.md#test-isolation-fixture-repairs). Unchanged inherited
generation drift is reported once; downstream files have no generation entries.
Environment import edits are reconciled across all files and checked again at
run end against the original environment. Temporary roots use creation-time
absolute paths for sync, callback and promise helpers.

Node v22.23.3, requested prep script, linked local transpiler (already dirty),
pinned libraries. Every heavy command used range `90-99`, four slots. The ADT
modes ran sequentially, then shard 1. Independent run setup uses an external
transpile; the detector performs no restoration or cleanup.

| Check | Files | Passing | Pending | Failing | Measured time |
| --- | ---: | ---: | ---: | ---: | --- |
| Final detector + runner | 2 | 98 | 0 | 0 | 10.834 s wrapper wall |
| ADT mode 0 | 46 | 2,135 | 0 | 0 | 431.985 s wrapper wall |
| ADT mode 1 | 46 | 2,135 | 0 | 0 | 477.308 s wrapper wall |
| Full shard 1/4 repeat | 71 | 1,563 | 24 | 0 | 736.160 s reporter execution |
| Real warm fixture, final code | 1 | 1 | 0 | 0 | 28.945 s wrapper wall |
| Detector + runner + real notebook job worker | 3 | 99 | 0 | 0 | Notebook body 105.632 s |

The full-shard log spans approximately 739.926 s including startup. All three
reporter artifacts have completion markers, zero failures and zero internal
retries. The final shard retry report is empty. Manifest check: 289 ordinary
and six grouped suites, no drift.

The expanded critic regressions against frozen original modules ran **13 pass /
18 fail**, exit 18 (4.482 s). The final isolation suite has 42 cases. Probes include
plain/hooked error controls and both mutants; the temporary-root mutant confirms
its directory remains after the detector exits. The first full shard was retained
red: 1,560 pass, 24 pending and two warm hook failures in 757.759 s. Its proof used
the saved-tree view; warm compilation can use persisted active copies of inactive
objects. The corrected read-only proof verifies that view stayed unchanged and
uses the builder overlay hash. Real warm and full-shard repeats pass. A subsequent
focused run corrected two mistaken plain-control expectations: plain Mocha exits
zero for those critic cases, while the detector now surfaces their hook errors.

Snapshot totals / medians per file: ADT 0 **41,000.222 / 826.802 ms**; ADT 1
**44,362.520 / 914.949 ms**; final shard **94,372.739 / 1,431.908 ms**. Entry and
exit tree hashes and proof captures are included; test and cleanup work are not.
These measurements are accounting, not causal wall-time overhead estimates.

Without the detector, the dialog step uses one null observer check, with no
observation Set or per-step add/delete. The same benchmark tool ran sequentially
before/after: 10,000 warm-up steps, 11 samples of 100,000 empty exclusive steps.
The median was **683.34747 → 533.83553 ns/step (-21.88%)**. This is a local
measurement, not an end-to-end speedup claim.

Evidence and executable reproducers remain under `.local/isolation-round1/`,
including `report.md`, command status JSON, timing artifacts, failed and clean
shard logs, final focused/warm logs, original-module regression logs, and both
benchmark sample arrays. HEAD remains `f2716315`; no commit was made.

## Original discovery record

Base HEAD: `11122e9f4a815e0118b8361223fc899e2f7d773e` (2026-10-04), with the detector changes in the working tree. No commit and no leaking-fixture repair were made. Setup used the requested prep script and `npm run transpile`, with pinned libraries and Node v22.23.3. Heavy runs used `OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh`.

Each independent run starts from a transpile of its working tree; the detector never rebuilds at file boundaries. The complete ADT fragment has 44 files, sorted as in `loadSuites()`, and was run with `OSD_ADT_ONE_RUNTIME=0` and `1`, the isolation plugin, no-retries plugin and timing reporter. Each CI shard uses `node tools/osd-suites.mjs --report-skips --shard i/4 --timings ... --report ...`.

Final ADT repeats and shard 1 ran in isolated `/tmp/leakhook-verify-{0,1}` copies to keep concurrent working-tree changes separate. They retain the main tree’s 13 ignored DSL trace metadata files. Shards 2–4 ran in the main working tree. The figures below distinguish test-body failures from invariant hook failures. Allow-list warnings remain observations even when the hook passes.

| Run | Files checked | Passed | Pending | Failed tests | Failed isolation hooks | Distinct observed file/invariant pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ADT mode 0 | 44 | 2124 | 0 | 0 | 0 | 1 |
| ADT mode 1 | 44 | 2124 | 0 | 0 | 0 | 1 |
| CI shard 1/4 | 69 | 1650 | 27 | 0 | 0 | 5 |
| CI shard 2/4 | 71 | 1721 | 4 | 0 | 50 | 51 |
| CI shard 3/4 | 73 | 2360 | 4 | 3 | 3 | 3 |
| CI shard 4/4 | 73 | 1328 | 25 | 2 | 3 | 4 |

These six completed runs checked 374 file boundaries: 11,307 passed tests,
60 pending tests, five ordinary failures and 56 isolation hook failures.
The corrected repeats replace earlier observer-induced failures; those
attempts are explained below rather than counted as final validation.

The final focused runner/detector verification passed **65 tests** across two files. Its fixtures prove file attribution, multiple suites, the final file, pending/import-only/`only`-filtered files, cleanup failure, import-time environment changes, live children, temporary roots, stale generations, the intentional API, per-file hook context, open dialog work, explicit parallel-worker refusal, promisified subprocess result preservation, and refusal to retry away an isolation failure. Suite registration checks report 286 ordinary and five grouped suites with no drift.

Shard 3 has three ordinary failures in `test/vscode-abapgit-zip.mjs` because `zip` is unavailable. Shard 4 has one missing-`zip` failure in `test/segw-tree.mjs` and one missing-`bun` failure in `test/vscode-abap-debug-view.mjs`. These checks remain failed; none was removed or skipped. Optional `.local/corpus` and `.local/corpus-sap` were absent. Notebook activation completed in both shared ADT modes without the motivating 2-second timeout.

## Originating violations

Temporary-root evidence is the surviving helper-registered directory count at the file boundary. The outer heavy wrapper may remove its scratch directory after the Mocha process exits; that does not undo the observed leak.

| File | Invariant | Evidence |
| --- | --- | --- |
| `test/adt-facade.mjs` | temporary-roots | 1 surviving `osd-parts-*` roots. |
| `test/amdp-pack.mjs` | temporary-roots | 1 surviving `osd-amdp-pack-*` roots. |
| `test/generation-diff.mjs` | temporary-roots | 17 surviving `gen-*` roots. |
| `test/osd-bsp.mjs` | temporary-roots | 1 surviving `osd-bsp-*` roots. |
| `test/osd-routes.mjs` | temporary-roots | 1 surviving `osd-routes-*` roots. |
| `test/osd-store.mjs` | temporary-roots | 1 surviving `osd-crlf-*` roots. |
| `test/prove-inplace.mjs` | temporary-roots | 31 surviving `osd-prove-inplace-*` roots. |
| `test/prove-on-system.mjs` | temporary-roots | 80 surviving `osd-prove-runs-*` roots. |
| `test/segw-tree.mjs` | temporary-roots | 1 surviving `segw-repo-*` roots. |
| `test/stg-compile.mjs` | temporary-roots | 1 surviving `stg-pack-src-*` roots. |

Generation origins: `test/vscode-warm.mjs` restores edited source bytes without restoring its rebuilt live generation; `test/dsl-l2.mjs` renders 13 previously absent ignored `src/l2demo/*.trace.meta.json` sidecars without updating live; `test/vscode-job-worker-integration.mjs` activates a disposable notebook pack then removes it while retaining the overlay live generation. The read-only builder hash with exactly the 13 DSL sidecars excluded returns `759177bda0d12f33`, while the actual tree hashes to `a1e53ac46cfb6ea1`. The detector and this task leave those sidecars untouched.

## Every generation observation

The first three origin names above identify the causes found by examining the fixtures. Other rows record inherited drift, rather than asserting that the later file caused it. Entry snapshots read the live link only; exit snapshots compute the exact builder tree hash. Distinct hash triples from repeats are listed separately.

| File | Entry live → exit live / exit tree | Attribution |
| --- | --- | --- |
| `test/dsl-l2.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Origin |
| `test/dsl-l3-chaos.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/dsl-l3-remote.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/dsl-l3-resilience.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/dsl-regions.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/gui-reports.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/http-case.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/ir-host-relation.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/ir-ranges-a4h.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/job-tail-events.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/leak-scan.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/lift-r1.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/lift-r3.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/mocha.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-bind.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-bsp.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-child.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-db.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-destinations.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-dev.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-git-history.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-icf-apply.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-main.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-parent-exit.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-suites.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-test-isolation.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-unit.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/osd-where.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/pages-index.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/pins.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/protocol-ni.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/rfc-proxy.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/rfc-replay.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/se16.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/seed-batching.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sql-trace.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-divergences.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-dml.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-engines.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-lexer.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-parser.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-procedure-source.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-scope.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/sqlscript-treatments.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/store-destination.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/store-history.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/taxi-import.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/transaction.mjs` | `759177bda0d12f33` → `759177bda0d12f33` / `a1e53ac46cfb6ea1` | Inherited |
| `test/vscode-job-worker-integration.mjs` | `759177bda0d12f33` → `e5315ee4149d11ec` / `a1e53ac46cfb6ea1` | Origin |
| `test/vscode-warm.mjs` | `759177bda0d12f33` → `ee8b686b9cf3721d` / `759177bda0d12f33`<br>`a1e53ac46cfb6ea1` → `5d4f96408fafbf39` / `a1e53ac46cfb6ea1` | Origin |
| `test/webgui.mjs` | `5d4f96408fafbf39` → `5d4f96408fafbf39` / `a1e53ac46cfb6ea1`<br>`ee8b686b9cf3721d` → `ee8b686b9cf3721d` / `759177bda0d12f33` | Inherited |
| `test/xref-seed.mjs` | `5d4f96408fafbf39` → `5d4f96408fafbf39` / `a1e53ac46cfb6ea1`<br>`ee8b686b9cf3721d` → `ee8b686b9cf3721d` / `759177bda0d12f33` | Inherited |
| `test/zosd-test.mjs` | `e5315ee4149d11ec` → `e5315ee4149d11ec` / `a1e53ac46cfb6ea1` | Inherited |

No dialog, live-child or environment leak was observed in the requested real suites; focused negative fixtures verify those checks fail.

## Explicit temporary exceptions

`tools/osd-test-isolation-allow.json` contains **62 named files / 63 file–invariant entries**: 10 temporary-root entries and 53 generation entries. All measured pairs are listed above, and every entry has its own reason identifying the originating fixture or inherited state. There are no environment-key exceptions. The plugin still prints full evidence and `TEMPORARY ALLOW`; it does not clean anything or retry the invariant away. These entries are temporary until the owning fixtures restore isolation.

Raw discovery runs loaded the allow-list before newly found entries were added. Consequently shards 2–4 retain red invariant hooks in their recorded results; later runs print allowed evidence. No required check was weakened or excluded.

## Detector cost

Baseline plus final snapshot time, excluding tests and user cleanup hooks. One exact builder hash per checked file dominates the cost; the baseline reads only live. Means below are computed from per-file samples, including registration-only final audits.

| Run | Total check time (s) | Mean ms/file | Median ms/file | Maximum ms/file |
| --- | ---: | ---: | ---: | ---: |
| ADT mode 0 | 20.403 | 463.707 | 451.856 | 669.253 |
| ADT mode 1 | 20.014 | 454.862 | 437.688 | 730.911 |
| CI shard 1/4 | 41.160 | 596.516 | 605.903 | 814.188 |
| CI shard 2/4 | 35.483 | 499.757 | 487.888 | 750.006 |
| CI shard 3/4 | 37.244 | 510.197 | 513.022 | 734.965 |
| CI shard 4/4 | 37.866 | 518.718 | 514.233 | 858.988 |

The six runs spent 192.170 seconds in checks, about 4.8% of their combined
wall time. The final focused run spent 569.420 ms across two checked files
(284.710 ms/file). Exact tree size, filesystem cache and concurrent heavy
slots affect these measurements.

## Implementation files

| Purpose | Files |
| --- | --- |
| Owner snapshots | `tools/osd-dialog-step.mjs`, `tools/osd-build.mjs`, `tools/osd-runtime.mjs` |
| Resource observation and file hooks | `tools/osd-test-resources.cjs`, `tools/osd-test-isolation.cjs` |
| Runner integration and failure metadata | `tools/osd-suites.mjs`, `tools/osd-suite-timing-reporter.cjs` |
| Regression fixtures and registration | `test/osd-test-isolation.mjs`, `test/osd-suites.mjs`, `test/suites.d/infra-misc.json` |
| Temporary exceptions and documentation | `tools/osd-test-isolation-allow.json`, `docs/test-isolation.md`, `docs/test-isolation-runs.md` |

## Corrected and discarded exploratory runs

An initial exploratory ADT run was discarded because suite-fragment JSON was reformatted while it ran, changing a generation input. Stable-input repeats replaced it. The allow-list is under `tools/`, outside the builder’s test JSON inputs.

The observer’s initial subprocess wrapper lost Node’s `util.promisify.custom` contract: ADT A9/C5 received scalar output instead of `{stdout, stderr}`, and the first shard-3 attempt crashed importing `pages-push.mjs`. The wrapper now preserves function descriptors, the custom promise result and `.child`; a regression fixture verifies this. Both ADT modes, shard 1 and shard 3 were repeated with the correction. Shards 2 and 4 completed their test bodies with the valid recorded fixture leaks; their remaining ordinary errors are the missing tools described above. The observer-induced assertion failures are not reported as repository failures.

A concurrent focused run against the already dirty DSL tree was also replaced by a clean-build focused run. None of these task-caused mismatches became allow-list entries. Valid root/generation evidence from the original shared runs is retained in the tables above.

Logs, timing JSON and shard reports are retained as `/tmp/leakhook-*.log`, `.json` and `.md` for this session. Import crashes, `process.exit()`, native-extension children and untracked grandchildren remain outside normal final-boundary detection; Mocha parallel mode is explicitly refused.

## Working-tree source invariant (2026-10-04)

Measured in `test/isolation-tree-invariant`, base `8feda000`, without commits.
Every heavy command used `OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh`; `npm run transpile` completed first. The `tree` invariant
uses the same named-root manifest, metadata/digest cache, comparison,
restoration classification, phase/kind allowance matcher and runner-end audit
as `gen`. It observes checkout `src/`, every immediate `packs/*/src`, and the
checkout/pack manifests, independently of the generation hash and enabled packs.

The first focused regression run against the old hook was red: a file left
`src/left.trace.meta.json`, but the child Mocha exited zero. The generalized hook
names the originating file and path. Byte-identical write/restoration and a stale
source run start pass. Further regressions cover source/manifest edits in each
phase, new packs, restorations, filtered imports, bounded exceptions and the
measured L2 allowance's refusal of an extra sidecar.

The ADT fragment ran once with `OSD_ADT_ONE_RUNTIME=0` and the hook: **3,578
passing across 52 files**. It named no `tree` leak; only the existing
`adt-facade` temporary-root allowance was printed. Its tree manifests covered
1,183 files at start, with 208 boundaries, median **9.906 ms/boundary**,
58.699 ms initial hashing/manifest capture and 2,267.910 ms total observation.

The source/pack scan combines the suites selected by grepping same-line
`writeFileSync`/`rmSync`/`mkdirSync` calls mentioning `src/` or `packs/`, all
DSL/pack/stg-compile suites, and the build/warm/notebook activation cases whose
writes use path variables. ADT cases are covered by the fragment; cases already
in shard 2 are covered there, except L2 is also scanned first without an allowance.

At the L2 boundary the hook named **13 execution additions** under `src/l2demo`:
11 main classes' `*.clas.testclasses.trace.meta.json` companions, plus
`zcl_l2_ship_min_captains.clas.trace.meta.json` and
`zcl_l2_recent_voyage.clas.trace.meta.json`. The nine other main-class companions
are tracked at this base and unchanged. All 13 ignored companions were absent
before the scan; no tracked file was removed to manufacture this result.
The generation invariant did not report these files. The new `tree` allowance
lists exactly these paths, each limited to one execution addition, with owner
`osg-research` and [its repair entry](backlog/misc.md#isolation-dsl-l2-tree).
Import changes, changed/removed companions and additional paths stay red.

Raw logs, the selected file lists, optional-sidecar baseline and measurement
script are retained locally under `.local/isolation-tree/`.

The complete 39-file source/pack scan ended with **1,369 passing, two pending,
11 failures**. Two were isolation failures observed before their new allowances:
the L2 `tree` additions and one surviving `vsix-hidden-gen-*` root from the
packaging fixture. Nine packaging failures were `EROFS` from its default external
scratch cache, outside this workspace's writable roots. The hidden-gen setup
failure left an empty root without moving `gen/`.
Its setup now runs inside cleanup, including scratch-directory creation and
the generation move; no packaging temporary-root allowance remains.
The packaging rerun uses `OSD_VSIX_SCRATCH` inside the heavy runner's temporary
directory, outside the checkout; ordinary failures remain part of the verdict.
The scan additionally printed existing allowances for `amdp-pack`, `osd-bsp` and
`osd-store` temporary roots, and `vscode-job-worker-integration` and `vscode-warm`
generation drift. No other `tree` or `gen` origin was observed.
Its 156 tree boundaries started with 1,185 files; median capture cost was
**10.401 ms/boundary**, 1,755.096 ms total manifest time.
