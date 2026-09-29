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

`SHOW_JOBSTATE` returns one `X` flag from the bridge snapshot. `BP_JOB_READ`
returns the header and, for the provisional with-steps opcode, a bounded step
list. `BP_JOB_SELECT` selects the current owner's visible retained jobs with
`JOBSELECT_DIALOG = 'N'`. It accepts exact job name and user filters plus preliminary, scheduled, ready, running, finished, and aborted status flags, and raises `NO_JOBS_FOUND` for an empty result.

The local one-character header status mapping is **assumed, to be measured**:

| Bridge state | Status | SHOW_JOBSTATE flag |
| --- | --- | --- |
| `RESERVED` | `P` | `PRELIMINARY` |
| `WAITING` | `S` | `SCHEDULED` |
| `QUEUED` | `Y` | `READY` |
| `RUNNING` | `R` | `RUNNING` |
| `COMPLETED` | `F` | `FINISHED` |
| `FAILED`, `INTERRUPTED` | `A` | `ABORTED` |

`BP_JOB_READ` currently assigns opcode 1 to header and 2 to header plus steps.
**These numbers are provisional and require a sandbox measurement.** Other
opcodes raise `INVALID_OPCODE`. The compact local DDIC structures contain
only fields consumed by this facade; their remaining widths and complete SAP
shapes are open measurements.

`TAIL_EVENT_ID` and `TAIL_EVENT_PARAM` on `JOB_CLOSE` are private extensions.
A program that passes them will not activate against the real SAP FM.

For compatibility with earlier local jobs, this facade still permits omitted
`AUTHCKNAM` on `JOB_SUBMIT`; the measured SAP signature requires it.

Closing a valid job with no submitted report step raises `JOB_NOSTEPS`.
