# CI test frequency and timing

The default `tests` workflow still runs a clean binary build, pinned transpiler, pack fetch, lint, every ABAP Unit class, the integration suites, and the Node browser smoke tests. The preview workflow separately builds and checks the browser deployment. `npm test` locally still runs the complete integration suite.

On ordinary PRs and pushes to `main`, the integration suite omits only four slow VSIX groups: changed-seed repackaging, selected-pack archives, prebuilt-generation reuse, and the installed package outside the checkout. The quick `seed tar` and version-stamp tests still run. The full groups run for changes to packaging code, package identity/payload, lock files or pack manifests, and for weekly, manual and `vscode-v*` tag runs. `tools/osd-ci-vsix-profile.mjs` owns the changed-file rule. A menu-only change to `editors/vscode/package.json` stays in the fast profile; a version or entry-point change gets the full one.

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

Local cached dependencies cannot measure `npm ci`, network clones, Actions image setup or Chromium download. The GitHub Actions UI reports each step's wall time. `tools/osd-suites.mjs` also prints per-test VSIX wall times, so a slow package case can be traced to its test. Do not treat the VSIX-only saving as a measured reduction of the whole CI job.

## Parallel suite workflow

The `tests` workflow has one `build` job that prepares the pinned transpiler, fetched packs and libraries, transpiles, lints, runs ABAP Unit and checks BAL across a restart. It uploads a tar of that run's built tree. Four independent `suites` jobs and one `e2e` browser job restore the same tar and run concurrently. A final job named `test` succeeds only when `build`, all four matrix jobs and `e2e` succeeded. This keeps the check name stable for branch protection.

The tar preserves `build/live` and `output` symlinks and executable bits, which a plain Actions artifact would lose. Each consumer runs `npm ci` with the setup-node cache, restores the pinned transpiler clone under `.local/ci-artifact/transpiler`, and relinks its compiled packages. Its Git metadata stays in the tar so diagnostics can identify the exact pin. The tar also contains `gen/`, `build/`, `.local/lars/`, and every fetched pack source folder from the pack manifests. A missing `gen/`, `output/`, live manifest, library folder, or transpiler build fails the restore step before tests start. The artifact is produced by this workflow run; a generation hash cache cannot accidentally supply another run's build. With four runners the measured weights are about 186 s per suite job, allowing them to overlap with browser work after the build job.

## Build and browser caches

The `tests` build job and `preview` job share an `actions/cache` entry for `../transpiler`. Its `transpiler-v1` key includes runner OS and architecture, Node major 22, the hash of `libs.lock.json` (which contains the pinned transpiler repository and commit), and the hash of `tools/osd-ci-transpiler-build.sh` (the clone, install and compile commands). On a miss the script builds the checkout. On every run, including a hit, it verifies the exact commit, installed dependencies, compiled JavaScript in all four packages, and the executable CLI before the three package links and `tools/osd-transpiler.mjs` run. The `tests` job still relocates that checkout into its per-run artifact; the cache never replaces the artifact consumed by the shards. A changed pin or build command creates a new key. To force a rebuild without changing either, increment `transpiler-v1` in both workflows.

The `tests` and `preview` browser jobs share `~/.cache/ms-playwright` through a `chromium-v1` key containing the runner OS and the installed `@playwright/test` version read from `package-lock.json`. A hit runs `npx playwright install-deps chromium` for uncached system packages; a miss runs `npx playwright install --with-deps chromium`. A Playwright version change creates a new key. To force a browser download, increment `chromium-v1` in both workflows. `release.yml` does not install Playwright, so it has no browser cache.

`tools/osd-suites.mjs --shard i/4` sorts files by measured wall time, longest first, then gives each file to the shard with the smallest assigned total. Ties use path order, so assignments are stable; each shard runs its assigned files in list order. A suite without a timing gets the median measured time and still runs. `--list-shard i/4` prints the assignment without running Mocha. Every invocation checks the complete `test/suites.json` against files on disk before selecting a shard, and `--report-skips` still names optional inputs absent on that runner. The ordinary VSIX profile still omits its four slow packaging groups; scheduled, manual, tag and packaging changes use the full profile.

To refresh the weights after building the tree and choosing a free port, run `STG_PORT=<free-port> node tools/osd-suites.mjs --timings test/suite-timings.json`. Run the complete list, without `--grep` or `--shard`. The reporter records each file's elapsed wall time including its hooks and inter-file overhead. Commit the new JSON and update the table below. These are local relative weights, not a CI wall-time prediction; runner load, profiles and suite interactions can change them.

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

## Next speed work

1. Record the times for transpiler preparation, transpile, lint, ABAP Unit, non-VSIX integration and browser smoke on the same runner before changing them.
2. The Test Explorer pool does not speed up CI's ABAP Unit command: CI calls `tools/osd-unit-run.mjs`, which launches one `output/index.mjs`. Only consider parallel CI ABAP Unit after isolated databases and the baseline time are measured.
3. Measure cold and warm cache timings on the same GitHub runner before treating the expected transpiler and Chromium savings as observed CI reductions.
