# Standard background job FM facade

The local `ZOSD_JOBS` function group accepts the sandbox's measured parameter
names and classic exceptions for `JOB_OPEN`, `JOB_SUBMIT`, `JOB_CLOSE`,
`BP_EVENT_RAISE`, `SHOW_JOBSTATE`, `BP_JOB_READ`, `BP_JOB_SELECT` and
`BP_JOB_DELETE`. The
facade uses the retained job identity and `ZOSD_JOB_READ`/`ZOSD_JOB_STATUS`
bridge. A read cannot create a job or import pending work.

`JOB_OPEN` reserves a local job key. `JOB_SUBMIT` accepts supported static ABAP
reports and returns step number 1. `JOB_CLOSE` accepts immediate, predecessor,
named event and date/time starts, the latter once or periodic (see
[Periodic jobs](#periodic-jobs)); it releases the intent. `BP_EVENT_RAISE`
records a local named event. `BP_JOB_DELETE` deletes a job that waits or has
ended. Unsupported scheduling, target and external program values raise the
respective call's failure exception instead of being ignored: `EVENT_PERIODIC`,
`PRDMONTHS`, `CALENDAR_ID`, `AT_OPMODE`, `AT_OPMODE_PERIODIC`,
`STARTDATE_RESTRICTION`, the `START_ON_WORKDAY_*` and `WORKDAY_COUNT_DIRECTION`
fields, `RECIPIENT_OBJ`, `INHERIT_*`, `REGISTER_CHILD`, `EMAIL_NOTIFICATION`,
`DONT_RELEASE` and `DIRECT_START` raise `JOB_CLOSE_FAILED`; `TARGETSYSTEM`,
`TARGETSERVER` and `TARGETGROUP` raise `INVALID_TARGET`; `TIME_ZONE` raises
`INVALID_TIME_ZONE`. Empty optional parameters are accepted. Some optional
types and nonempty values require further measurement before they can be
supported.

`SHOW_JOBSTATE` returns one `X` flag from the live bridge snapshot. The sandbox
reported `RUNNING` while the job table still held status `Y`; callers should
not infer the flag from a previously read table row. `BP_JOB_READ`
returns the header and, for the with-steps opcodes, a bounded step
list. A noninitial `JOB_STEP_NUMBER` returns only that step; a number beyond the step count raises `JOB_DOESNT_HAVE_STEPS` (assumed, to be measured). `BP_JOB_SELECT` selects the current owner's visible retained jobs with
`JOBSELECT_DIALOG = 'N'`. It accepts exact job name and user filters, `NJRANGE` and `UNRANGE` selection tables (`EQ`, `CP`, `BT`, include and exclude), plus the `PRELIM`, `SCHEDUL`, `READY`, `RUNNING`, `FINISHED`, and `ABORTED` status flags. It matches `JOBCOUNT` exactly, `ABAPNAME` against known report steps, and `EVENTID`/`EVENTPARM` against named-event waits. A noninitial `JOBGROUP`, date/time bound, `NO_DATE`, or `WITH_PRED` raises `SELECTION_CANCELED` with that field in the message. An empty result raises `NO_JOBS_FOUND`.

The one-character status sequence was measured on the sandbox on 2026-09-29:
`P` after `JOB_OPEN` and submit, `Y` after immediate `JOB_CLOSE`, `R` while
running, and `F` when finished. The system also had jobs with `A` (aborted),
`S` (released, waiting for its start time), and `Z`; these were not seen in
this run. A released date/time job was measured as `S` on 2026-10-01. Locally,
`S` also represents a predecessor or event wait. `Z` remains unmapped (see
ANORMALIES).

| Bridge state | Status | SHOW_JOBSTATE flag |
| --- | --- | --- |
| `RESERVED` | `P` | `PRELIMINARY` |
| `WAITING` | `S` | `SCHEDULED` |
| `QUEUED` | `Y` | `READY` |
| `RUNNING` | `R` | `RUNNING` |
| `COMPLETED` | `F` | `FINISHED` |
| `FAILED`, `INTERRUPTED` | `A` | `ABORTED` |

Sandbox measurement on 2026-09-29: `BP_JOB_READ` accepts opcode 19 (header
only), 20 (header and steps), 35 and 36 (steps), and 37 (no steps). The facade
maps 35 and 36 like 20, and 37 like 19; the probe established step-list
presence but did not distinguish the other fields of those opcodes. Every
other opcode raises `INVALID_OPCODE`. `BTCSELECT` has the sandbox-measured 19-field shape (2026-09-30). Other compact local DDIC structures retain only fields consumed by the facade; their full SAP shapes remain open measurements.

`TAIL_EVENT_ID` and `TAIL_EVENT_PARAM` on `JOB_CLOSE` are private extensions.
A program that passes them will not activate against the real SAP FM.

`AUTHCKNAM` is mandatory on `JOB_SUBMIT`, as measured. Callers pass `sy-uname`; another user is rejected. `PRIPARAMS` raises `BAD_PRIPARAMS`; external-program flags raise `BAD_XPGFLAGS`, and a report combined with an external program raises `PROG_ABAP_AND_EXTPG_SET`.

Closing a valid job with no submitted report step raises `JOB_NOSTEPS`.
Immediate `JOB_CLOSE` (`STRTIMMED = 'X'`) exports `JOB_WAS_RELEASED = 'X'`,
as measured on the sandbox on 2026-09-29.

## Periodic jobs

Measured on the sandbox on 2026-10-01 with a throwaway report that waits a
given number of seconds; the cases are fixtures in
`test/fixtures/jobs-periodic/contract.json` (`EXPECT = A4H`) and run in
`test/job-periodic.mjs` against the real facade and the scheduler.

**JOB_CLOSE.** `SDLSTRTDT`/`SDLSTRTTM` start a job at a date and time. The
values are **system time**: `sy-datum`/`sy-uzeit`, UTC on the sandbox and in
this runtime; the sandbox user's own time zone (GMTUK) played no part. The job
is released (`JOB_WAS_RELEASED = 'X'`) and waits as `S`.
- A start in the past is rewritten to the close time and released.
- A past start whose `LASTSTRTDT`/`LASTSTRTTM` has passed too raises
  `INVALID_STARTDATE` with message `BT` 386, and the job stays `P`, not
  released.
- A future latest start is accepted and stored; BP_JOB_READ and BP_JOB_SELECT
  return it.
- `PRDMINS`, `PRDHOURS`, `PRDDAYS` and `PRDWEEKS` make the job periodic
  (`PERIODIC = 'X'`). They need a start date; with `STRTIMMED`, an event or a
  predecessor they raise `JOB_CLOSE_FAILED`, as does a value that is not
  digits or wider than TBTCO's field (2, 2, 3, 2).
- `PRDMONTHS` keeps raising `JOB_CLOSE_FAILED`: calendar months need
  end-of-month rules nobody has measured, and the other periods are exact.

Chosen here, not measured: `SDLSTRTDT` without `SDLSTRTTM` means 000000;
`LASTSTRT*` without a start date, a latest start before the start, or a date
or time that does not exist raise `INVALID_STARTDATE`.

**Status.** A released time job is `S` (bridge state `WAITING`) in
`SHOW_JOBSTATE`, `BP_JOB_READ` and `BP_JOB_SELECT`, before and after the
outbox is imported; the header carries `SDLSTRTDT`, `SDLSTRTTM`, `LASTSTRTDT`,
`LASTSTRTTM`, `PERIODIC` and `PRDMINS`/`PRDHOURS`/`PRDDAYS`/`PRDWEEKS`
(`PRDMONTHS` stays `00`). The local `TBTCJOB` gained these fields after the
four it had.

**The chain.** The sandbox makes the successor of a periodic job **when an
instance starts**, as a new job of the same name and steps with status `S`
and a count from the usual allocator (`JOBCOUNT` = creation time + two digits
there, a random free count here). Its start time is the predecessor's
**scheduled** time plus the period, not its actual start: an instance due at
224501 started at 22:45:51 and its successor was due at 224701. A start in the
past rewritten to the close time counts the chain from the rewritten time. No
instance is ever skipped: with a period of one minute and a run of 150 s the
sandbox ran two or three instances side by side. Deleting the waiting
successor with `BP_JOB_DELETE` ends the chain; aborting a running instance
does not, because its successor exists already.

**The scheduler** (`tools/osd-job-scheduler.mjs`) runs one injectable clock:
`now()`, `setTimer`, `clearTimer`. By default it reads the ABAP clock
(`abap.statements.getTime`, the hook the frozen `@osd.clock` of the `.http`
regression cases replaces) and arms a real timer; tests pass `manualClock()`
and `installAbapClock()`, so `JOB_CLOSE`, the report and the scheduler read
one time. A pass imports the committed outbox, releases every timed job whose
time has come (WAITING to QUEUED, once, under `BEGIN IMMEDIATE`), makes a
periodic job's successor just before it releases it, and runs what is queued.
Every run is an entry into ABAP through `tools/osd-dialog-step.mjs`
(`runConvertedBatch`): it takes the work process, commits when it ends and
rolls back when it dumps. The successor is made when the instance is
released, which is the moment the sandbox would start it with a background
work process free; its jobcount is bound in `ZOSD_JOB_IDENTITY` to an intent
ID derived from the predecessor's run, so a retry after a crash finds the
successor it made instead of making a second one. The intent is a unique key
there (a partial index, `zosd_job_identity_intent`, made on first use), and
the reservation is one statement, insert or return the row already there, so
two workers racing for one successor end with one count; duplicates an older
build left are reduced first to the count an import used, else the lowest.
A worker releases only its own source's jobs (its business database, client,
system, user and source instance): several business databases may share one
operations store, and another's job is skipped, never an error. The worker
(`node tools/osd-batch-runs.mjs worker`) is the host: it runs a pass at start,
on every poll and at each start time.

Known differences, in `ANORMALIES.md`: a due job starts when the scheduler
looks (its timer, or the worker's poll), not at the sandbox's minute tick
(hh:mm:51 there); and this runtime has one work process, so overlapping
instances queue instead of running side by side. Neither changes which
instances run or when they were scheduled.

**Durable.** Released time jobs are rows of the operations store
(`batch_runs.sdl_at`, `last_at`, `prd_*`, `chain_pred`), imported through
the business outbox like every other job, with an import payload of their own
(version 7) that the read model checks. Jobs run only on `STG_DB=file`, as
before; on the other databases `JOB_CLOSE` refuses as it did.

**Downtime** (unmeasured: an assumption, marked so in the fixture). At host
start every overdue released job starts once. Because the successor is made
when an instance starts, with the scheduled time plus the period, an overdue
chain catches up instance by instance, as it does on an overrun, until the
next start lies in the future.

**A latest start reached while waiting** (unmeasured: an assumption). The
instance is not started; it ends `A` with result status `EXPIRED`, and its
periodic successor is still made, with its latest start moved by the period.

**BP_JOB_DELETE** deletes a job of the caller that waits (`S`) or has ended
(`F`, `A`). A queued or running job raises `JOB_IS_ALREADY_RUNNING`, an
unknown one `JOB_DOES_NOT_EXIST`, another user's `NO_DELETE_AUTHORITY`, and a
job still in the caller's LUW or in the outbox (not yet imported) or a
nonempty `FORCEDMODE` raises `CANT_DELETE_JOB`. Like `BP_EVENT_RAISE` the
delete reaches the operations store at once and is not undone by a later
`ROLLBACK WORK`. A deleted job's row stays, as `DELETED`, for its ledger, log
and chain link; every read answers as for an unknown job.

**Not here:** `BP_JOB_ABORT`. A running instance holds the one work process,
so nothing could call it while the instance runs; the abort fixture uses an
instance that ends `A` by itself. It belongs with the multi-work-process
dispatcher (0.6).
