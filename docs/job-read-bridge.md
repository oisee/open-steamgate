# Private ABAP job status bridge

`ZOSD_JOB_STATUS` is an internal read function for a job's retained
`JOBNAME`/`JOBCOUNT` key. It returns the durable phase (`RESERVED`, `OUTBOX`,
`OPERATIONS`), state, result status and step count. It does not implement SAP
`SHOW_JOBSTATE` or `BP_JOB_READ`; their signatures and status mapping still
need A4H measurement.

The function calls the `STATUS` command of private destination
`ZOSD_JOB_PORT`. The destination ignores caller-supplied owner/client fields
and takes client, user and SID from the configured runtime identity. It reads
the current file business DB and the operations store through read-only
connections, without draining the outbox, creating an operations file or
ending the caller's LUW. It requires the existing `STG_DB=file` path and a
dialog step. Owner mismatches fail closed.

Errors are explicit: `NOT_FOUND`, `FORBIDDEN`, `INCONSISTENT`, `LEGACY`,
`UNCOMMITTED`, `UNAVAILABLE` and `BAD_KEY`. `UNCOMMITTED` means the caller's
business connection can see a job key or binding that the durable reader
cannot yet see, or has staged deletion of a previously committed key. After
rollback, the committed state is read again. The private port clears every
output on every call so a reused ABAP value cannot retain a prior result.

This bridge returns metadata only; it does not return the ordered technical
job log, list output or BAL entries. Authorization beyond the single
configured runtime user remains separate work. A future multi-user host must
supply authenticated per-session identity at this seam before exposing it to
user-facing callers.

## Bounded private read for doctor

`ZOSD_JOB_READ` uses the same trusted identity and committed-state checks as
`ZOSD_JOB_STATUS`. It reads the retained `ZOSD_JOB_IDENTITY` and outbox/step
tables and, after import, the operations SQLite run, steps and technical log.
It does not read or simulate `TBTCO`/`TBTCP`, or claim the signature or
semantics of `BP_JOB_READ`, `BP_JOBLOG_READ` or `SHOW_JOBSTATE`. The first
read-only doctor should use this private bridge. A standard-compatible facade
remains separate work after its signatures and behavior are measured on A4H.

Pass `IV_JOBNAME` and `IV_JOBCOUNT`; `IV_ITEM` chooses `HEADER` (default),
`STEP` or `LOG`. `STEP` needs `IV_INDEX` from 1 through 16, and `LOG` needs
1 through 2000. A header request takes no index. Each call returns the same
header fields: phase, state, result status, step and log counts, creation,
queue, start and end times, a predecessor job key or named event ID when
configured (including after release), and `EV_HISTORICAL_GAP = 'X'` for older imported runs lacking their
initial log rows. `STEP` adds its number, program, state, times and result
status. `LOG` adds its sequence, optional step number, time, event, severity
and a fixed technical message. The port validates each requested log row's
timestamp and event-to-step relationship before returning it; corrupt rows
raise `INCONSISTENT`. There is no source database path, generation,
selection input, run detail, list output or BAL data in the result.

The read-only reader caps the complete technical log at 2000 rows, even for a
header request. An oversized log raises `TOO_LARGE`; an index outside the
requested collection raises `BAD_KEY`. Other exceptions match the status
bridge. All outputs are cleared on every call and every exception. A doctor
can walk the indices, but each call is a fresh snapshot: a worker may advance
the job between header, step and log calls. The doctor must report the fields
as separately observed and reread the header if it needs a current summary.

The header also returns the private job-owned `EV_TAIL_EVENT_ID` and
`EV_TAIL_EVENT_PARAM` when configured. The reader verifies the v6 import
digest and checks that a completed run has its exact named occurrence, while
a failed or interrupted run has none. A disagreement is `INCONSISTENT`.
