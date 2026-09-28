# VS Code prerelease

For a local Marketplace candidate, run `npm run vsix:marketplace` after
`npm run bootstrap`. This profile includes the Zork pack with its Zork I story
rebuilt from Microsoft's MIT source release, omits the browser entry,
adds the VS Code prerelease manifest property, and writes staged
`THIRD-PARTY-NOTICES.md`. Review the build's `LICENSE REVIEW` lines before
uploading anything. This command does not publish; the release workflow below
continues to build its separate GitHub prerelease VSIX.

## Marketplace screenshots

Capture these in VS Code desktop with the window set to 1280x800. Save each
as a PNG at the path shown, then add its HTTPS raw GitHub URL to
`editors/vscode/README.md` in place of the matching pending-capture comment.

| View to capture | PNG path |
| --- | --- |
| OSD Activity Bar tree with a service selected and its service card visible | `editors/vscode/media/screenshots/tree-service-card.png` |
| Run with Debugger stopped on an ABAP source line, with the debug controls and variables visible | `editors/vscode/media/screenshots/debugger-abap-line.png` |

The Fiori list report image at `editors/vscode/media/screenshots/fiori-list-report.png`
is already a real capture and remains in the Marketplace README.

The [release workflow](../.github/workflows/release.yml) publishes a GitHub
prerelease. It does not publish to the VS Code Marketplace. The release tag
must be `vscode-v<major>.<minor>.<patch>`. The major and minor come from
`editors/vscode/package.json`; `scripts/build-vsix.mjs` stamps patch from
`git rev-list --count HEAD`. The workflow checks the tag against that version
and checks the VSIX filename and packaged manifest. Full git history is
required for this count.

## Cut or repeat a release

To publish a tagged prerelease, merge the intended code, then calculate and
push the tag on that commit:

```sh
tag="$(node scripts/release-version.mjs --suggest)"
git tag "$tag"
git push origin "$tag"
```

A `vscode-v*` tag push builds a draft prerelease and publishes it only after
the VSIX, binary, and Compose uploads all succeed. To prepare a draft
without pushing a tag, run **VS Code prerelease** from the intended branch.
Leave `tag` blank to derive the stamped version from that ref, and leave
`draft` true. You may enter a tag, but it must match the version of the
selected ref; any existing tag must point to that commit. The workflow uses
`gh release create --draft --prerelease --target <commit>` and never runs
`git push`. For an untagged draft, GitHub creates the tag when the draft is
published. A dispatch with `draft=true` does not change the release's draft
state. To publish an existing draft through the workflow, rerun with
`draft=false`; a new dispatch must first create the draft. An existing release
is updated only when its commit matches the run's checkout commit. When the
tag exists, the workflow fetches
tags and compares the commit resolved from `refs/tags/<tag>^{commit}`. For an
untagged draft, it requires the release's recorded `targetCommitish` to be
the exact checkout SHA and the release to remain a draft. Same-named assets
are uploaded
with `--clobber` on every rerun. Do not move a published tag.

The VSIX job installs dependencies with Node 24, runs `npm run bootstrap`
for the pinned libraries and packs in `libs.lock.json`, and builds the VSIX.
Before creating or editing a release, it generates CHANGELOG.md from first-parent
GitHub PR merge titles since the nearest previous `vscode-v*` tag. A merge
commit without a title in its body gets its title from the PR API. Squash
commits and manually copied changes have no PR merge commit and do not
appear. The generated CHANGELOG.md, release README, and `FILE_ID.DIZ` pass through
`tools/osd-leak-scan.mjs --paths` before release creation. Configure the
repository secret `OSD_LEAK_IDENTIFIERS` with the JSON content of
`.local/leak-identifiers.json` (an object whose keys name identifier kinds and
whose values are arrays of private names). The VSIX job writes that content
to the gitignored file on its runner. A dispatch with `draft=true` may continue
on scan exit 2 when this secret is absent only if the release is new or remains
a draft; the job warns that the private name check did not run. Before editing
or uploading assets to an existing published release, including on a
`draft=true` dispatch, the workflow requires the secret and scan exit 0 over
all three files. It checks release state again before each upload, so an
exit-2 run stops if the release has since been published. Publication by tag
push or dispatch with `draft=false` has the same full-scan requirement.
Without the secret, the workflow fails with instructions to add it or publish
by hand after a local `npm run leak`. A match (exit 1) always stops the release.

