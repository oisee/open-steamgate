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

The job took 914 s (15 min 14 s) end to end. Integration suites accounted for about 78% of it. The fast profile changes only that stage; it does not speed up the 14 s ABAP Unit stage. A same-runner after measurement is still needed before claiming a whole-job saving.

Local cached dependencies cannot measure `npm ci`, network clones, Actions image setup or Chromium download. The GitHub Actions UI reports each step's wall time. `tools/osd-suites.mjs` also prints per-test VSIX wall times, so a slow package case can be traced to its test. Do not treat the VSIX-only saving as a measured reduction of the whole CI job.

## Next speed work

1. Record the times for transpiler preparation, transpile, lint, ABAP Unit, non-VSIX integration and browser smoke on the same runner before changing them.
2. The Test Explorer pool does not speed up CI's ABAP Unit command: CI calls `tools/osd-unit-run.mjs`, which launches one `output/index.mjs`. Only consider parallel CI ABAP Unit after isolated databases and the baseline time are measured.
3. Cache the compiled pinned transpiler across workflows by its lock SHA if its outputs can be reproduced and validated. The `tests` and `preview` workflows currently prepare it separately.
4. Shard integration suites only after each shard has separate database files, ports and generated output. Plain Mocha parallel mode would race over this checkout.
