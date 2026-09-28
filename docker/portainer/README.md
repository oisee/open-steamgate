# Portainer: four ready stacks

Paste one complete file into **Stacks → Add stack → Web editor** on Docker
Standalone (Linux amd64):

- [SQLite](compose.sqlite.yml): instance 11, open `http://DOCKER-HOST:8011/app/flp.html`.
- [DuckDB](compose.duckdb.yml): instance 15, open `http://DOCKER-HOST:8015/app/flp.html`.
- [New HANA Express + OSD](compose.hana.yml): instance 17, open
  `http://DOCKER-HOST:8017/app/flp.html`. Set `ACCEPT_SAP_LICENSE=YES` after
  accepting SAP's license; allow several minutes for HXE's first start.
- [New PostgreSQL + OSD](compose.postgres.yml): instance 19, open
  `http://DOCKER-HOST:8019/app/flp.html`. The SQL port stays private.

All four use the same ready OSD image, including DIAG/RFC. HANA's short-lived
`hana-init` service uses that image too; `Exited (0)` is its successful state.
The SQL server is a separate SAP image. No source compilation happens on start.

The default `showcase-draft` image includes Vivid Vibes, Zork and Vector
workbench with their compiled ABAP, data and web assets. Set the Stack
variable `OSD_TAG=draft` for the smaller core image. Start a new Stack or back
up the existing database first: the Vector workbench adds a table, and
changing the tag does not migrate an existing database schema. For an existing
HANA Stack, set a fresh `HANA_SCHEMA`, for example `OSD_SHOWCASE`.

These files are generated copies of `docker/compose.*.yml`. Update the source
files and run `node scripts/sync-spin.mjs`; CI verifies both copies and the
full YAML blocks in [spin.md](../../docs/spin.md).

The old source-building Compose files are retained in Git history. The local
source installation helper [setup-local.sh](setup-local.sh) remains available.
For the built-in local DIAG/RFC ports, see the
[local instructions](../../docs/spin.md#locally-without-docker).
