# One runtime B2: resource destinations over IPC

B1 and B2 are opt-in with `OSD_ADT_ONE_RUNTIME=1`. In child mode the
parent does not load the ADT kernel; the front, sessions, handles, ENQ and
database reads run in the primary serving child's dialog FIFO. The default
continues to use the parent kernel. B5 will remove that kernel later.

**A destination runs where its resource lives.** The parent owns the source
ObjectStore, files, parsing, checking, building and publishing. Before loading
the generation, the child installs StoreIPCClient as STORE, so even boot-time
class constructors cannot open the former lazy second ObjectStore.

## Door

`POST /osd/adt-step` is declared in `src/icf/nodes.json`, guarded by the
switch and loopback socket address in both the child and parent proxy.
Input is `{view: {method, path, url, headers, query?}, bodyHex?}`; bodyHex is
an optional even-length hex string. Output is `{record, adt}`. The record body
is UTF-8 text, headers are ordered name/value pairs, and the ADT session's
locks are entry pairs. The front restores its Buffer and Map before replay.
Invalid views/hex get 400; the switched-off door gets 404.

The remote runner also passes an internal numeric `context`, session
`identity`, and the facade's JSON `systemIdentity` (or `identityError`). The
context selects the requesting facade's parent store and SYSTEM binding;
it lasts through the reply. Session identity retains the same anonymous-user
default as inline, independent of sysinfo's configured display user.
AbapSessions and `ZCL_OSD_ADT_HANDLER=>ANSWER` execute in one child step.
HOST verdicts and registered continuations execute in the parent afterward.
ADT selects `runtime.primary` in a pool.

## Process-channel protocol

The child sends plain JSON, with no ABAP runtime objects:

```text
{type: "store-request", id, context?, step?, name, parameters}
{type: "store-response", id, values}
{type: "store-response", id, error: "message"}
{type: "store-step-ended", step, ok}
```

`id` increases per child client and correlates concurrent, possibly reordered
replies. `parameters` contains the exporting fields, uppercased, converted
from typed ABAP values. `values` contains the same importing/table fields
as StoreDestination, including its typed refusal envelope and empty defaults.
The client fills the caller's typed fields. Transport errors reject; a
disconnect rejects all pending calls; individual calls time out after 120 s.
Parent listeners and deferred work are discarded when that child exits.

`step` increases per child dialog step, and is stable across calls and WAIT
roll-out. Only final step end sends `store-step-ended`; LUW end does not.
ACTIVATE validates in the parent, then queues publication against that step.
It immediately returns `EV_ACTIVE = X`, empty `EV_LIVE`, and
`EV_NOTE = "live after the step"`. The parent publishes only after successful
step end; dumped/terminated steps discard the queued publication. Publication
failure is logged by the parent and cannot amend the already returned answer.
Normal non-bridged activation retains its synchronous result.

## SYSTEM routing

| Resource owner | Kinds |
|---|---|
| Parent, through IPC and the request's SYSTEM binding | BUILD, CHANGED, GIT, SERVING, SUPERVISOR, WARM |
| Child database / compiled generation / dump ring | SQL, SQLCHECK, CLASSRUN, DUMP, XREF, SERVICES, TRANSACTIONS |
| Child request/session binding | IDENTITY, SESSION, LOCK_HANDLE, LOCK_RELEASE, LOCK_HOLDER |

SQL and XREF use the child's Data connection, SQLCHECK checks there, CLASSRUN
instantiates the child's compiled class in the current step, and DUMP reads
its ring. Future database kinds stay local: only the explicit parent-kind
set crosses IPC. Unknown kinds, or parent kinds without an installed answer,
retain a refusal; this slice does not implement future A8 route bodies.

## Proof and measurements

All test commands used `OSD_HEAVY_RANGE=80-89 tools/osd-heavy.sh`; no full
suite ran. Generation used `WITH_UNIT_TESTS=1`. The new suite is registered
in `test/suites.d/adt.json`; its ASCII global ABAP probe classes are excluded
from release packaging alongside the existing ENQ probe.

| Check | Result |
|---|---|
| Front, diff, CSRF, session, coverage; switch off | 141 passing |
| Same five suites plus one-runtime suite; switch on | 149 passing (141 + 8) |
| STORE, host seam, ENQ, fork, XML, child and initial one-runtime proofs | 154 passing |
| Final one-runtime suite alone, including restart race | 8 passing |
| Coverage in both shapes | 142 manifest endpoints: 95 HOST pending, 46 ABAP, 1 HOST by design |
| ABAP-FS conformance, switch off | 30 PASS, 1 FAIL, 16 MISSING / 47; no regressions |
| ABAP-FS conformance, switch on | 30 PASS, 1 FAIL, 16 MISSING / 47; no regressions |

Both conformance runs verified file hashes and system-side cleanup. The
existing failure is `debugger.coreDiscovery` (client parsing `@_term`).
Server processes were checked after runs; only leftovers from this clone
were terminated by PID.

The child proofs show ENQUEUE_READ sees the ADT lock before and after a
crash, session/table reads and XREF use the child's rows, and HOST writes
validate that same child's handle. A held BUILD answer keeps the child step
open after ACTIVATE: publish count stays zero until release, then becomes
one. The G.8 editor's real HTTP path traverses STORE IPC and a controlled
publication recycles to a different PID; the publication/build itself is
stubbed in that focused test. Conformance separately exercises actual ADT
activation/publication. Child coverage runs the actual ABAP MATCH table.
Injected fault fixtures and isolated session unit cases stay local; the
wire-level comparisons, CSRF/token flows and new child proofs use the remote
front with the switch on.

One sequential run, SQLite memory, persistent session, GET sysinfo, 30 warmup
requests followed by 300 measured requests per shape:

| Shape | Median ms | p95 ms |
|---|---:|---:|
| Inline, switch off | 2.288 | 4.284 |
| Child with parent kernel, switch off | 2.357 | 3.912 |
| Child with remote front, switch on | 3.340 | 5.154 |

The measured increment is **1.052 ms over inline** and **0.982 ms over the
kernel shape**, above the note's approximately 0.5 ms estimate. A request
during a clean recycle waited **2.190 s** and returned 200. A read issued
30 ms after SIGKILL waited **2.202 s** and returned 200. Transport waits for
departure and readiness; safe reads can retry once across a socket/exit race.
Writes retry only a refused connection, never an ambiguous executed write.
These are local single-run measurements, not a throughput/load benchmark.

## Scope differences and remaining slices

Some B3 compatibility had to land with B1/B2: remaining Node routes use
`view.sessionCall` plus JSON args through the same door. `whileHeld` and
`deleteObject` use `OSD_SESSION_CALLBACK` IPC messages so parent store work
runs while the child's session/handle check holds its step. Delegated logoff
ends the child session before a queued LOCK can proceed; a regression test
proves that ordering. This prevents a second parent session authority when
the kernel is absent, while those routes remain unported.

B4's RESUME door and B5's physical kernel deletion remain separate work.
The new database SYSTEM implementations are installed in the serving child;
installing the same new kinds in inline hosts remains future port work.
Workers other than the primary still own independent ENQ tables, as in the
note. This slice does not claim pool-wide lock synchronization or crash
durability for an in-memory database. Default behavior remains switched off.
