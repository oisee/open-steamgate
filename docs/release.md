# VS Code prerelease by tag

The [release workflow](../.github/workflows/release.yml) publishes a GitHub
**prerelease** for an existing `vscode-v<major>.<minor>.<patch>` tag. It does
not publish to the VS Code Marketplace. The repository's `editors/vscode/package.json`
supplies major and minor; `scripts/build-vsix.mjs` stamps patch from
`git rev-list --count HEAD`. The workflow checks that the tag equals this
version before building, then checks the packaged filename and manifest.
It fails with the expected tag if they differ. A full-history checkout is
required for this count.

## Cut or repeat a release

1. Merge the intended code, then calculate the tag on that commit:

   ```sh
   version="$(node -p 'const p=require("./editors/vscode/package.json"); p.version.split(".").slice(0,2).join(".")')"
   tag="vscode-v${version}.$(git rev-list --count HEAD)"
   git tag "$tag"
   git push origin "$tag"
   ```

2. The tag push starts the workflow. To retry, run **VS Code prerelease**
   with **Run workflow** and enter the existing tag. The dispatcher checks
   out that tag; it does not use the branch selected in the UI as release
   content. It updates the existing prerelease and replaces assets of the
   same name. Do not move a published tag: the release must keep pointing at
   the commit whose count named it.

The VSIX job installs dependencies with Node 24, runs `npm run bootstrap`
to materialize the pinned source libraries and packs from `libs.lock.json`,
then runs `npm run vsix`. Before publishing, it generates release notes from
the titles in GitHub PR merge commits on the first-parent line since the
nearest previous `vscode-v*` tag. A merge commit without a title in its body
is resolved through `gh api` using the PR number. For the first release it
uses all history.
Squash commits and manually copied changes have no PR merge commit and will
not appear. The generated notes file goes through
`tools/osd-leak-scan.mjs --paths`; a match stops publication. On CI the
private identifier list is absent, so the scan's structural checks run and
its documented exit status 2 is accepted.

## Assets

| Asset | Build or source |
| --- | --- |
| `osd-vscode-<version>.vsix` and `.sha256` | Universal VS Code extension, version checked against the tag |
| `osd-linux-x64`, `osd-linux-arm64`, `osd-darwin-arm64`, `osd-windows-x64.exe`, each with `.sha256` | `npm run binary -- <output> <bun-target>` using Bun 1.4.2 |
| `sqlite.yml`, `duckdb.yml`, `postgres.yml`, `hana.yml` | [Tracked Compose sources](../docker/compose/), validated with `docker compose config` |

The binary and Compose jobs start after the VSIX job has created the
prerelease. A failed later job can leave a partial prerelease; dispatch the
same tag to fill or replace its assets. Each checksum file is the output of
`sha256sum` on the corresponding asset basename.

All four requested Bun targets cross-compiled on Linux x64 with Bun 1.4.2
in the local release check. Only Linux x64 was built on its native host;
cross-compilation does not prove that Linux arm64, macOS arm64, or Windows
x64 starts successfully. The compiled binary excludes the optional native
DuckDB module, so the DuckDB Compose variant uses the Docker image instead.
No other binary targets have been checked.

The Compose files use the image already published by the Docker workflows,
`ghcr.io/oisee/open-steamgate:draft`, by default. This is a moving image tag
and is independent of the VS Code tag. Set `OSD_TAG` to a tested `sha-...-run-...`
tag from the Docker publication workflow to pin the image. SQLite is the
default file backend. PostgreSQL starts a database in the Compose stack and
requires `POSTGRES_PASSWORD` in the caller's environment. HANA connects to
an existing tenant and requires `HANA_HOST` and `HANA_PASSWORD` in the
environment; `HANA_PORT`, `HANA_USER`, and `HANA_SCHEMA` can also be set.
The HANA file carries no server address or credential value. Run one variant
at a time, for example:

```sh
docker compose -f sqlite.yml up -d
```

The release workflow does not build or publish Docker images and does not
create a HANA server.
