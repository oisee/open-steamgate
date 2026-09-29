# Private operations job tail events

`BatchRuns.importIntent()` accepts an optional `afterEvent: {jobname, jobcount}`
for an ordered, imported job. This is an operations-store seam only. The ABAP
job functions and business outbox do not yet produce this field.

The import ledger hashes a version 3 payload when `afterEvent` is present;
version 1 and 2 hashes remain unchanged. An imported dependent enters
`WAITING` with all steps `PENDING` until the named predecessor has completed
successfully in the same business database, client, system ID, and owner.
The event ledger survives restart, so an import after the predecessor completed
enters `QUEUED` immediately. Workers claim only `QUEUED` jobs.

This private seam identifies a business instance by its database path, client,
system ID and owner. If an ephemeral business database is replaced at the same
path while the operations database is retained, an old completion event could
match a recycled job key. Reset the operations database together with that
business database. A persistent instance identifier is needed before exposing
this dependency through an ABAP scheduling API.

The predecessor's terminal success, its single completion event, and release
of waiting dependents commit in one operations SQLite transaction. A failed
or interrupted predecessor emits no completion event. A multi-step predecessor
emits only after its final successful step. A transaction failure leaves its
result unconfirmed and the run `RUNNING`; an operator must inspect business
effects before deciding how to proceed.

This is a durable scheduling signal, **not exactly-once report execution**.
The report's business transaction and the operations SQLite transaction are
separate. A process can stop after business effects commit and before result
recording. The worker does not automatically replay a `RUNNING` job.
