# Database upgrades at startup

An upgrade migrates individual tables. It never moves a database to `.drift`
or starts an empty replacement database because its DDIC changed.
`test/setup.mjs` calls `startupDatabase()` in `tools/osd-db-migrate.mjs` for
native file SQLite and persistent DuckDB and PostgreSQL. SQLite without a
path and in-memory DuckDB keep their existing initialization paths. The
browser preview keeps its existing storage/reset policy.

## Comparing schemas

`osd_schema` remains the whole-schema compatibility stamp. On an upgrade,
`osd_schema_tables` records each generated table's DDL and fingerprint, plus
generation-owned index definitions. A pre-ledger database is read from its
catalog: SQLite `sqlite_master`, DuckDB `duckdb_tables()`/`duckdb_indexes()`,
and PostgreSQL `information_schema` and `pg_catalog`. Unsupported DDL shapes
fail the startup transaction rather than guessing that a table is disposable.

Before classification, startup verifies ownership under the same lock as its
stamp read. An occupied database without a populated OSD schema stamp or
recognized identity is refused with `DATABASE_NOT_OWNED`, before any DDL,
metadata deletion or reseeding. PostgreSQL checks relations in every user
schema, including those outside `search_path`. Native SQLite, snapshots and
DuckDB use the same guard. Empty stamp/identity tables do not establish
ownership. A populated `zosd_job_source_instance` with a 32-hex ID is an
identity; old DuckDB/HANA releases used the `ZSTG_DEMO` table as their explicit
schema identity, and that historical contract remains accepted. TADIR and
the other derived-table names establish no ownership by themselves.

The classifier compares columns, primary keys, types, defaults, nullability
and constraints. Column order is immaterial; SQL quoting is parsed, including
commas in precision declarations and defaults. A missing table, a nullable
or defaulted column, and a wider character/hex-storage column keep existing
rows. SQLite lacks `ALTER TYPE`: widening copies rows into the new definition
under a savepoint. It captures views and triggers (including indirect
dependencies and triggers on views), drops them before replacing the table,
and restores them and the indexes after the rename. Foreign keys are disabled
before BEGIN, checked before COMMIT and restored to the connection's original
setting on commit or rollback, so a parent rebuild cannot cascade-delete
child rows. DuckDB VARCHAR widths are
unenforced, so widening only changes the recorded DDIC. A defaulted required
column on DuckDB is added with its default before setting NOT NULL.

DuckDB's old catalog does not retain declared VARCHAR lengths. Its first
ledger bootstrap compares the physical types; it cannot reconstruct a lost
DDIC width. Subsequent upgrades use the ledger and detect narrowing. CHAR,
NUMC and RAW are represented by their generated character/hex SQL types;
changing a DDIC category that generates identical SQL needs no physical DDL.

A changed key, narrower/different type, removed column, or changed constraint
is incompatible. Tables populated by the transpiler's generated INSERTs
(TADIR, REPOSRC, WWWPARAMS, etc.) and explicitly derived runtime inventory
(status tables, CROSS/WBCROSSGT/WBCROSSGTX/D010INC and the APC inventory)
are rebuilt. Ownership is never inferred from a customer-table prefix.

Other incompatible tables are renamed to `<table>__drift_<old-ddl-fingerprint>`
and recreated with the wanted definition. Names are shortened for PostgreSQL's
63-byte limit; numeric suffixes prevent overwriting an earlier backup.
PostgreSQL primary/index names are renamed too, freeing the replacement's
constraint names. Only new/recreated tables receive ordinary seed rows.
Unchanged application tables and unknown tables retain their rows. Pack
reseeding during migration is scoped to generated or new/replaced tables;
editing a pack capture never overwrites committed rows of a surviving
application table at startup. Explicit reseed/reset callers retain their own
policies.
`STG_DB_STRICT=1` refuses an incompatible data-table change and rolls back the
whole startup; compatible changes still proceed.

Indexes recorded in the ledger can be added, replaced or removed independently
of table data. Unknown user indexes are preserved. The first bootstrap cannot
infer which historical indexes belonged to a generation that kept no ledger.
Generation-owned views are recreated in dependency order, within the same
transaction. Unknown views are retained. The explicit historical reserved-word
column renames remain supported, including renames of key columns.

The former job migrations are covered by the same plan. Added job fields get
ABAP initial values; INPUT_JSON gets `[]`. Creation of the permanent job
identity table backfills old outbox identities. The merged ADT CHAR36-to-CHAR40
change is ordinary widening and retains opaque handles. Legacy migration
exports live in `tools/osd-db-legacy.mjs` for existing callers/tests; runtime
startup does not run a second one-off migration chain.

## Upgrade notes

