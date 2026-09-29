# Named background events

The narrow `JOB_CLOSE` facade accepts `EVENT_ID` with an optional
`EVENT_PARAM` and an empty `STRTIMMED`. `EVENT_PERIODIC` is refused. Date,
time, target system and predecessor conditions cannot be combined with a
named event. A waiting job has all steps pending until one matching raise.
`JOB_WAS_RELEASED = 'X'` means the schedule was accepted, not that a report
started.

`BP_EVENT_RAISE(EVENTID, EVENTPARM)` writes a durable occurrence to the
operations store immediately. It does not commit the caller's business LUW,
and a later `ROLLBACK WORK` does not undo the raise. Event IDs in this subset
are uppercase letters, digits and underscores, at most 32 characters;
parameters are at most 64 characters and retain case. There is no event
catalog yet: a valid event with no waiters succeeds, and
`EVENTID_DOES_NOT_EXIST` is not raised. Empty IDs raise `EVENTID_MISSING`,
invalid IDs raise `BAD_EVENTID`, and failed storage raises `RAISE_FAILED`.

Matching is scoped to the business database instance, client, system ID and
owner. A blank waiting parameter matches any raised parameter. A blank
raised parameter matches only a blank waiter. This owner restriction is an
OSD subset: SAP's authorized global raise can start another owner's job.

The operations store assigns a monotonic signal number when `JOB_CLOSE`
registers a named wait and when `BP_EVENT_RAISE` records an occurrence. A
raise releases only waits with a smaller number. Consequently, a raise before
`JOB_CLOSE` is never replayed into a later job; a raise after a valid close is
recognized even if the business outbox imports later. An occurrence releases
all matching waits in one operations transaction. A unique business-instance
ID stored in the business database prevents a replacement file at the same
path from matching or claiming old waits; an old running job does not block a
new instance. The ordering point is the accepted `JOB_CLOSE` call, before its
business LUW commits. If another LUW raises the event after that call but
before the close commits, the eventual committed waiter can be released. A
rolled-back close has no durable waiter. The A4H probe did not measure this
cross-LUW race. The outbox import ledger hashes the named wait
as version 5; versions 1–4 retain their existing digests. Waiting jobs and
occurrences survive restart.

A bounded A4H probe confirmed the parameter names, no replay of a prior
raise, blank/specific matching, and that `BP_EVENT_RAISE` survives
`ROLLBACK WORK`. The OSD event-ID character subset, owner scope and event
catalog behavior are deliberate narrower contracts. The probe did not
measure all SAP exception mappings or simultaneous scheduling races.

The signal schedules a report; it does not guarantee exactly-once report
execution. A worker stopped after business effects but before result
recording still needs operator review.
