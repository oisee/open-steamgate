# CI test frequency and timing

The default `tests` workflow still runs a clean binary build, pinned transpiler, pack fetch, lint, every ABAP Unit class, the integration suites, and the Node browser smoke tests. The preview workflow separately builds and checks the browser deployment. `npm test` locally runs the ordinary integration files; the packaging group runs explicitly.

The build job also builds a seeded Linux x64 binary and runs `scripts/smoke-binary.mjs`, as does the Linux x64 release binary job before upload. Bubblewrap exposes only OS files and a temporary directory containing the copied executable; the checkout and its node_modules are inaccessible. With fresh HOME and XDG_DATA_HOME, `osd up` must answer HTTP 200 at `/osd/serving` and `/sap/bc/adt/core/discovery` within five minutes. The smoke ignores inherited STG_PORT, selects an ephemeral loopback port and checks it is free immediately before spawning. It verifies the serving PID belongs to its live child process tree through Linux `/proc` namespace PID mapping, including after discovery answers. The smoke signals its own PID, and the private PID namespace reaps its children. This catches runtime assets that a successful bundle or a smoke beside the build checkout can miss.

On ordinary PRs and pushes to `main`, the integration suite runs the ordinary `files` list and omits the named packaging group with four slow VSIX describes: changed-seed repackaging, selected-pack archives, prebuilt-generation reuse, and the installed package outside the checkout. The quick `seed tar` and version-stamp tests still run. The packaging job runs for changes to packaging code, package identity/payload, lock files or seed inputs (`src/`, `webapp/`, `tools/`, `data/`, any selectable in-tree pack, the root configuration files copied by `copySeedTree`, and shipped `test/` paths), and for weekly, manual and `vscode-v*` tag runs. `tools/osd-ci-vsix-profile.mjs` owns the changed-file rule. Root `docs/`, excluded `test/e2e/` and `test/fixtures/`, and the `TEST_ONLY_ABAP` doubles stay fast. Other `test/` files ship and therefore select full. Checkout `gen/` is regenerated inside the seed, not copied. The directory/file lists and test exclusions are imported from `scripts/build-vsix.mjs` so staging and CI agree. A menu-only change to `editors/vscode/package.json` stays in the fast profile; a version or entry-point change gets the full one.

The slow groups are intentionally real: two builds with changed seed content must produce different materialized copies; two builds with identical content must reuse one prebuilt generation; the installed VSIX must start away from this checkout. Keeping them on tags and scheduled runs preserves those checks without charging every feature PR for repeated packages.

## Local measurements, 2026-09-28

Same checkout and dependencies, Bun 1.4.2, Node 26.9.0. Wall time includes process startup. The local full VSIX run failed one existing Marketplace assertion because its archive contained `zork-mini`; the timing still describes the work it ran. The fast profile passed.

| Work | Before | After | Observation |
| --- | ---: | ---: | --- |
| `test/vscode-vsix.mjs` | 176 s, 14 pass / 1 fail | 0.29 s, 4 pass | Four slow groups moved out of the ordinary profile; about 175 s saved on this machine. |

Other cached local stages measured sequentially on the same checkout: `npm run transpile` 17.80 s, `npm run lint` 10.62 s, and `node tools/osd-unit-run.mjs` 11.09 s (all passed). These agree closely with the corresponding CI steps below; the ABAP Unit pool in the editor does not affect them.

The last successful `main` `tests` job (2026-09-28, run 36384869447) gives a runner baseline for every step. GitHub timestamps have one-second precision:

| CI step | Wall time |
| --- | ---: |
| Checkout, Node, npm ci, pins, Bun, clean binary | 12 s combined |
| Build pinned transpiler | 30 s |
| Fetch packs and libraries | 10 s combined |
| Transpile | 17 s |
| Lint | 10 s |
| ABAP Unit | 14 s |
| Integration suites | 714 s (11 min 54 s) |
| Install Chromium | 28 s |
| Node browser smoke | 64 s |
| DuckDB browser smoke | 13 s |

The job took 914 s (15 min 14 s) end to end. Integration suites accounted for about 78% of it. The fast profile changes only that stage; it does not speed up the 14 s ABAP Unit stage.

