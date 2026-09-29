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