The occupied-database guard inspects all user schemas in the target DuckDB
or PostgreSQL database and every SQLite attachment, including tables outside
the default schema. DuckDB's information schema excludes internal objects;
system schemas are excluded explicitly. Historical identities must belong
to the runtime's own schema.

A legacy partially initialized database from before schema stamps existed
may have tables but no recognized identity. Startup refuses it and names the
database file, explains the missing stamp/identity, and gives recovery steps.
Keep the old file, start fresh at a different database path, then copy the
application rows after checking the new table definitions. Do not remove the
old file or manufacture a stamp to bypass the ownership check.

SQLite validates foreign keys before every startup commit while enforcement
is disabled, including generated metadata refresh with unchanged table DDL.
A failed check rolls back refreshed rows and stamps together and restores
the connection's foreign-key setting.

## One startup transaction

The lock is acquired **before any stamp or catalog read** and held through
classification, all DDL, generation-owned metadata refresh, pack reseeding,
job backfills, drift reporting records, and restamping. Seed helpers cannot
commit this transaction. Any failure rolls the whole chain back.

* SQLite: `BEGIN IMMEDIATE`, table savepoints, the existing busy timeout,
  and one COMMIT. A waiting process rereads the stamp under its acquired lock.
  Base images are published/copied using an atomic link; an existing database
  is never overwritten. Each copy allocates its own job event source identity.
* PostgreSQL: one checked-out connection and a transaction-scoped advisory lock
  `(1869833316, 1)`, at the normal READ COMMITTED isolation level. Every statement
  uses that connection; rollback/commit releases the lock.
* DuckDB: a file permits one writer **process**, not just one startup writer.
  A private local writer process owns the native instance. Runtimes connect
  over a Unix socket and get separate native connections. A writer-side
  advisory mutex waits for active LUWs/queries and fences startup against all other connections. The schema
  work is one native transaction. Disconnect/crash rolls back before releasing
  a held startup mutex. The writer exits when its last client disconnects;
  the native file lock elects one writer when starts overlap. Socket files
  live in a private temporary directory and are removed when the writer exits.
  A writer failure fails its clients rather than reconnecting/replaying an
  uncertain write. External tools opening the native file must wait for the
  runtime writer to close. This transport currently targets Unix hosts.

