# Working in this repository

Read `CLAUDE.md` for the project and safety rules. The user's current request takes priority.

## Test frequency

Use focused tests while changing code. Before a PR, run the checks that exercise the changed path. `.github/workflows/tests.yml` runs a fast VSIX profile on ordinary changes and the full install/repackage scenarios on packaging changes, weekly, manually, and on `vscode-v*` tags. Do not remove or silently skip a failing required check to make a PR mergeable. See `docs/ci-tests.md` for the exact split and measured cost.

Keep new `test/*.mjs` suites in `test/suites.json`; the suite runner checks that list against the files on disk.

## Overall status reports

When the user asks where the project stands, use a compact feature tree. Group merged work, current PRs/spikes, and plans under stable areas such as engine/execution, layers/packaging/CI, ABAP Unit/debugging, desktop VS Code, vscode.dev, and operations (BAL/jobs/daemons). Say what each PR or branch does alongside its number, rather than giving a bare list of numbers. Include the current `main` HEAD and distinguish implemented behavior from plans. Verify Git and GitHub before reporting live status.
