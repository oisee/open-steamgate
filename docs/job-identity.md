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
SQLite table). The key has no date in it, so the counter is **across days**: the proposal is
the lowest `NN` that no identity row of that name and second holds (the
caller's own uncommitted rows included), and only final when the INSERT lands,
so two concurrent openers never keep one pair. Measured on the sandbox the
same day (TBTCO, two standard daily jobs that start at a fixed second): on
consecutive days the counts went NN 06 then 07 for one job and 07 then 08 for
the other (`test/fixtures/job-count`, "counter-continues-across-days").
Past `NN` = 99 for one name in one second is **not measured**: the open is
refused (`CANT_CREATE_JOB`, message "No free JOBCOUNT for this job name this
second"); the counter does not wrap and does not borrow the next second.
Counts of earlier builds are random eight digits; they stay valid, and a new
count that equals one of them (an identity row, a definition in this LUW or
the operations ledger) is passed over: the allocator goes on to the next free
`NN`. The periodic successor takes its count in the second it is created,
which is when its predecessor starts, as measured; one made late (a retry
after a refusal, crash recovery) takes the second of the retry or the
recovery, not the scheduled second. JOB_OPEN and the successor pass the same
legacy-ledger check (`legacyCountUsed`).
`JobDestination.candidate` / `JobScheduler.candidate` still let a test answer
another count for the proposal `{second, nn, count}`.

**The job reorganisation** (`tools/osd-job-reorg.mjs`) is this runtime's
equivalent of the system's reorganisation of TBTCO, and the only way a pair
leaves besides a delete: a job that starts at one fixed second every day would
otherwise use up its 100 counts in 100 days. It runs at host start and then
daily on the scheduler's clock, in a dialog step. Retention is
`OSD_JOB_RETENTION_DAYS` (default 14; `off` keeps everything). A job in a final
state (COMPLETED, FAILED, INTERRUPTED, DELETED) that ended before the cutoff
goes: identity, outbox and step rows in the business database (first), then
run, steps, log, import ledger and completion event in the operations store.
Never a job that is not final, never one a waiting job is chained behind, never
the latest instance of a periodic chain. When a reservation still fails, the
scheduler leaves that run RELEASING, says so, retries it a minute later and
carries on with the other due runs; it always re-arms, and the one-minute
retry floor applies to that run's own next try only, the other timed jobs keep
their due time. Both stores go in one dialog step (business rows first), so no
job read sees a run without its identity; a crash between the two leaves such a
run, which reads as "predates retained identity" until the next reorganisation
removes it. A non-numeric `OSD_JOB_RETENTION_DAYS` falls back to 14 with a
warning. Known limits: the final run of a chain that ended (its successor
deleted) is kept for good; the identity row of a `JOB_OPEN` that was never
closed has no run and is never removed; `legacyCountUsed` opens the operations
store once per candidate count.

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
are removed by the job reorganisation above, together with their identity row,
after the retention period; a pre-identity run holds its count until then.
