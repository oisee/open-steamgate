# Standard background job FM facade

The local `ZOSD_JOBS` function group accepts the sandbox's measured parameter
names and classic exceptions for `JOB_OPEN`, `JOB_SUBMIT`, `JOB_CLOSE`,
`BP_EVENT_RAISE`, `SHOW_JOBSTATE`, `BP_JOB_READ`, and `BP_JOB_SELECT`. The
facade uses the retained job identity and `ZOSD_JOB_READ`/`ZOSD_JOB_STATUS`
bridge. A read cannot create a job or import pending work.

`JOB_OPEN` reserves a local job key. `JOB_SUBMIT` accepts supported static ABAP
reports and returns step number 1. `JOB_CLOSE` accepts immediate, predecessor,
and named event starts; it releases the intent. `BP_EVENT_RAISE` records a
local named event. Unsupported scheduling, target, periodic and external
program values raise the respective call's failure exception instead of being
ignored. Empty optional parameters are accepted. Some optional types and
nonempty values require further measurement before they can be supported.

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
this run. Locally, `S` also represents a start condition, predecessor, or
event wait. `Z` remains unmapped (see ANORMALIES).

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
