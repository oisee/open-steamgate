
## Next application spike after background jobs

After the [lean jobs and events plan](open-issues/lean-jobs-business-log.md),
run an ABAP-written ZIP/XML converter in OSG, with server-file, interactive
client-upload and HTTP-download inputs feeding one conversion core. The scoped
probe and acceptance checks are in [ABAP ZIP/XML converter spike](open-issues/abap-zip-xml-converter-spike.md).
Use a synthetic public fixture in CI; validate private inputs locally without
committing their bytes, credentials or converted output. The current runtime
transpiles ABAP to JavaScript; a Go output target is a separate research item.

### AMC across processes: job worker → server APC (stoker, 2026-10-06)

A background job runs in its own `osd-batch-runs.mjs worker` process with its
own `AmcBroker`, so its `SEND` never reaches an APC subscriber in the serving
process (`ANOMALY-2026-10-06-amc-one-process`, found by PIA). On a system, AMC
crosses work processes. The planned answer is the supervisor broker of
`docs/abap-daemons.md` step 6. A smaller first cut is enough for the job case:
the worker forwards each publication to the serving process (the ops store or
the parent's IPC), and the server's broker delivers it with the worker's client,
user and program identity. Echo suppression is per session, so it is unaffected.
Acceptance: a job step's `SEND` reaches a bound WebSocket in the server, in
order, and a rolled-back job still delivers what it sent (P8: delivery at
`SEND`). Owner: stoker. Not scheduled. PIA's workaround is inline work in the
APC handler.

