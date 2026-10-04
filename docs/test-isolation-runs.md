# Isolation detector run record

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
