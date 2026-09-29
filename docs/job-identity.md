# Retained job identity

`ZOSD_JOB_IDENTITY` owns the business key `(MANDT, JOBNAME, JOBCOUNT)` in the
business database. `JOB_OPEN` chooses an eight digit count and inserts the
reservation in the caller's LUW. A duplicate key selects a new count, up to
64 attempts. Rollback removes the reservation; a committed open without a
close keeps its count permanently. The private port's `CANCEL` discards only
the failed candidate in the current dialog step.

`JOB_CLOSE` writes every step and the outbox parent, then binds the existing
reservation to the intent in that same LUW. Its handled failure paths remove
partial outbox rows. A successful outbox acknowledgement deletes the dispatch
rows and leaves the identity row. The reservation's owner is checked when
binding; the key is scoped by client and the business database containing it.

The additive SQLite migration recognizes the exact preceding schema stamp,
rechecks it under `BEGIN IMMEDIATE`, and copies unacknowledged outbox keys into
the new table. A duplicate old key aborts the migration and retains the old
rows and stamp. For jobs already acknowledged before this table existed, count
selection also checks `batch_runs` in the operations database for the same
business database, client, system, name and count. Those historical run rows
currently have no retention policy. Any future deletion of them must first
transfer their keys to durable identity storage; the import ledger alone does
not contain the job name and count.
