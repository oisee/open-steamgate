# Lean jobs, events, business log and a doctor

This is a proposed end-to-end slice after the supported-PROG batch runner. It
does not require general SAP spool, arbitrary SUBMIT, or classic ALV fidelity.
The aim is to run and inspect a useful chain of background work.

## Open demo scenario

Use fictional airship maintenance data in a separate demo. Schedule two
independent chains, for example inspection and fuel reconciliation. Each chain
has a worker step, a tail step that raises a completion event, and a final
summary step waiting for that event. A deliberately failing worker lets the
user inspect a stopped chain. A doctor observes persisted job state and logs,
reports a stalled/missing tail event, and can later be hosted by an ABAP daemon.
This scenario is original demo material; it does not import application code
or data from a local private corpus.

## Small contracts

1. `runSupportedProgram(name, selection)` runs a statically registered,
   converted PROG in batch mode and returns a structured result plus captured
   list lines. Reuse the existing GUI report host's parameter and list
   contract. Reject unsupported reports explicitly.
2. A job has a durable ID, name, ordered steps, start condition, state
   (`scheduled`, `ready`, `running`, `finished`, `failed`), timestamps, error,
   and captured list. Commit to enqueue; run each step in a separate dialog
   step. State transitions must be recorded before an event can make a
   successor ready. Define restart/retry behavior before parallel workers.
3. An event has a name, parameter, source job/step and unique ID. A completed
   tail step emits once; a waiting successor becomes ready once. A failed step
   does not emit its success event. Show the event in the job history.
4. A minimal persistent business log stores object/subobject, run and job IDs,
   timestamp, severity, and message text, and can be read by run or job. Show
   it beside captured list output. Treat a BAL-compatible ABAP API as a later
   adapter with separately measured behavior; the first slice only promises
   this explicit storage/read contract.
5. The doctor initially reads job/event/log rows on demand. Later a daemon
   may wake on a timer or message and perform the same checks. The daemon must
   not run SUBMIT itself: the measured daemon contract forbids it. It can
   enqueue ordinary job work and observe its result.

## Proof before widening support

Run two chains with separate events; one completes and the other stops at a
controlled failure. Check captured list, business log, event lineage and
doctor diagnosis across a process restart. Check that duplicate tail delivery
cannot run the successor twice. Then decide whether `SUBMIT ... VIA JOB` and
SAP-shaped BAL/spool adapters are worth adding. Keep the initial supported
PROG registry and selection syntax narrow.

Related design: [GUI reports](../gui-reports.md),
[ABAP daemons](../abap-daemons.md), and
[the backlog](../backlog.md).
