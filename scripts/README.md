# Build and release scripts

`build-vsix.mjs`, `install-vsix.mjs`, and `build-vscode-web.mjs` package the extension and its web surface. See [VS Code extension](../docs/vscode-extension.md), [VS Code web](../docs/vscode-web.md), and [CI tests](../docs/ci-tests.md).

`build-binary.mjs`, `build-sea.mjs`, `build-preview.mjs`, `serve-build.mjs`, and `check-hosts.mjs` build and exercise executable or browser hosts. [Preview deployments](../docs/preview-deployments.md) covers the browser path.

`release/`, `make-release.mjs`, `release-notes.mjs`, `release-version.mjs`, and `third-party-notices.mjs` prepare and check release artifacts. See [release](../docs/release.md).

`pages-index.mjs`, `pages-push.mjs`, and `capture-docs-shots.mjs` prepare the published preview and its documentation images. See [preview deployments](../docs/preview-deployments.md).

`zvdb-*.mjs`, `bench-hosts.mjs`, `run-e2e-isolated.mjs`, and `capture-*.mjs` run data, benchmark, browser, and documentation probes. [The feature map](../docs/where-is.md) links the main commands to their tests and documents.
