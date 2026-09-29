# Private operations job tail events

`JOB_CLOSE` accepts a narrow standard predecessor start condition:
`PRED_JOBNAME`, `PRED_JOBCOUNT`, and `PREDJOB_CHECKSTAT = 'X'`, with
`STRTIMMED` empty. It requires an already closed predecessor under the same
client and owner. `JOB_OPEN` and `JOB_SUBMIT` retain their existing roles.
Other start conditions, `PREDJOB_CHECKSTAT` without `X`, and a predecessor
already known to be terminal fail closed. The
outbox records the predecessor's intent ID alongside its name and count.
The importer sends `afterEvent: {jobname, jobcount, intentId}` to the
operations store. `JOB_WAS_RELEASED = 'X'` means the dependent was accepted
for scheduling; it may remain `WAITING` until predecessor success.

`BatchRuns.importIntent()` also retains the older private
`afterEvent: {jobname, jobcount}` form for existing callers.

The import ledger hashes a version 4 payload for an ABAP predecessor with
`intentId`, version 3 for the older private event form, and keeps version 1
and 2 hashes unchanged. An imported dependent enters
`WAITING` with all steps `PENDING` until the named predecessor has completed
successfully in the same business database, client, system ID, and owner.
The event ledger survives restart, so an import after the predecessor completed
enters `QUEUED` immediately. Workers claim only `QUEUED` jobs.

The ABAP path also matches the predecessor's retained intent ID. A replaced
business database at the same path cannot release a new dependent from an old
completion event with a recycled job name and count. The older private
two-field seam does not have this protection; reset its operations database
when replacing the business database. If multiple completed intents already
share one key, a new two-field import is rejected as ambiguous; a previously
released version 3 dependent still reads against the earliest retained event.

Named `BP_EVENT_RAISE` signals use a separate edge-triggered occurrence
ledger; see [named events](job-named-events.md).

SAP documents `PREDJOB_CHECKSTAT` as the success condition and describes a
predecessor that is scheduled or released when the successor is scheduled.
A bounded A4H probe confirmed the three import parameter names and accepted
a future parent and dependent closed in one ABAP invocation; both remained
scheduled with no child start time. It did not measure failure, late-completion
or cross-owner behavior. The OSD importer can still catch a predecessor that
completes after the dependent's valid `JOB_CLOSE` but before dependent import.
See [SAP start condition documentation](https://help.sap.com/docs/SAP_NETWEAVER_700/12acb4f96c531014b9dad87356daf3a3/4d938f1c48846e73e10000000a15822b.html).

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

## Job-owned named tail event

The private `JOB_CLOSE` extension accepts `TAIL_EVENT_ID` and
`TAIL_EVENT_PARAM` alongside any supported start condition. The ID follows
the named-event ID subset; the parameter is at most 64 characters. The
configuration is part of the committed outbox intent and its immutable v6
import digest. A report must not call `BP_EVENT_RAISE` for this purpose:
that call writes immediately and survives the report's rollback.

After the final report step returns `COMPLETED`, its dialog step has already
committed business writes and BAL. The worker then records terminal success,
the named occurrence, and release of matching waiting jobs in one operations
SQLite transaction. The occurrence uses the source intent ID as its unique
delivery identity. A failed or interrupted job has no occurrence. If result
recording fails, the run stays `RUNNING` for operator review; it is not
replayed automatically. There is no gap between a committed result and event
publication: both become visible at the same SQLite commit. A process restart
after that commit sees the one retained occurrence and the queued successor.

`ZOSD_JOB_READ` exposes the configured tail ID and parameter. The doctor
reports it as pending, published, or not published based on the verified
terminal result and occurrence ledger. The `ZOSD_VOYAGE` and `ZOSD_READY`
reports are synthetic engine fixtures: they carry the same `P_RUN` input,
and the voyage accepts `P_FAIL = X` to leave readiness waiting. They live in
`test/integration/` for local transpile and tests; VSIX staging excludes them.
For a `RUNNING` tail job, the doctor warns that business effects may already
have committed and must be inspected before resubmission.