These locking rules follow the engines' documented
[DuckDB concurrency limits](https://duckdb.org/docs/stable/connect/concurrency)
and [PostgreSQL advisory-lock semantics](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

`osd_schema_boot` fingerprints DDL, generated rows and seed rows. A waiter
whose boot fingerprint is already current skips migration and metadata
refresh; changed source/seed rows refresh under the same startup transaction.
The unchanged-start path makes a bounded set of stamp/status queries, without
walking every table's catalog or executing generated INSERTs again.
The runtime's later ICF/xref/status writers retain their own transaction/LUW
rules; they do not decide schema drift or publish schema stamps.

Node's legacy `STG_DB_PATH` without a backend (or with `STG_DB=sqlite`) opens the native
SQLite file path too, so its startup receives the same lock. Direct sql.js
snapshot callers of `loadInto()` use the per-table planner on their private
heap; exporting snapshots is still a single-owner API, not a multi-process
file-writing interface. Existing snapshots remain readable by native SQLite.

## Reporting and recovery

Every set-aside data table is logged by table/backup name **after commit**.
`osd_schema_drift` keeps table name, backup name, reason and migration time.
The connected database identity carries these records through `/osd/serving`;
the existing system status adds a `Database migration` row for each backup,
including when the database is served by a child process and after restart.
No absolute database paths or connection details are included in those rows.
A user can inspect/copy rows from the named backup and reconcile them with
the new definition. Migration never deletes those backups automatically.

HANA continues its existing missing-table and historical-rename checks and
explicit fresh-schema option. Its DDL has implicit transaction boundaries;
this implementation does **not** provide automatic generic HANA upgrades or
cross-process HANA startup locking. It refuses known unsupported old shapes
rather than claiming transactional migration. Its schema check now verifies
ownership in the connection's startup transaction before any reseed; it
accepts a populated stamp or the historical identity and refuses a foreign
TADIR. No local HANA server was used.

## Validation

`test/db-migration-startup.mjs` covers compatible changes, incompatible data
backups/status, regenerated tables, indexes, transaction rollback, unknown
unstamped tables, no-op starts, and two serving processes on one SQLite or
DuckDB file. It tests simultaneous starts and a reader connected before
another process migrates. PostgreSQL has catalog/session fixtures for locking,
in-place DDL, table/index backups, generated refresh ordering and rollback;
there is no local PostgreSQL server/toolchain in this workspace.

The pre-fix SQLite UNIQUE race was reproduced from main's actual
`refreshGenerated()` function with a barrier after both connections' DELETEs:
`UNIQUE constraint failed: tadir.pgmid, tadir.object, tadir.obj_name`.
The old ADT migration suite now keeps widened handles, checks transactional
rollback, and places its stale-read gate before lock acquisition. The cold
session-publication test expects a new table to preserve the SQLite file.

An upgrade fixture was built locally from public main commit
`26b74e6556b28a2aaecb04703159de76d279131e` (2026-10-01), using the available
local toolchain. Its real generated DDL and seeded data were written by that
revision's startup into both database formats. An inserted ZSTG_DEMO row with
TRAVEL_ID `99999999` survived the DuckDB upgrade. Actual incompatible changes
in ZOSD_L3_ALERT (key) and ZOSD_LIFT_R2 (removed LABEL) produced only table
backups; the old file itself stayed in place. New generated tables were
created and the catalog refreshed. The fixture and run logs stay gitignored.

The SQLite upgrade of the same old revision also retained that row and
refreshed TADIR to 2,222 objects. Both engines reported the two genuinely
incompatible tables; neither renamed the database file. The new two-process
serving fixtures verify one migration, two successful HTTP readers and no
`.drift` files, including the stale-reader interleaving.

Unchanged-start timing used the current generation's actual DDL/INSERTs and
seed rows, with six setup calls per implementation (the first creates/opens
the file; the other five are unchanged). Main at `d1a49bb5` had a **163 ms**
median (154, 158, 163, 171, 173 ms). This implementation had **146 ms**
(146, 156, 149, 130, 139 ms), approximately 10% less. First-start times were
555 and 558 ms. These are local database-setup measurements, excluding class
loading and HTTP listener startup; they do not claim a remote deployment
benchmark. The no-change path met the existing startup cost.

Focused database/LUW/identity/session checks passed 144 tests (one existing
optional PostgreSQL test pending); the focused migration/native/snapshot
checks passed 101 tests. Jobs passed 221 tests with 18 existing pending tests.
The ADT upgrade suite passed 21 tests, and cold publication passed all six
one-runtime tests. In mode 0, the in-memory profile passed three tests; the
file profile initially hit the runtime's unchanged 60-second silent-start
limit, then passed all three on an isolated rerun at the same limits. No
required check was removed or disabled. The suite-list and changed-file size
checks passed, with six inherited size breaches reported on main. Structural
leak checks found no matches; this workspace has no private identifier list.
GitHub/PR/issue operations and pushes were not performed.

The final advisory/LUW, migration, identity and seed-path rerun passed 64/64
tests, including startup waiting for an active DuckDB application LUW.

The round-two ownership/view regressions failed on the original implementation
(four foreign-database guards and SQLite's missing-table view error). The
corrected database/migration/identity/seed/LUW/dialect run passes 152 tests with
the repository's isolation checks. ADT upgrade passes 21 tests, sessions pass
35, and jobs pass 221 with 18 existing pending cases. The initial combined ADT
command reached its outer timeout and eight job tests exceeded their existing
two-second limit; isolated reruns passed without changing those limits.
Isolation also exposed an exiting DuckDB writer: the last disconnect now
awaits locally spawned writer processes. The concurrency fixture awaits its
forked workers and reports HTTP shutdown completion only after database
disconnect, avoiding a reconnect into a closing writer. Both simultaneous
starts and stale-reader interleavings pass on SQLite and DuckDB.

A further unchanged-start sample measured 129 ms median (129, 138, 126, 131,
128 ms), against the recorded 163 ms main baseline; first start was 489 ms.
PostgreSQL and HANA ownership coverage uses catalogue fixtures, not live
servers. Suites registration, changed-file size guard and diff whitespace
checks pass. Structural leak scanning finds no matches; the private identifier
list remains unavailable.

Rebased onto `origin/main` at `e4a8d8e1`. The post-rebase migration/identity/
seed/operations-lock run passes 97 tests, including the SQLite and DuckDB
two-process cases and main's new atomic operations-schema publication tests.
Suite registration lists 306 ordinary suites and seven grouped suites. The
changed-file size guard passes with five inherited main breaches; migration
implementation and concurrency-fixture blobs were unchanged by the rebase.

Round-three fixes validate SQLite foreign keys before every startup commit,
including refreshes with unchanged DDL, and reject occupied DuckDB user
schemas and SQLite attachments. Four new regressions cover the orphaned-row
refresh and other-schema guards for SQLite, DuckDB and PostgreSQL; the three
SQLite/DuckDB defect regressions failed before the fixes. The focused startup,
DuckDB migration, ADT handle, native SQLite and snapshot run passes 105 tests
with isolation checks, including both engines' concurrency/stale-stamp cases.
Suite registration and the changed-file size guard pass (five inherited main
breaches); diff whitespace checks pass. PostgreSQL coverage remains a catalog
fixture. No pushes, issues or PR operations were performed.