The first ordinary docs-only PR using the fast profile, #185 (run 36416356616, 2026-09-28), passed on a GitHub Ubuntu runner:

| Step | Before: last green full `main` | After: fast #185 | Difference |
| --- | ---: | ---: | ---: |
| Integration suites | 714 s | 410 s | 304 s less |
| ABAP Unit | 14 s | 11 s | 3 s less; no runner change intended |
| Node browser smoke | 64 s | 66 s | 2 s more; unchanged tests |
| Whole job | 914 s | 589 s | 325 s less (5 min 25 s) |

These are two separate runner invocations; timing varies with runner load and the changed test tree. The fast run still executed 2,830 timed integration tests. Their measured wall times sum to 370.8 s; the suite step took 410 s including startup and other overhead. Its slowest individual test was a warm activation at 19.9 s; two deliberate boot/stop tests took 10.8 and 9.5 s. No remaining single test explains most of the 410 s.

Local cached dependencies cannot measure `npm ci`, network clones, Actions image setup or Chromium download. The GitHub Actions UI reports each step's wall time. The VSIX tests also print per-test wall times, so a slow package case can be traced to its test. Do not treat the VSIX-only saving as a measured reduction of the whole CI job.

## Parallel suite workflow

The `tests` workflow has one `build` job that prepares the pinned transpiler, fetched packs and libraries, transpiles, lints, runs ABAP Unit and checks BAL across a restart. It uploads a tar of that run's built tree. Six independent `suites` jobs, one `e2e` browser job, and (for the full profile) one `packaging` job restore the same tar and run concurrently. A final job named `test` succeeds only when `build`, all six matrix jobs and `e2e` succeeded, and the packaging result matches the profile selected by `build`. This keeps the check name stable for branch protection.

The tar preserves `build/live` and `output` symlinks and executable bits, which a plain Actions artifact would lose. Each consumer runs `npm ci` with the setup-node cache, restores the pinned transpiler clone under `.local/ci-artifact/transpiler`, and relinks its compiled packages plus the fork's `@abaplint/core`. Its Git metadata stays in the tar so diagnostics can identify the exact pin. The tar also contains `gen/`, `build/`, `.local/lars/`, and every fetched pack source folder from the pack manifests. A missing `gen/`, `output/`, live manifest, library folder, or transpiler build fails the restore step before tests start. After relinking, `osd-ci-artifact verify` logs both hashes and refuses a live/tree mismatch in every consumer job. The artifact is produced by this workflow run; a generation hash cache cannot accidentally supply another run's build. The existing full-suite weights were about 186 s per suite job before moving packaging out, allowing them to overlap with browser work after the build job.

The generation hash identifies transpiler/runtime package content rather than their checkout locations. Relocating the pinned clone from the build job to `.local/ci-artifact/transpiler` preserves the hash. The hash covers configuration, input and library contents (excluding generated `gen/` and optional `*.trace.meta.json` navigation metadata), BSP pages, pack inputs/manifests, generator identity and toolchain identity. The isolation hook reports an inherited mismatch once as `run-setup` information; that line may belong to a later Mocha batch rather than the initial artifact restore.

Run 37181371722 built and restored generation `47228b54cec2add2` unchanged. Its shard 2 then ran `dsl-l2`, whose setup wrote 13 navigation sidecars and changed the tree hash to `fb6bff648e52e1da`. The later `run-setup` mismatch was inherited from that suite, not caused by tar relocation. Hashing now excludes these optional, derived sidecars, matching the transpiler and BSP generator; the DSL suite no longer needs a generation-drift allowance. A local build/tar/unpack/relink audit compares every framed hash input, and the downloaded artifact also reproduces the matching initial hashes.

## Named packaging group

Each feature fragment in `test/suites.d/*.json` has a `files` array; `vscode.json` also lists `test/vscode-vsix-packaging.mjs` under `groups.packaging`. `loadSuites()` in `tools/osd-suites.mjs` merges fragments and sorts both ordinary and grouped suite paths alphabetically before returning `{files, groups}` to the runner and Go parity. This intentionally changes execution order once. CI will surface hidden order dependencies, including ones like the earlier `apc-timers`/`adt-facade` trap. `node tools/osd-suites.mjs` and all `--shard i/6` runs select only `files` and print the groups omitted. `node tools/osd-suites.mjs --group packaging` runs exactly the packaging file. The list drift check covers both arrays, while `--list-shard i/6` remains the ordinary file list.

