# First ADT unit-object GET

Measured in this tree on 2026-10-04, branch `perf/adt-unit-object-cold`,
based on `ced09652d0fc0a587545ab48be0f6a665a38d541`, Node 22.23.3.
No commits were made.

The VS Code discovery request is
`GET /sap/bc/adt/core/http/unit/object?type=CLAS&name=ZCL_STG_SEGW_TEST`.
It asks `unitPlan(..., {risk: true})` through the ABAP front's `PARSE
UNIT_PLAN` destination in both runtime modes. This object has three test
classes and 15 reached writes; those counts stayed unchanged in every sample.

First-request V8 CPU profiles, captured with `node:inspector`, found a
redundant whole-registry parse: approximately 4,184 ms in mode 0 and 4,269 ms
in mode 1 under `unitClasses -> registry -> #build_registry`. The risk graph
was rebuilt too (131/126 ms); reached method bodies and syntax lookup were
much smaller (50/53 ms). Timing spans on fresh processes confirmed two cold
`registry()` calls on the same store, one in pre-warm and one in discovery.

`warmUnitPlan()` previously warmed the registry and executable risk graph
without building the object index. First discovery calls `find()`, whose
initial index build deliberately invalidates the parse. Startup therefore
discarded the very cache it had warmed. The fix calls `store.list()` before
warming the registry/graph. Source edits still invalidate both and refresh
the risk verdict. Post-fix first-request profiles contain no registry parse
or graph rebuild; reached risk work takes about 60 ms.

Startup still schedules pre-warm with `setImmediate`, after binding the
sockets. VS Code waits for `/osd/serving` to report `ready: true` with a
generation, which means the supervised runtime is serving; it does not
await an extra readiness gate. The existing synchronous pre-warm can block
the parent event loop. Its ordering changes here, with no extra parse or
per-class warm-up added to startup.

One harness starts a fresh workbench, polls that actual readiness endpoint,
immediately sends the first unit-object GET, sends a second GET, then closes
the server and supervised runtime before the next sample. All 20 starts per
mode and revision ran sequentially: before mode 0, before mode 1, after mode
0, after mode 1. The built generation and on-disk derived xref cache were
reused; process memory was fresh. Profiling runs are separate from these
timings. Values below are **median / maximum, milliseconds**.

| `OSD_ADT_ONE_RUNTIME` | First GET before | First GET after | Server ready before | Server ready after |
| --- | ---: | ---: | ---: | ---: |
| 0 | 5,557 / 7,183 | 369 / 404 | 6,682 / 7,179 | 6,548 / 6,834 |
| 1 | 5,349 / 6,225 | 335 / 373 | 6,314 / 6,982 | 6,111 / 6,564 |

First-request medians improved by about 93%. Readiness medians improved by
2.0% and 3.2%; neither median nor maximum regressed. Second-GET medians were
177 -> 170 ms in mode 0 and 145 -> 145 ms in mode 1. These figures describe
the SEGW test object's response and executable closure on this machine,
not the CI owner's reported 4–7 ms warm request.

Reproduce each revision with:

```sh
OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh \
  node tools/bench-adt-unit-object.mjs --samples 20 --out .local/unit-measurement.json
```

Use `--samples 1 --profile` for one first-request CPU profile per mode.
Raw measurements, spans, profiles and test logs stay under `.local/`.

The one-second fresh-server regression failed before the fix in both modes
(6,246 ms / 5,570 ms). The lifecycle regression also failed because first
discovery replaced the warmed registry. It additionally checks that changing
a harmless test to execute `COMMIT WORK` refreshes its scheduled risk to
dangerous.

Verification completed sequentially under
`OSD_HEAVY_RANGE=90-99 OSD_HEAVY_SLOTS=4 tools/osd-heavy.sh`:

- `npm run transpile` passed before the integration runs and immediately
  before the extension run.
- All 49 files in `test/suites.d/adt.json` passed once in mode 0 and once
  in mode 1: 2,313 tests in each, no pending tests or retries. Reporter
  completion and every file's registered/passed counts were checked.
- `test/vscode-extension.mjs` passed: 215 tests, no pending tests or
  retries, with isolation and reporter completion checked.
- The one-second regression passed inside both ADT runs: 341 ms in mode
  0 and 350 ms in mode 1. The source-edit lifecycle regression passed too.
- The suite manifest has no drift, `git diff --check` passed, and
  `node tools/osd-leak-scan.mjs --paths` scanned all six changed/new files
  with no matches.

Full ADT execution took approximately 411 seconds in mode 0 and 447 seconds
in mode 1, including hooks and inter-file work. Raw reports are
`.local/unit-adt-0-timings.json`, `.local/unit-adt-1-timings.json`, and
`.local/unit-vscode-timings.json`; benchmark results are
`.local/unit-before.json` and `.local/unit-after.json`.
