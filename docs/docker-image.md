# OSD image draft

One Node 24 image supports native SQLite (`STG_DB=file`), DuckDB and
HANA/HANA Express, and includes the DIAG/RFC stub binary. The HANA Stack
starts a separate SAP HANA Express container under SAP's terms. First target:
`linux/amd64`; ARM64 needs separate native DuckDB and protocol validation.

Short, complete Portainer stacks: [SQLite](../docker/compose.sqlite.yml),
[DuckDB](../docker/compose.duckdb.yml), [HANA](../docker/compose.hana.yml).
Their full contents are generated into [spin.md](spin.md). The older
`docker/Dockerfile` and `docker/compose.yml` remain the Bun release experiments;
the ready image uses `docker/image/Dockerfile` and the three named stacks.

## Build and automation

```sh
docker buildx build --platform linux/amd64 --load -f docker/image/Dockerfile -t osd:ci .
sh docker/image/smoke.sh
```

The GitHub Actions **OSD Docker draft** workflow builds and tests on the draft
branch and relevant PRs. PRs cannot publish. Pushes to `feat/docker-image`,
tags `osd-image-*`, or a manual run with `publish=true` publish only after
license inventory and smoke checks pass. The weekly scheduled run rebuilds
and tests but does not publish. Schedules become active after merge to the
default branch. A security update can use the manual publish path.

The GHCR name is `ghcr.io/oisee/open-steamgate`. Each publication has a unique
`sha-<commit>-run-<run-id>-<attempt>` tag and updates the convenience tag
`docker-draft`. The workflow retains an SPDX SBOM and a source/run provenance
record as artifacts. It transfers the exact smoke-tested image to a separate
publish job and verifies its ID; publication never rebuilds it. The action summary
prints `OSD_TAG`. The GHCR package must be public for anonymous Portainer pulls;
otherwise add GHCR credentials in Portainer. No Docker Hub account is needed.
The ready-image stacks set `pull_policy: always` for OSD, including the HXE
initializer, so a redeployment checks GHCR instead of reusing a stale local
`docker-draft`. Existing Portainer stacks need their pasted YAML updated, or
their `OSD_TAG` set to a newer immutable tag.
The older `open-steamgate-protocols` GHCR package remains a historical
artifact; these stacks neither pull it nor update it.

Library and protocol revisions are in `docker/image/sources.json`.
Node/Go/Debian base tags and the transpiler's npm install can resolve newer
patches; immutable published image digests, rather than a promise of
bit-identical rebuilds, identify deployed artifacts. This first draft keeps
the JavaScript tooling that ADT needs for parsing and activation; it is not
yet a size-optimized runtime. There are no OS compilers or git in the final
OSD stage, and no build happens during normal startup.

The image's `/opt/osd/image-licenses.json` and `/opt/protocols/licenses.json`
record source pins, installed npm/Go licenses, review blockers and explicit
assumptions; original library licenses remain beside the library files. The
repository owner authorized a temporary
MIT assumption for the pinned `oisee/open-abap-odata` and
`oisee/open-abap-gui` forks on 2026-09-20. Their original `LICENSE` files still
say `todo`; the manifest records this assumption rather than claiming an
upstream license grant. Other unrecognized
licenses block publishing. Entertainment packs and captured media are omitted.

## HANA configuration

The HANA demo Stack creates a *new* HANA Express server, an init container for
its password file, and OSD on the same private network. Only
`ACCEPT_SAP_LICENSE=YES` must be supplied manually after you accept SAP's
license. `HANA_PASSWORD` defaults to the known demo value
`OSD17_Demo!ChangeMe`; change it before first start outside a disposable,
isolated test environment. The SQL port is not published to the host. The
password is stored in the HXE volume and cannot be changed by merely editing
the Stack variable on a subsequent deployment. A cold HXE startup can take
several minutes; an orderly shutdown may also take a few minutes.

For an *existing* HANA server, configure the OSD image with `HANA_HOST`,
**tenant SQL** `HANA_PORT`, `HANA_USER`, `HANA_PASSWORD` and optionally
`HANA_SCHEMA` (default `OSD`) in your own Compose file. `localhost` inside OSD
refers to OSD, not to another container.

The adapter sets its current schema and creates it if permitted. Choose a
dedicated schema with an uppercase identifier; there is no table/schema-prefix
feature. The user needs the permissions to create/use the schema and create
and modify OSD tables. Avoid sharing a schema between independent instances.
As an alternative to environment passwords, mount a secret file and set
`OSD_HANA_PASSWORD_FILE`. Destructive `STG_DB_FRESH=1` is refused by the image.
The HXE image is pulled separately under SAP's terms; CI does not redistribute
or boot it. Test the full HXE Stack on a host with enough memory.

## Portainer acceptance

1. Select Docker Standalone on an amd64 host. Add a fresh `osd11` stack and
   paste the SQLite block from spin.md; instance `11` is already the default.
2. Confirm OSD becomes healthy. Open
   `http://<docker-host>:8011/app/flp.html`; trust the self-signed certificate
   to check HTTPS on 44311 as well. Set `TLS_SAN` to your hostname before
   first deployment; existing certificates are deliberately retained.
3. Open System Status → Database: expect connected `sqlite`, storage `file`.
   Read Travels, create a test travel, restart OSD, and confirm it remains.
4. Repeat with a new stack for DuckDB (default instance `15`): expect `duckdb` and
   `file`. Use exactly one worker for a writable DuckDB file.
5. Check TCP 32nn and 33nn. They are DIAG/RFC stub entry points; listening
   ports alone do not prove all SAP GUI/RFC functionality.
6. Use the HANA Stack (default instance `17`) after license acceptance, and
   verify `HDB` / `server` and a new HXE container.

Do not delete existing volumes or use `down -v` to upgrade a real stack.
Existing-volume schema upgrades are a separate release gate. For this draft,
persist database and TLS volumes; source/ADT edits inside the container are
ephemeral across container replacement. Internal HTTP/TLS ports stay fixed;
Compose derives the external ports from INSTANCE. Global identity/instance
harmonization in ABAP/System Status remains separate work.