To add another group, add its test file under `groups.<name>` in `test/suites.d/*.json`, give it a measured weight in `test/suites-timings.json`, and add a CI job or step that runs `--group <name>` with an explicit gate. Every new `test/*.mjs` suite must appear in `files` or a group. Use the prefix placement table in `test/suites.d/README.md`; `node tools/osd-suites.mjs --check` reports a suggested fragment for each unlisted suite.

## Build and browser caches

The `tests` build job and `preview` job share an `actions/cache` entry for `../transpiler`. Its `transpiler-v1` key includes runner OS and architecture, Node major 22, the hash of `libs.lock.json` (which contains the pinned transpiler repository and commit), and the hash of `tools/osd-ci-transpiler-build.sh` (the clone, install and compile commands). On a miss the script builds the checkout. On every run, including a hit, it verifies the exact commit, installed dependencies, compiled JavaScript in all four packages, and the executable CLI before the package and core links and `tools/osd-transpiler.mjs` run. The `tests` job still relocates that checkout into its per-run artifact; the cache never replaces the artifact consumed by the shards. A changed pin or build command creates a new key. To force a rebuild without changing either, increment `transpiler-v1` in both workflows.

The `tests` and `preview` browser jobs share `~/.cache/ms-playwright` through a `chromium-v1` key containing the runner OS and the installed `@playwright/test` version read from `package-lock.json`. A hit runs `npx playwright install-deps chromium` for uncached system packages; a miss runs `npx playwright install --with-deps chromium`. A Playwright version change creates a new key. To force a browser download, increment `chromium-v1` in both workflows. `release.yml` does not install Playwright, so it has no browser cache.

## Balanced shards and visible retries (2026-10-03)

`--shard i/6` assigns whole files longest first to the least-loaded shard using
`test/suites-timings.json` (file → seconds). Ties use path/shard index; missing
or invalid weights get the median (one second for an empty seed). Files execute
alphabetically in one process, preserving the existing loader order. There is
no `test/suites.json` or co-process/order constraint in the fragments. The
complete manifest drift check still runs before selecting a shard or group.

Refreshed on 2026-10-04 from the five latest successful `push` runs of
`tests.yml` on `main`: 37192035109, 37187008824, 37185244903, 37183279842 and
37180839525 (20 shard artifacts). Each file uses the median of its first-run
durations across those runs. Six shards are predicted at
**11.97 / 11.96 / 11.97 / 11.97 / 11.97 / 11.97 min**, below the 13-minute
execution target; before this change the slowest of four was 19.39 min. Three
current files have no measurement yet (`test/pre-push.mjs`,
`test/vscode-jobs-view.mjs`, `test/vscode-serving-front.mjs`) and take the
median until the next refresh. These weights exclude npm/install/restore and
initial import/startup, so they do not guarantee CI elapsed times. The older
`test/suite-timings.json` is historical.

Each shard uploads `suite-results-<index>-attempt-<attempt>` with first-run `timings.json` and
`flaky.md`, even on failure. Refresh the committed weights with:

```sh
node tools/osd-suites-refresh.mjs
```

It takes only successful `push` runs of `tests.yml` on `main` of this
repository, re-checks each run's event, branch, repository and conclusion
before downloading, keeps the latest attempt per shard, and rewrites the
weights only when drift requires it. Do not merge artifacts from an arbitrary
run by hand: a pull-request or dispatch run is not a trusted source of
weights.

`suites-timings.yml` runs weekly on Monday at 08:00 UTC and via
`workflow_dispatch`. It downloads the five latest successful `tests.yml` runs,
merges medians, and evaluates the existing six-shard assignment with the fresh
weights. A maximum more than two minutes above the ideal total/6, or any
ordinary file missing a valid committed or fresh timing, triggers a PR from
`ci/weekly-suite-timings`. The summary reports current and balanced predictions.
Download/API errors fail the workflow. It uses only `GITHUB_TOKEN` with
`actions: read`, `contents: write`, and `pull-requests: write`; it never pushes
to main. Repository settings must allow Actions to create pull requests. PRs
created with `GITHUB_TOKEN` do not automatically start other workflows; run the
required checks on the PR before merging.