## Assets

| Asset | Build or source |
| --- | --- |
| `open-steamgate-<version>.vsix` and `.sha256` | Universal VS Code extension, version checked against the tag |
| `osd-linux-x64`, `osd-linux-arm64`, `osd-darwin-arm64`, `osd-windows-x64.exe`, each with `.sha256` | `npm run bootstrap`, then `npm run binary -- --seed <output> <bun-target>` with Bun 1.4.2 |
| `sqlite.yml`, `duckdb.yml`, `postgres.yml`, `hana.yml` | [Tracked Compose sources](../docker/compose/), validated with `docker compose config` |
| `README.md` | Short instructions for starting every asset, also included in the release notes |
| `CHANGELOG.md` | Merged PR titles since the previous prerelease; the release body points to it |
| `FILE_ID.DIZ` | Classic BBS description generated from the version, with printable ASCII and CRLF lines |

The binary and Compose jobs start after the VSIX job creates the draft.
The final publish job needs all three upload jobs, so a failed upload leaves
the draft unpublished. Rerun the workflow to fill or replace assets. An
already published release is updated in place on reruns. Each checksum is
`sha256sum` output with the corresponding asset basename.

`npm run binary` defaults to checkout mode: it builds from a fresh checkout
after `npm ci`, without `.local/lars` or an embedded system seed. Run that
binary from an open-steamgate checkout. `--seed` (or `OSD_BINARY_SEED=1`)
requires the bootstrapped libraries and packs and embeds the seed. Run
`osd doctor` to see which mode a binary contains.

The measured seeded Linux x64 binary is 109.5 MB (decimal). All four requested Bun targets cross-compiled on Linux x64 with Bun 1.4.2
in the local release check. No target failed to build. Only Linux x64 was
built on its native host; cross-compilation does not prove that Linux arm64,
macOS arm64, or Windows x64 starts successfully. The binaries contain the
system seed, including source, selected packs, tools, data, and pinned library
sources. On first start outside a checkout, the seed is copied into a
content-keyed `osd-home-<seedId>` under `$XDG_DATA_HOME/open-steamgate` or
`~/.local/share/open-steamgate` on Linux, `~/Library/Application Support/open-steamgate`
on macOS, and `%LOCALAPPDATA%\\open-steamgate` on Windows. Existing copies and
edits are retained. Run `osd up --layer <dir>` to add an ABAP folder above the
seed; repeat the option or use `OSD_LAYERS` with the platform path separator.
Copy an object's abapGit file from the materialized home into your layer to
edit it. The binary excludes the optional native DuckDB
module; the DuckDB Compose variant uses the Docker image instead.

The Compose files use the image already published by the Docker multiarch
workflow, `ghcr.io/oisee/open-steamgate:showcase-draft`, by default. This moving
image tag includes the optional showcase packs and is independent of the VS Code
tag. Set `OSD_TAG=draft` for the core image, or set it to a tested
`sha-...-run-...` tag from the Docker publication workflow to pin it. SQLite
is the default file backend. PostgreSQL starts a database in the stack and
requires `POSTGRES_PASSWORD` in the caller's environment. HANA connects to
an existing tenant and requires `HANA_HOST`, `HANA_USER`, and
`HANA_PASSWORD` in the environment; `HANA_PORT` and `HANA_SCHEMA` are
optional. The HANA file carries no server address or credential value. Run
one variant at a time, for example:

```sh
docker compose -f sqlite.yml up -d
```

The release workflow does not build or publish Docker images or create a
HANA server.
