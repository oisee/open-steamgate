# Retained job identity

`ZOSD_JOB_IDENTITY` owns the business key `(MANDT, JOBNAME, JOBCOUNT)` in the
business database. `JOB_OPEN` allocates the count the way a system does and inserts the
reservation in the caller's LUW (rule below). A duplicate key proposes the
next count, up to 64 attempts. Rollback removes the reservation; a committed open without a
close keeps its count permanently. The private port's `CANCEL` discards only
the failed candidate in the current dialog step.
**The allocator** (`tools/osd-job-count.mjs`, one for `JOB_OPEN` and for the
periodic successor): `JOBCOUNT` is the creation time `hhmmss` in system time
(the ABAP clock, so a frozen clock freezes it) followed by a two-digit counter
`NN` that counts **per (job name, second)**, from 00. Measured on the sandbox
on 2026-10-02: one name opened three times in 03:47:32 got 03473200, 03473201,
03473202; two other names opened in that second got 03473200 each; the first
name opened once more got 03473203; six jobs of different names opened in one
second all got 03440000. So the count alone is **not** a key and two names
share one in every busy second: every lookup uses (client, jobname, jobcount),
which is the identity table's key (`test/job-count.mjs` checks the DDIC and the
SQLite table). The proposal is the next free `NN` over the identity rows of
that name and second (the caller's own uncommitted rows included) and is only
final when the INSERT lands, so two concurrent openers never keep one pair.
Past `NN` = 99 for one name in one second is **not measured**: the open is
refused (`CANT_CREATE_JOB`, message "No free JOBCOUNT for this job name this
second"); the counter does not wrap and does not borrow the next second.
Counts of earlier builds are random eight digits; they stay valid, and a new
count that equals one of them (identity row, definition in this LUW or the
operations ledger) is skipped. The periodic successor takes its count in the
second it is created, which is when its predecessor starts, as measured.
`JobDestination.candidate` / `JobScheduler.candidate` still let a test answer
another count for the proposal `{second, nn, count}`.

The private port returns the canonical name (trimmed and upper case) to both
`JOB_OPEN` and `JOB_CLOSE`, so the reservation and outbox use the same key.

`JOB_CLOSE` writes every step and the outbox parent, then binds the existing
reservation to the intent in that same LUW. A private savepoint surrounds
these writes. Handled failures roll back to it, including SQLite statements
whose trigger changed a row before reporting failure, while preserving earlier
caller writes in the LUW. A successful outbox acknowledgement deletes the dispatch
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
