# Lean jobs, events, business log and a doctor

This is a staged end-to-end slice. It does not require general SAP spool,
arbitrary SUBMIT, or classic ALV fidelity. The aim is to run and inspect a
useful chain of background work. The synchronous log audit can precede the
supported-PROG batch runner; job execution depends on that runner.

## Open demo scenario

Use fictional airship maintenance data in a separate demo. First run a
synchronous fleet audit and inspect its saved business log after a restart.
Then schedule two connected chains: voyage inspection ends with a tail event,
and ship readiness waits for that event before its summary step. A deliberately
failing worker lets the user inspect a stopped chain. A doctor observes
persisted job state and logs, reports a stalled/missing tail event, and can
later be hosted by an ABAP daemon.

This scenario is original demo material; it does not import application code
or data from a local private corpus.

## Small contracts

The first independently useful gate is a persistent business log: run ID,
object/subobject, severity, timestamp and message, with a read-only viewer
filterable by run and severity. Two audits stay distinct; failures are visible;
saved messages remain readable after restarting the local system. Measure the
chosen BAL calls and persistence behavior on A4H before claiming SAP
compatibility. A memory-only stand-in cannot satisfy this gate.

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
4. Link each job and step to the same persistent business log and show it
   beside captured list output. Choose a BAL-compatible ABAP adapter only
   after its behavior is measured; keep any unsupported behavior explicit.
5. The doctor initially reads job/event/log rows on demand. Later a daemon
   may wake on a timer or message and perform the same checks. The daemon must
   not run SUBMIT itself: the measured daemon contract forbids it. It can
   enqueue ordinary job work and observe its result.

## Proof before widening support

First run two synchronous audits, one successful and one failed, and read
their separate logs after restart. Then run connected chains: on success both
finish, while a controlled upstream failure leaves the dependent chain
waiting. Check captured list, business log, event lineage and doctor
diagnosis across a process restart. Check that duplicate tail delivery
cannot run the successor twice. Static `SUBMIT ... VIA JOB ... NUMBER ... WITH`
now carries bounded immutable scalar input to each converted report step;
dynamic programs, ranges, selection variants, and spool options remain unsupported.
Then decide whether broader `SUBMIT ... VIA JOB` forms and
SAP-shaped BAL/spool adapters are worth adding. Keep the initial supported
PROG registry and selection syntax narrow.

Related design: [GUI reports](../gui-reports.md),
[ABAP daemons](../abap-daemons.md), and
[the backlog](../backlog/README.md).