The `tests` and `gogen` concurrency groups cancel active runs only for
`pull_request` events and share a group by PR ref. Other events use the run ID
in their group, so pushes to main and tags cannot replace either active or
pending runs. `preview` and `docker` already disable `cancel-in-progress`,
which keeps the running workflow. The unchanged `preview` concurrency group
still lets a new main-push run replace an existing pending run. Preserving
every preview would require queuing; disabling cancellation alone does not
provide that guarantee. See [GitHub's concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
The `test` aggregate still requires the entire suites matrix to succeed, plus
the build, browser and Go checks and the packaging job when selected.

Partial downloads preserve unmeasured weights; multiple samples use their median.
Retries never replace first-run weights. Local runs can write the same artifacts
with `--timings <artifact.json> --report <flaky.md>`.

After a failed shard, up to three distinct failing files each run once in a
fresh Mocha process; a named group retries together in one process. Packaging
never retries, so a packaging failure stays red. Test-level and suite-level
retries are forced to zero by a root hook; any observed internal retry stays red
and names the test. More than three
failing files means no retries. A second failure, crash, missing/incomplete
failure report or unattributed failure stays red. Even a zero process exit
requires the reporter's completion marker, consistent zero failures, and per-file
registered/passed/pending counts. Empty files and empty retries stay red; files
whose registered tests are all explicitly pending remain valid. Every attempt records each
test's full title path and outcome. Recovery requires the retry to retain all
original identities (including duplicate registrations), and every previously
failing test must pass; a vanished or newly pending failure stays red and is
named in the report. Bail options (`--bail`, `-b`, or Mocha configuration) disable
retries entirely. Unexecuted tests outside the retry set also prevent recovery.
Isolation recoveries keep the
shard green and write this line to `$GITHUB_STEP_SUMMARY` and the PR comment:

```text
- flaky / order-dependent: `test/example.mjs` — persistence restores rows (passed once in isolation)
```

The label flags possible order dependence: isolation success cannot distinguish
an ordering dependency from a transient flake. Investigate recurring lines.
All pull requests require six readable shard reports, including empty
`flaky.md` files for clean shards. Download, validation or publication failures
fail `pr-report`, which the required `test` gate depends on for PRs. Comment
writes retain the same-repository restriction; fork PRs still validate reports.

Alice's merge policy (2026-10-03): **required checks are `test` + `scan` only**.
Docker, gogen, preview, size and queue are advisory on PRs. The `test` rollup also requires retry-report validation/publication on PRs.

### Per-file integration timing, 2026-09-29

Measurement: local, relative weights only. The full integration run used a free `STG_PORT` and the pinned transpiler. Total and the 20 longest files:

The full local run reported 2,938 passing, 36 pending and 15 failing tests. The failures came from a read-only home cache, local binary/CLI setup and an occupied fixed port; the VSIX packaging cases then passed in a focused run with a writable temporary scratch directory. The `test/vscode-vsix.mjs` weight below is from that focused run (183.5 s), replacing its 0.1 s from the interrupted cases in the full run. These measurements are weights for balancing, not a green integration result.

| Suite file | Wall time |
| --- | ---: |
| `test/vscode-vsix.mjs` | 183.5 s |
| `test/adt-devloop.mjs` | 107.6 s |
| `test/osd-runtime.mjs` | 81.1 s |
| `test/vscode-warm.mjs` | 62.0 s |
| `test/xref-seed.mjs` | 32.8 s |
| `test/store-destination.mjs` | 26.3 s |
| `test/vscode-launcher.mjs` | 25.8 s |
| `test/cds-check.mjs` | 25.7 s |
| `test/osd-unit.mjs` | 24.1 s |
| `test/osd-child.mjs` | 18.2 s |
| `test/demo-data.mjs` | 15.1 s |
| `test/segw-tree.mjs` | 12.5 s |
| `test/vscode-debug.mjs` | 10.5 s |
| `test/osd-icf.mjs` | 10.0 s |
| `test/unit-risk.mjs` | 9.6 s |
| `test/osd-db.mjs` | 8.5 s |
| `test/osd-store.mjs` | 8.5 s |
| `test/osd-icf-runtime.mjs` | 6.3 s |
| `test/zosd-test.mjs` | 6.1 s |
| `test/database-identity-host.mjs` | 5.3 s |
| **All 176 files** | **743.2 s (12.4 min)** |

## Split VSIX file weights, 2026-09-29

The new ordinary `test/vscode-vsix.mjs` file measured 0.040 s for its four tests. The packaging group file measured 159.5 s for its 13 tests. These are local per-file weights after the split. An initial packaging measurement had one seed-ID assertion failure because `test/suite-timings.json` changed between that test's two package builds; the full group passed 13/13 when rerun with the source tree stable. The historical full-file timing above remains a record of the earlier layout, not the current shard weight.

## Next speed work

1. Record the times for transpiler preparation, transpile, lint, ABAP Unit, non-VSIX integration and browser smoke on the same runner before changing them.
2. The Test Explorer pool does not speed up CI's ABAP Unit command: CI calls `tools/osd-unit-run.mjs`, which launches one `output/index.mjs`. Only consider parallel CI ABAP Unit after isolated databases and the baseline time are measured.
3. Measure cold and warm cache timings on the same GitHub runner before treating the expected transpiler and Chromium savings as observed CI reductions.

## Kernel conformance: required and heavy evidence

CI runs only inputs reproducible from the public ABAPiti pin: the generated
corpus and the checked-in int8 fixtures. Mono and no-SIMD QuickJS are
**not measured in CI: no public pinned source (local copies only; see
this section)**. They are absent from ABAPiti commit
`8cdf57212c23772baf6293cb3d8784181521c8e4`, including its emitter and test data.
Both profiles report that reason; unavailable optional inputs never fail the
job. No SSH credentials, secrets or local fixture copies are required.

`tests.yml` adds `kernel-conformance`, parallel to the four suite shards after
`build`. It restores the same pinned transpiler/runtime and libraries, then
runs all 4,077 generated ABAPiti tests plus 10 int8 tests on
OSG-JS. It is part of the existing `test` aggregate gate. The integration
shards gain only the small comparator suite, not any corpus execution.

`kernel-conformance.yml` runs a separate job on pushes to `main`, nightly at
02:00 UTC, on every tag, and manually. It has no PR trigger and is outside the required `test`
aggregate. It runs the public generated corpus and int8 on
OSG-JS and osgo, and lists mono and QuickJS as not measured. Jobs publish
per-folder results, aggregate `osgjs.json` and
`osgo.json`, a run manifest, regenerated support evidence, stderr, and
`summary.md`, including on failure. The heavy profile uses a 90-minute job
limit, an 80-minute outer timeout, and a 20-minute timeout per folder/runtime;
the required command has a 10-minute outer timeout and an 11-minute step
timeout in a 25-minute job, allowing headroom above the estimated 3–7 minutes
on CI. Every step in both kernel jobs has an explicit timeout: one minute for
metadata, validation and summaries; five for setup, checkout, cache, artifact
and library operations; ten for the heavy job's runtime build; eleven for
generation (two attempts of at most five minutes) and the required run; and
81 for the heavy run. Actions are pinned to commit SHAs with version comments.
Only PR runs can cancel an earlier heavy run; main, schedule and tag runs
finish independently. The concurrency policy in `tests.yml` is unchanged.

Both use `osgjs:unit --db file` and `NODE_OPTIONS=--max-old-space-size=12288`,
including the parent evidence generator. Go uses `GOTOOLCHAIN=go1.26.0` and
`GOFLAGS=-buildvcs=false`; GOPATH, module cache and build cache stay in the
workspace. The generator requires clang/wasm-ld 18. GitHub installs those on
a corpus cache miss. The corpus content hash catches a partial generator
run, a skipped C fixture or different compiler output.

The tracked `.github/ci/abapiti.ref` is a full commit, following ABAPiti's
`.github/ci/osgo.ref` convention. On a cache miss, a second checkout reads
that exact commit, checks its MIT licence, and executes:

```sh
ABAPITI_TEST_OUT=<output> GOTOOLCHAIN=go1.26.0 GOFLAGS=-buildvcs=false \
  go test ./wasm -count=1 -run '^TestOSD_EmitUnitClasses$'
```

The emitter's `split/` ABAP files are flattened into the corpus directory,
just as ABAPiti's own osgo CI does. `.github/ci/kernel-corpus.json` records
file counts, content hashes and sorted test-identity hashes. Cache keys
include the corpus pin, platform and generation recipe/fixture manifest.
Every hit is content-checked before deciding whether the source checkout is
needed. A corrupt folder is evicted locally and regenerated once from pinned
inputs; incorrect regenerated content fails the job. Checkout and Go setup
each have one explicit retry, with the final failure remaining red. The Go
emitter retries once after two seconds, removes partial output between
attempts and retains both diagnostics in `generate.log` if both fail.
The verified public inputs are saved before
runtime tests, so even a red regression run populates the generated-input
cache. A valid cache-hit PR does not check out or regenerate ABAPiti. No
generated corpus ABAP is added to this repository.

The int8 inputs already live in `test/fixtures/osgjs-unit-int8`; staging gives
them abapGit names. The fixture expectations are A4H 758 measurements; the
int8x oracle passed 6/6. The fixtures retain their measured expectations.
`.github/ci/kernel-known-failures.json` allows exactly four
OSG-JS int8 test identities, each with a stable failure signature, reason and a link to
[transpiler #1964](https://github.com/abaplint/transpiler/pull/1964).
Assertion signatures retain the expected and actual values; other messages
normalize whitespace and omit the runtime's `Raised in` location suffix.
An unchanged list is green; a new failure, changed signature or status, missing test,
changed test identity or fixed known failure is red. Harness/setup errors,
refusals and timeouts cannot be added as known failures.

The drift check regenerates AST inventory and runtime evidence through
`osg:support`'s generator. It compares every construct's measured class
outcomes with `docs/osg-support.md` at the same pin and names differences.
The required profile projects the page onto the generated corpus and int8
on OSG-JS; the heavy profile also measures those folders on osgo. Neither
compares mono/QuickJS outcomes or constructs found only in unmeasured
folders. A compact tracked inventory of all four folders supplies the full
page counts for shared constructs, while outcomes are compared only for
measured classes and runtimes. Partial runs, missing helpers and compiler
refusals cannot support a `runs` claim. Timings, installed versions and
generator blob identifiers are recorded in artifacts; those variable
provenance fields are excluded from semantic drift, unlike the standalone
`osg:support --check` command's byte comparison.

### Reproduce and maintain the inputs

For the supplied read-only public checkout:

```sh
OSD_HEAVY_RANGE=50-59 tools/osd-heavy.sh timeout 1200s \
  env NODE_OPTIONS=--max-old-space-size=12288 \
  node tools/osd-kernel-conformance.mjs --profile required \
    --source .local/abapiti-src
```

Use `--profile heavy` with `timeout 4800s` for both public runtime columns.
`--work <dir>` selects another workspace-local cache/report directory.
Only the two public folders are staged and content-checked, including all
ABAP/XML files consumed by the runners. Extra folders in an old cache are
ignored. Inputs are never read from a live branch.
`node tools/osd-suites.mjs --check`, the focused
`test/kernel-conformance.mjs` and `test/osg-support.mjs` suites, and the size
guard validate the changed path. Workflows are linted with actionlint; actual
GitHub Actions jobs cannot be run locally.

To update the pin, choose a full public ABAPiti commit in a separate checkout,
verify its licence, and update `abapiti.ref`. Emit fresh inputs using the
command above with workspace-local Go caches, flatten `split/`, and stage the
int8 fixture names. Regenerate the hashes with `fingerprint()` and
`identityDigest()` from `tools/osd-kernel-{corpus,check}.mjs`, and regenerate
`kernel-inventory.json` with `inventory()` from `tools/osg-support.mjs` for
the two public folders, preserving the unmeasured folder inventory. Do this
in a new `--work` directory; do not overwrite the
read-only supplied source checkout or manually bless an old cache. The new
pin, hashes, inventory, `kernel-known-failures.json.abapiti` and support page
must be updated together, then both public profiles must be measured.
A mismatch never silently refreshes the manifest.

When an allowed failure starts passing, the gate says "remove this entry
from .github/ci/kernel-known-failures.json" and names its class/testclass/method.
The JSON has one entry per test method, with its signature, reason and upstream link.
Remove the exact entry and regenerate the measured support claims from
complete folder results, preserving claims for unmeasured folders; the
allowance is not inverted
or broadened. A proposed new allowance needs a minimal reproducer, reason and
upstream link, followed by another required run. Use `failureSignature()` from
`tools/osd-kernel-check.mjs` to record a measured signature. Never replace an
old signature merely to accept a changed failure: investigate the assertion
and its cause first. Recheck a recorded result
without rebuilding using `osd-kernel-check.mjs --result <json> --known
.github/ci/kernel-known-failures.json --runtime osgjs --folder int8 --tests 10`.
Use `--support <support.json> --page docs/osg-support.md --inventory
.github/ci/kernel-inventory.json` to recheck semantic drift.

The public-source follow-up should put the mono WASM/driver, the no-SIMD
QuickJS WASM/driver, their test emitters, compiler versions/flags and licences
in ABAPiti at a full commit, or publish an immutable archive with a tracked
SHA-256 and those provenance files. Then add those inputs to corpus
preparation and the heavy profile, verify their hashes, and measure them
before adding them to the drift projection. The committed
`quickjs_eval.wasm` is a different SIMD
fixture: the pinned compiler explicitly rejects opcode 0xFD, so it cannot
replace the measured qjs folder. The approximately 906 KB mono class and
large QuickJS classes stay local. ABAPiti itself is public and MIT; that does
not establish provenance or all embedded third-party licences for an
unpublished generated artifact.

[zmjs](https://github.com/oisee/zmjs) and
[zqjs](https://github.com/larshp/zqjs) are separate hand-written ABAP projects,
not artifacts of this ABAPiti emitter. Their independent public pins and
corpus adapters are a follow-up; neither is included in the support page's
four-folder measurements or claimed as covered by these jobs.

### Local timing, 2026-10-04

The required public-input profile passed on the unchanged tracked runtime
pin `e34d6a1f` (2.13.93) in **130.02 seconds** (2 min 10 s), including repair
of an intentionally corrupted generated-corpus cache: 4,083 SUCCESS
and exactly four allowed FAILURE rows among 4,087 tests. Folder times were
81.01 s for the 4,077-test corpus and 23.37 s for int8; cache repair, fresh evidence
regeneration and drift comparison account for the remainder. The projection
covers 50 classes, 91,175 source lines and 130 constructs. The source build
was made in this workspace with the CI build script, without source patches
or changes to `libs.lock.json` or the transpiler pin.

Cold preparation regenerated the public inputs from the read-only ABAPiti
checkout and verified the licence, content hashes and identities. Go reported
1.301 s for the emitter test itself, excluding downloads. The initial cold
profile, run concurrently with focused tests using the inherited runtime,
also passed in 297.93 s (200.55 s corpus, 67.86 s int8).

All 35 focused comparator/support tests passed serially in 13 s (the original
32 plus changed-signature, cache-repair and generation-retry regressions).
One repeat exceeded the 120 s outer timeout; the isolated serial rerun passed
without skipping tests or changing their limits. The suites
check and actionlint passed for both workflows;
the changed-file size guard passed, reporting six inherited breaches.
A synthetic additional int8 failure exited 1 and named its method. A
changed-signature probe also exited 1 and named both expected and actual
signatures. Fixed allowances are still checked by the focused suite.
All 165 support-page construct rows and outcomes are unchanged; int8's 124
lines became 119 because the measured fixtures replaced the old local copies,
reducing the total from 348,319 to 348,314. The required profile's semantic
page drift check and `osg:support --check` on its regenerated artifact passed.
Structural leak checks found no matches;
the local private identifier list was absent, so private names were not
checked. GitHub Actions, the full integration suite and the heavy profile
were not run locally.

The required job runs beside the existing approximately 12-minute shards;
budget approximately 3–7 minutes on a public Ubuntu runner, plus the shared
build and any cold toolchain/module downloads. This is an estimate, not a
measured GitHub Actions result.

The previous digest-byte allowance is removed together with the unused
QuickJS content hash. It allowed only a packed private-address prefix found
inside the independently recomputed SHA-256 of 29 local QuickJS ABAP files,
not a hostname or a measured system address. CI no longer stages or verifies
that folder, so there is no reason to retain its digest or the exception.
