# Tests

`suites.json` names the root integration suites consumed by `tools/osd-suites.mjs`; `npm run integration` runs them. The runner checks the list against suites on disk. [CI tests](../docs/ci-tests.md) explains the runner and shard profile.

The root `*.mjs` suites cover individual tools and runtime paths. `mocha.mjs` exercises the OData wire path; `setup.mjs`, `run.mjs`, `start.mjs`, and `seed.mjs` provide harness and serving support. [The feature map](../docs/where-is.md) points from major features to selected suites.

`e2e/` holds browser-facing checks; root `preview-*.mjs` and `vscode-*.mjs` suites cover preview and extension behavior. See [VS Code](../docs/vscode-extension.md) and [preview deployments](../docs/preview-deployments.md).

`fixtures/`, `helpers/`, `unit/`, and `integration/` provide inputs and supporting checks. The suite declarations remain in `suites.json` when adding a new root suite.

`conformance/` holds HTTP conformance cases and a runner for a base URL; `scratch/` holds bootstrap checks. See [the conformance suite](../docs/conformance.md).
