# SQLite connection semantics

Both ABAP-facing SQLite clients import `tools/sqlite-connection.mjs`.
The ADT front kernel also constructs the shared sql.js client; native-channel
setup calls the same hook, including SQLScript probes with raw sql.js databases.
Connection setup is also needed after sql.js export: its export closes and
reopens the SQLite connection, discarding connection pragmas.

## LIKE

The A4H measurement in [osql-where.md](osql-where.md) selected 0 rows for
`carrid LIKE 'l%'` and 32 for `carrid LIKE 'L%'`. The upstream sql.js
adapter selected `'A' LIKE 'a'` as true; the file adapter selected false
because it enabled `case_sensitive_like`. There was no GLOB lowering.

Bundled sql.js 1.14.2 uses SQLite 3.49.1; this Node installation uses
SQLite 3.53.4. Neither lists `SQLITE_OMIT_DEPRECATED`, and both implement
`PRAGMA case_sensitive_like = ON`. SQLite [deprecates it](https://www.sqlite.org/pragma.html#pragma_case_sensitive_like)
and allows builds to omit it, so the shared hook sets it on every connection
and verifies `'A' LIKE 'a' = 0` and `'A' LIKE 'A' = 1`. If a future build
ignores the pragma, connection setup fails with an explicit diagnostic. The
raw sql.js native setup and export/reconnect paths use the same hook.

Keeping SQLite's own LIKE preserves `%`, `_`, ESCAPE, NULL, Unicode and
SQLite value conversion: `1.0 LIKE '1.0' = 1`. A JavaScript override loses
REAL formatting and disables the indexed prefix optimisation. For an indexed
TEXT column, both bundled engines now report
`SEARCH prefix_probe USING COVERING INDEX prefix_value (value>? AND value<?)`
for `value LIKE 'ABC%'`, instead of `SCAN prefix_probe`.

SADL OData `$filter` string functions use the same case-sensitive Open SQL
semantics. The HTTP regression checks `startswith(DESCRIPTION,'Berlin')`
and `substringof('erlin',DESCRIPTION)` against the mixed-case demo description;
`'berlin'` and `'ERLIN'` return no rows. This applies to SQLite and DuckDB,
whose Gateway suite uses the same filters.

[DuckDB LIKE](https://duckdb.org/docs/stable/sql/functions/pattern_matching)
and [PostgreSQL LIKE](https://www.postgresql.org/docs/16/functions-matching.html)
are case-sensitive with their default deterministic collations. PostgreSQL's
ILIKE is its case-insensitive alternative. The same SQL and transpiled ABAP
regression runs on sql.js, file SQLite and DuckDB; set `OSD_TEST_POSTGRES=1`
with an isolated local PostgreSQL database to include PostgreSQL too.

## JOB_OPEN and lock waits

The business file client already enabled WAL and a five-second busy timeout.
JOB_OPEN also calls `legacyCountUsed`, which opens a separate read-only
operations-ledger connection. That connection had no timeout. A worker
opening/writing/closing the ledger can hold a recovery or last-close lock;
WAL does not guarantee that reads never return BUSY.

A local two-process WAL churn probe produced 1,373 lock errors in 5,000
legacy lookups before the fix, at `SELECT ... FROM sqlite_master`, including
extended code 261 (`SQLITE_BUSY_RECOVERY`). This is a recovery-lock failure,
not evidence of a deferred transaction upgrade or a missing business WAL.
The focused regression also failed before the fix under a startup exclusive
lock. Both tests pass with the shared timeout hook.

The hook installs `busy_timeout = 5000` before native queries, including the
JOB_OPEN ledger reader, job snapshot/outbox readers and file-client WAL setup.
Read-only connections do not change journal mode. The HTTP run-list and
counts monitors also open the ledger read-only: their previous writable
constructor ran schema migrations (including BEGIN IMMEDIATE) on every GET.
Ten traced serial integration runs passed before run 11 captured
MONITOR_FAILED with "database is locked" after generation replacement,
before the read-only monitor fix. A deterministic held-WAL-writer regression
returned 500 before this change and 200 afterwards. Readers use committed
snapshots without requesting the worker's write lock.

Read-only connections alone did not remove WAL lifecycle contention. A later
traced run captured `SQLITE_BUSY` at the monitor's `sqlite_master` prepare
while the retiring worker's final operations-ledger close took **9.378 seconds**.
SQLite's last WAL connection close checkpoints under an exclusive lock.
The monitor now retains its read-only connection between requests, preventing
that worker from becoming the last connection during handoff. It closes the
handle with the HTTP server, opens an existing ledger before publishing a new
serving generation (including before any monitor request), retains no
transaction between requests and never caches an empty in-memory fallback.
An inode change is only a defensive reopen; it cannot make an uncoordinated
file replacement safe. In the critic's sequence the monitor opens before the
worker's final write, the worker closes, and renaming a different main file
over the old one replays the retained old WAL: `FIRST` replaces `SECOND`.
Windows can instead refuse the rename while the reader remains open.

`tools/osd-operations-files.mjs` registers every retained monitor/counts
reader by ledger path. Before a ledger file is replaced, moved or deleted,
`prepareOperationsFileChange` closes all those readers, checkpoints with
`TRUNCATE` through a writable connection, leaves WAL mode and closes the
writer. Busy checkpoints or still-open foreign WAL handles abort the change.
Callers must stop other-process workers/servers and prevent new opens until
replacement finishes; the registry cannot close another process's handles.
Readers reopen lazily on their next request, including after deletion and
recreation. `replaceOperationsDatabase` prepares both source and destination;
`setAsideDatabase` (move/delete) and `forkDatabase` (overwrite destination)
apply the same rule when the path contains an operations ledger. Business
DDIC drift keeps its existing sidecar lifecycle.

Replacement/deletion audit:

- The critic regression was the only direct ledger main-file rename; it now
  uses the coordinated replacement API and opens the monitor before the final
  worker write. Tests also cover multiple monitor/counts readers, deletion,
  recreation, fork overwrite and refusal with an uncoordinated WAL handle.
- `JOB_*` reset/reorganization and `BP_JOB_DELETE` modify rows, never replace
  the ledger file. Job-count/delete/periodic tests select fresh ledger paths
  for each world and close their stores before directory cleanup.
- The HTTP monitor tests await server shutdown before deleting temporary
  roots. The worker integration awaits `Launcher.stop()` (server and worker)
  before removing storage. The reader-lock suite prepares the ledger before
  recursive temporary-root cleanup.
- VSIX home materialization/quarantine/removal copies source trees, while the
  launcher places operations data under separate extension storage at
  `storageDir/operations/osd-operations.sqlite`. Home switching stops the old
  launcher; its ledger is neither copied nor replaced by home cleanup.
- `test/setup.mjs` base-image copying and DDIC drift act on the business
  database, not the separate operations ledger. Generic move/delete/fork
  helpers now also handle an operations path safely if given one.

Missing/uninitialized
ledgers use an empty in-memory schema without creating persistent files;
writable owners perform migration of existing older ledger schemas. This is SQLite's bounded
lock wait: a work process waits for another process's database lock, as the
main connection already did. No statement retry loop or LUW rollback is
introduced. A lock held longer than five seconds still reports failure.

The worker integration baseline passed five serial runs and failed on run
six while reading the second generation's run list. That failure exposed an
unchecked HTTP response; the test now reports its status and body. It did
not capture a JOB_OPEN lock stack. The focused operations-reader reproduction
proves that path; the later traced integration failure identifies the monitor
writer contention described above. Earlier incomplete post-fix sequences included a timeout
during cold activation, a queued-job deadline and the captured final-close lock; incomplete sequences are excluded from the
20-consecutive-run proof. The initially
concurrent/edited-tree runs were invalidated by build input races and are
excluded from that baseline.

Validation commands (all mocha/transpile work uses heavy range 50–59):

- `npx mocha test/sqlite-like.mjs`: SQL patterns, cursors, escaping,
  export/reconnect and transpiled ABAP with the measured 0/32 row counts.
- `npx mocha test/job-reader-lock.mjs`: independently released startup lock
  and WAL recovery contention across 1,500 reader/writer iterations.
- Twenty serial `npx mocha test/vscode-job-worker-integration.mjs` runs:
  HTTP submission, automatic worker completion and generation replacement.
- One combined mocha invocation covering both fixes, SQLite/DuckDB,
  database identity and LUW/dialog-step suites, followed by suite manifest
  and size-budget checks. Local detailed logs stay in `.local/stack-evidence/`.

The fresh final-code proof completed **20/20 consecutive plain runs** with
zero failures or timeouts. Each invocation used `timeout 600`, serially under
one heavy wrapper. It took about 30.5 minutes; detailed logs and per-run
counts stay in `.local/fix-finish-evidence/`.

The combined invocation passed **295 tests**, with zero failures and 17
pre-existing pending selection-option cases documented by
`ANOMALY-2026-09-29-runtime-in-options`. It covers both fixes, read-only
monitor contention, SQLScript treatments, SQLite/DuckDB, database identity,
LUW/dialog-step behavior, job counts, snapshots, outbox execution and
compiled ABAP jobs. Suite registration has no drift. The size guard against
the starting commit passes for this branch, reporting six inherited breaches
without changing their budgets. PostgreSQL's live optional test was not run
in this checkout.

After rebasing onto `origin/main` at `1d9c46fa`, the focused LIKE, reader-lock
and worker-integration invocation passed **11 tests** with the isolation
hook enabled. The worker test retains both its HTTP lock-failure diagnostics
and the upstream drift proof that runs only after successful activation.
The proof and combined counts above were collected before the rebase; the
fix implementations were carried over unchanged.

## Round 2 validation

Rebased onto `origin/main` at `bed40466`. The critic's five targeted
regressions were red before these changes: both SQLite builds reported
`SCAN prefix_probe` and `1.0 LIKE '1.0' = 0`, and the monitor-before-final-write
replacement returned `FIRST` instead of `SECOND`. The final lifecycle and
file-client focused run passed 18 tests.

After a fresh build, one combined Mocha invocation under heavy range 50–59
passed **304 tests**, with zero failures and the same **17 pre-existing
pending** runtime selection-option cases. The isolation hook checked all
20 suite files. Both LIKE query plans are
`SEARCH prefix_probe USING COVERING INDEX prefix_value (value>? AND value<?)`;
REAL conversion, case, wildcards, ESCAPE, NOT LIKE, export/reconnect, compiled
Open SQL and mixed-case SADL filters pass. Worker activation/completion,
SQLite/DuckDB, database identity, LUW and job suites pass together.

The suite registry lists 297 ordinary and 7 grouped suites with no drift.
The size guard against `origin/main` passes for changed paths; its six
inherited breaches remain reported with unchanged budgets. Local evidence
is under `.local/fix-round2-evidence/`. Optional live PostgreSQL coverage
was not run.

A further focused DuckDB HTTP invocation passed the same mixed-case SADL
filters (1 test). The structural leak scan read all 25 changed files and
found no matches; its exit status is 2 because this checkout lacks the
private `.local/leak-identifiers.json` list, so host/user name scanning
cannot be claimed as passed.

## Atomic operations-ledger startup

The read-only monitor change exposed a first-start race: `BatchRuns` created
`batch_runs` in autocommit, then began the transaction that created its
revision, steps, imports, logs and event tables. A retained monitor could
therefore pass its `batch_runs` readiness check and fail with
`no such table: batch_monitor_revision` before that transaction committed.

Create `batch_runs` inside the same `BEGIN IMMEDIATE` transaction as the
rest of the schema and migrations. This chooses writer-owned, atomic schema
initialization: readers see either no ledger tables (empty runs/counts and
revision sequence 0), or the complete committed schema. The existing empty
in-memory fallback is not retained, so the next request sees the writer's
commit. GETs perform no persistent schema writes.

Read-only path audit of the change in #590:

- Monitor lists, details, output and HTTP counts use `BatchRuns`; atomic
  publication protects their revision, parent, steps and log queries.
- `legacyCountUsed` checks for `batch_runs` and the required identity columns
  before querying, returning false when no holder exists yet.
- Job snapshots check the operations import/run/step schema; no import table
  means no imported job yet. Technical-log reads check for `batch_job_log`
  and return empty entries when it is absent. An inconsistent imported job
  still reports an error rather than being hidden as an empty ledger.
- Outbox readers and the status-port committed-identity check read the
  business database, whose DDIC schema is installed before ABAP execution;
  they do not depend on lazily created operations tables.

The two startup-order regressions pause the real writer immediately after
its first `CREATE TABLE`, with the monitor starting either before or after
the writer. Both reproduced the exact missing-revision-table HTTP 500 before
the fix. Afterwards both read empty state without changing `sqlite_master`,
then observe the first queued job after schema commit.

Validation on this fix:

- Both new startup-order race regressions failed with the exact
  `batch_monitor_revision` error before the change and passed afterwards.
  The complete reader-lock suite passed 11 tests.
- A fresh build and one focused invocation of 20 job/database suite files
  passed 294 tests, with zero failures and 18 existing pending cases (17
  selection-option anomalies and the existing space-COMMITMODE delete case).
- One uninterrupted batch of 20 plain worker-integration invocations, each
  under `timeout 600` and the heavy wrapper's range 50–59, completed with
  **15 passes and 5 failures**. Runs 5, 12 and 19 failed in `JOB_OPEN` with
  `database is locked`; runs 4 and 18 missed the first job's completion
  deadline. No missing-table error appeared. The batch returned failure;
  this is **not a passing 20-run proof**, and those failures remain unresolved.
- Earlier exploratory plain sequences passed 28 of 32 invocations: three
  JOB_OPEN locks and one completion deadline after cold activation failed.
  Eleven supplementary traced invocations passed without capturing a native
  SQLite error. They are separate from the plain batch and cannot identify
  the lock holder or certify the required integration check.
- Suite registration has no drift; changed paths pass the size guard, with
  six inherited breaches in untouched files. Structural leak scanning found
  no matches in the three changed files; the private identifier list is
  absent, so host/user identifier scanning was unavailable.

Detailed local logs are in `.local/monitor-revision-evidence/`; the complete
20-invocation batch is under `plain-batch/`. The integration test's assertions,
polling limits and deadlines were unchanged; no invocation was retried or
omitted from that batch.
