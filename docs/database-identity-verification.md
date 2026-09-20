# Database identity: implementation checkpoint

Local work, 2026-09-20. Not published; not a ready Docker image.

The adapter reports its engine after connection. DuckDB sets `sy-dbsys`
to `duckdb`; existing identifiers remain `sqlite` and `HDB`. System Status
has a read-only Database facet and `DatabaseSet`, backed by the existing
`ZOSD_DB` table. Public facts contain engine and storage category, not
paths, hosts, credentials or schema names. ABAP snapshot serialization now
includes database rows.

## Verified

- `node_modules/.bin/mocha test/database-identity.mjs test/osd-status.mjs`:
  25 tests pass, including failed SQLite/DuckDB connections and mocked HANA.
  HANA was not contacted.
- `node_modules/.bin/mocha test/database-identity-host.mjs`: two real-child
  tests pass (SQLite and DuckDB), through the safe descriptor, snapshot,
  ABAP refresh, `DatabaseSet` and expanded `SystemSet`. Contradictory facade
  configuration does not override the actual engine. Temporary database
  files are isolated and removed after each test.
- `npm run transpile`: succeeds; `npm run lint`: zero issues.
- Four `ZCL_OSD_STATUS` ABAP tests execute successfully with both native
  SQLite in memory and DuckDB in memory, including database roundtrip.
- Inline SQLite HTTP: `DatabaseSet` and `SystemSet?$expand=to_Database`
  return connected SQLite facts.
- Inline DuckDB HTTP: both queries return connected DuckDB facts, but the
  subsequent disconnect fails with `cannot commit - no transaction is
  active`. This probe is **not** a clean passing run; teardown needs investigation.
- Browser facet check passes:

  ```sh
  status_probe_dir=$(mktemp -d /tmp/osd-status-ui-XXXXXX)
  STG_DB=file STG_DB_PATH="$status_probe_dir/osd.sqlite" STG_PORT=31387 STG_TLS=0 STG_SERVE=inline \
    node_modules/.bin/playwright test test/e2e/status.spec.mjs
  ```

  The same spec also passes with `STG_DB=duckdb`, `STG_SERVE=child`,
  `OSD_WORKERS=1`, and a fresh absolute temporary database path.
  Sol's independent review found no blocking defects in this bounded slice.

These probes do not use an existing stack volume. The HTTP/browser startup
also created a repository-root SQLite file literally named `:memory:`; that
artifact was moved outside the checkout to `/tmp` for inspection. Therefore
`STG_DB_PATH=:memory:` is not a reliable whole-host isolation recipe yet;
use a fresh absolute path under `mktemp -d` for future host checks.
The stock unit runner with `STG_DB=sqlite` reported zero executed test classes;
it is not counted as a passing full-suite run.

## Still required

The child-process host now passes its safe connected descriptor through the
existing `/osd/serving` endpoint. Status retrieval has a one-second timeout,
requires loopback HTTP without redirects, and checks readiness and generation.
An unavailable or not-yet-started child falls back to explicitly unobserved
configuration; the next refresh after readiness can observe it. This does not
change startup order. Global identity/instance configuration is unchanged.

No table schema was changed in this slice. A new CDS projection exposes the
existing table; existing-volume upgrades have not been tested. Do not delete
or freshen a user's volume to apply this work.

The new adapter and host suites still need registration in the shared suite manifest
by its owner. Publication and Portainer image verification remain separate.
