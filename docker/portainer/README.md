# Legacy source-bootstrap Portainer stacks

For the shorter, published-image stacks start with [Spin up OSD](../../docs/spin.md).
The files in this directory are the older source-bootstrap alternative.

Paste an entire `compose.*.yml` into the Stack Web editor on Docker Standalone.
Set `INSTANCE=06` in Environment variables (default `00`). No local image,
`OSD_SUITE_IMAGE`, host file or Caddy is needed. Public Node/Go images download
and compile the sources at first startup; internet access is required.

HANA additionally requires `HANA_PASSWORD` and `ACCEPT_SAP_LICENSE=YES` after
accepting SAP's license. Its password file is created in a named volume.

These bootstrap stacks have not yet been booted end-to-end in Docker here.
The published-image stacks were smoke-tested with SQLite, DuckDB and an
external HANA Express server.
