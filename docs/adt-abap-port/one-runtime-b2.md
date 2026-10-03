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

`POST /osd/adt-step` is declared in `src/icf/nodes.json` but never mounted
by the public parent router. The child requires a loopback socket, the switch,
`content-type: application/json`, and `X-OSD-ADT-Step-Key`, compared with
`timingSafeEqual`. The supervisor generates a random key per spawn and passes
it through `OSD_ADT_STEP_KEY`; only the internal remote caller sends it.
Input is `{view: {method, path, url, headers, query?}, bodyHex?}`. The parent
asks the child's router whether it needs the body before hexing it, keeping
HOST bodies in the parent. The door accepts 34 MB for a public 16 MB body
plus hex and metadata. Non-JSON errors are checked before decoding; a child
413 becomes an ADT 413. Output is `{record, adt}` with UTF-8 record bytes and
session locks as entry pairs. Invalid views/hex get 400, missing/wrong keys
403, other content types 415, and the switched-off door 404.

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
disconnect rejects all pending calls; individual calls time out after 120 s
except ACTIVATE and SYSTEM BUILD, which wait until reply or disconnect.
Parent listeners and deferred work are discarded when that child exits.

`step` increases per child dialog step, and is stable across calls and WAIT
roll-out. Only final step end sends `store-step-ended`; LUW end does not.
ACTIVATE validates in the parent, then queues publication against that step.
The child receives the provisional `EV_ACTIVE = X`, empty `EV_LIVE`, and
`EV_NOTE = "live after the step"` so it can finish and release the FIFO.
The parent keeps publication promises per step and request context. The
remote ADT runner waits for them before replaying the client's record,
including build, promotion and recycle. Publication or promotion failures
return a 200 ADT activation failure document, making the outcome visible to
the client as in the Node activation route. Dumped/terminated steps refuse
queued publications. ACTIVATE outside a dialog step publishes immediately.
Non-bridged activation retains its synchronous result.

## SYSTEM routing

| Resource owner | Kinds |
|---|---|
| Parent, through IPC and the request's SYSTEM binding | BUILD, CHANGED, GIT, SERVING, SUPERVISOR, WARM |
| Child database / compiled generation / dump ring | SQL, SQLCHECK, CLASSRUN, DUMP, XREF, SERVICES, TRANSACTIONS |
| Child request/session binding | IDENTITY, SESSION, LOCK_HANDLE, LOCK_RELEASE, LOCK_HOLDER |

SQL and XREF use the child's Data connection, SQLCHECK checks there, CLASSRUN
instantiates the child's compiled class in the current step, and DUMP reads
its ring. New kinds are accepted only with the switch on. Future database
kinds stay local: only the explicit parent-kind set crosses IPC. Unknown kinds, or parent kinds without an installed answer,
retain a refusal. Parent kinds have no production answerer yet; this slice
does not implement future A8 route bodies.

## Scope differences and remaining slices

Some B3 compatibility had to land with B1/B2: remaining Node routes use
`view.sessionCall` plus JSON args through the same door. `whileHeld` and
`deleteObject` use `OSD_SESSION_CALLBACK` IPC messages so parent store work
runs while the child's session/handle check holds its step. Delegated logoff
ends the child session before a queued LOCK can proceed; a regression test
proves that ordering. This prevents a second parent session authority when
the kernel is absent, while those routes remain unported.
[B3](one-runtime-b3.md) now extracts those calls into the dedicated
`/osd/adt-sessions` door; `view.sessionCall` is no longer accepted.

B4's RESUME door and B5's physical kernel deletion remain separate work.
The new database SYSTEM implementations are installed in the serving child;
installing the same new kinds in inline hosts remains future port work.
Workers other than the primary still own independent ENQ tables, as in the
note. This slice does not claim pool-wide lock synchronization or crash
durability for an in-memory database. Default behavior remains switched off.

**Before the switch is turned on by default** (open items from review):
- A step without an ADT context (the G.8 editor's ZCL_OSD_EDIT ACTIVATE) is
  still answered "live after the step" before publication, and a failed
  publication there is not reported. Record the outcome where the editor
  sees it, or answer "activation queued".
- The parent's wait for a deferred publication has no upper bound if the
  child stays alive but its "step ended" message is lost; bound it by the
  build time plus the recycle limit.
- A route with a body costs one extra round trip for the body-required probe.
- ADT now shares the child's recycle: a request inside the child when a
  publish recycles it gets about 2 s to finish, then a GET is retried and a
  write answers 500. That is the cost of option B, by design.
