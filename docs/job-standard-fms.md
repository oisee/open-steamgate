# Standard background job FM facade

The local `ZOSD_JOBS` function group accepts the sandbox's measured parameter
names and classic exceptions for `JOB_OPEN`, `JOB_SUBMIT`, `JOB_CLOSE`,
`BP_EVENT_RAISE`, `SHOW_JOBSTATE`, `BP_JOB_READ`, `BP_JOB_SELECT` and
`BP_JOB_DELETE`. The
facade uses the retained job identity and `ZOSD_JOB_READ`/`ZOSD_JOB_STATUS`
bridge. A read cannot create a job or import pending work.

`JOB_OPEN` reserves a local job key; its `JOBCOUNT` is `hhmmss` of the creation second plus two base-36 digits (`0`-`9`, then `A`-`Z`) counted per (job name, second) as on the sandbox, so two names share a count and only (name, count) is a key (docs/job-identity.md). In 103 opens of one name in one second, #11 was `0A`, #98 `2P`, #100 `2R`, and #103 `2U`, with no refusal. The suffix is max+1 over existing rows: open `00`, `01`, `02`, delete `01`, then open gets `03`; open `00`, `01`, `02`, delete `02`, then open gets `02` again. Past `ZZ` is unmeasured and refused locally. `JOB_SUBMIT` accepts supported static ABAP
reports and returns step number 1. `JOB_CLOSE` accepts immediate, predecessor,
named event and date/time starts, the latter once or periodic (see
[Periodic jobs](#periodic-jobs)); it releases the intent. `BP_EVENT_RAISE`
records a local named event. `BP_JOB_DELETE` deletes a job that waits, is
only opened or has ended, also one still in the outbox or in the caller's LUW. Unsupported scheduling, target and external program values raise the
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
and a count from the one allocator (`JOBCOUNT` = creation time `hhmmss` + two base-36 digits per job
name and second, here as there; docs/job-identity.md has the A4H sequence). Its start time is the predecessor's
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
time has come, and runs what is queued. The release decision is one
conditional update in the operations store, WAITING to RELEASING: a job that
`BP_JOB_DELETE` took first loses it and gets no successor, so a delete that
commits while the scheduler is already looking still ends the chain. Only a
job that won it gets its periodic successor, and then it goes RELEASING to
QUEUED. RELEASING reads as `S` (bridge state `WAITING`) until it is queued;
`BP_JOB_DELETE` refuses it with `JOB_IS_ALREADY_RUNNING`, as it refuses a
queued or running job. A crash after the decision leaves the job RELEASING,
and the next pass finishes it: the successor is found again, the job is
queued once, and the decision is never taken twice.
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
build left are reduced first to the count an import used, else the lexically
lowest existing row. This duplicate-intent repair does not allocate a new count.
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

**Downtime** (unmeasured: an assumption, marked so in the fixture). A system
started after an outage does not replay the periodic runs it missed. At host
start (the worker's first pass) every released job that is overdue starts
once, and its successor goes to the first scheduled time + k * period that
lies after that moment: the chain keeps its phase and stays aligned with the
original schedule, and the slots in between are skipped. A one-minute job
after a two-day stop therefore starts once, not about 2880 times. The slot is
decided in the same update that takes the start decision (WAITING to
RELEASING, `batch_runs.next_sdl_at`), so a crash and restart finish that
decision with the same slot and never make a second successor elsewhere.
This applies only to a start that was overdue at host start; while the
scheduler is up, an overrun skips nothing and each successor is due at its
predecessor's scheduled time + one period, as measured.

**A latest start reached while waiting** (unmeasured: an assumption). The
instance is not started; it ends `A` with result status `EXPIRED`, and its
periodic successor is still made, with its latest start moved by the period.

**BP_JOB_DELETE** (measured on the sandbox 2026-10-01 and 2026-10-02,
`test/fixtures/job-delete/contract.json`, `test/job-delete.mjs`) deletes a
job of the caller that waits (`S`: a start time, a predecessor, a named
event), that is only opened (`P`) or that has ended (`F`, `A`), wherever the
job is: in the caller's own LUW, committed in the outbox, or imported. A job
scheduled, committed and deleted in the same program run is gone at once and
never runs; so is one deleted before any `COMMIT WORK`. A job released to
start at once is `Y` on a system from `JOB_CLOSE` on, so here, still in the
outbox or imported and queued, it raises `JOB_IS_ALREADY_RUNNING`, as a
running job or one the scheduler is releasing does. An unknown one raises
`JOB_DOES_NOT_EXIST`, another user's `NO_DELETE_AUTHORITY`, and a nonempty
`FORCEDMODE` `CANT_DELETE_JOB`.

How it goes depends on where the job lives. Not imported, its business rows
(identity, outbox, steps) are deleted in the caller's LUW. Imported, its
operations run is marked `DELETED` at once and its business rows go in the
caller's LUW too, outbox rows included when the import's acknowledgement has
not landed, so the next drain has nothing half to acknowledge. The delete then
ends with `COMMIT WORK`: the default `COMMITMODE = 'X'` commits the caller's
LUW on a system, other pending writes included (measured with a sentinel row),
and a later `ROLLBACK WORK` does not bring the job back. `COMMITMODE = space`
(on a system: the delete stays in the caller's LUW) is not honoured here,
because a function module cannot tell an omitted parameter from a space
(ANORMALIES.md, fm-is-supplied). A worker's drain imports only committed
outbox rows and takes the work process the deleting step holds, so it either
imported the job before the delete, which then takes the imported path, or
never sees it. A deleted job's operations run stays, as `DELETED`, for its
ledger, log and chain link; every read answers as for an unknown job.

On a system `JOB_OPEN` and `JOB_CLOSE` commit the caller's LUW as well; here
they do not (ANORMALIES.md, job-open-commits).

**Not here:** `BP_JOB_ABORT`. A running instance holds the one work process,
so nothing could call it while the instance runs; the abort fixture uses an
instance that ends `A` by itself. It belongs with the multi-work-process
dispatcher (0.6).
