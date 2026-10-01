# ADR 0008 — A lock server (ENQ): a goroutine first, then a socket

**Status:** Accepted (Alice, 2026-10-01). Release tier: E0, E1 and the ADT skeleton 0.6 must; E2 0.6 should; E3 0.7 nice; replication generous (`docs/backlog/gogen-osgo.md`, "The lock server (ENQ) and the ADT façade in ABAP")
**Date:** 2026-10-01
**Deciders:** Alice; open-steamgate (dell, stoker)
**Context:** the ADT façade keeps its locks in a private map, and vsp's
integration suite showed it drift from a system (ADR 0007). The ABAP façade
needs `ENQUEUE_*` to work as on a system, and the OSGo dispatcher's several
work processes need one lock table between them. The contract was measured
first (E0).

## Context

Today there is no enqueue in the runtime. The ADT façade has a lock map of
its own, and every rule in it was added after a client tripped over its
absence (`fix/adt-lock-session`). ABAP that calls `ENQUEUE_<obj>` has
nothing to call.

E0 measured the contract on the A4H sandbox (ABAP release 758) on
2026-10-01, as a client: our own RFC-enabled probe modules called a
generated lock module over a throwaway table and read the lock table back
with `ENQUEUE_READ`. No kernel code, no source of SAP's lock modules and no
SAP client library was read. The probe objects were deleted afterwards.

- The rules, the two compatibility matrices and how a second owner was
  obtained: [`docs/enq-contract.md`](../enq-contract.md).
- 61 cases with `expect` = what the system answered:
  [`test/fixtures/enq/contract.json`](../../test/fixtures/enq/contract.json).

Both are on branch `feat/enq-e0-contract` until it merges. This ADR
summarises them; the contract is those two files.

## Decision

1. **E1: the lock table is one goroutine.** Package `tools/gogen/go/enq`. One
   goroutine owns the table; requests arrive on a channel and get their
   answer on a reply channel; there is no mutex. An owner is the session id
   plus the LUW id, which mirrors the two owner ids the system shows
   (`GUSR` for the session, `GUSRVB` for the LUW's update owner).

2. **The same contract on Node, as one module.** Every Node host (OSG-JS,
   the Bun binary, the preview) imports the same module. A rule that every
   host must follow lives in a module they all import, not in a comment next
   to one caller (the `tools/osd-dialog-step.mjs` lesson in CLAUDE.md).

3. **The ABAP side is generated.** `ENQUEUE_<obj>` and `DEQUEUE_<obj>` are
   generated from lock objects (abapGit `ENQU`), with the parameters a
   system generates (`MODE_<table>`, the key fields, `X_<field>`, `_SCOPE`,
   `_WAIT`, `_COLLECT`; exceptions `FOREIGN_LOCK`, `SYSTEM_FAILURE`). Plus
   `DEQUEUE_ALL` and `ENQUEUE_READ` with its row shape.

4. **Gate.** Every E0 fixture answers SAME on Go and on Node. Neither is
   done while one case differs.

5. **E2: the same protocol over a local socket.** A unix socket, or
   127.0.0.1 on Windows. No authentication, so never on a public address.
   The lock server runs as its own process; OSGo work processes and OSG-JS
   are its clients. A client holds its locks under a lease with a
   heartbeat, so a dead process's locks go. E2 lands with the multi-WP OSGo
   dispatcher; before that one process has no one to share a lock with.

6. **E3: an SM12-style view** of the lock table, with a manual release, in
   0.7.

| item | label | owner |
|---|---|---|
| E0, the measured contract | 0.6 must | dell (done) |
| E1, Go | 0.6 must | stoker |
| E1, ABAP generation and the Node host | 0.6 must | dell |
| ADT skeleton on ENQ (ADR 0007) | 0.6 must | dell |
| E2, the socket | 0.6 should | stoker |
| E3, the SM12 view | 0.7 nice | open |
| replication across a lock-server restart | generous | open |

## Consequences

Each of these follows from a measured case, and each is a rule the owner
model has to get right:

- **Locks live as long as the session, not the call.** On a stateful RFC
  connection the locks survived the end of each call and went only with the
  session. A lock server that releases at the end of a request repeats the
  0.4 ADT defect. The server must know when a session ends.
- **COMMIT WORK alone releases nothing.** A `COMMIT WORK` with an empty
  update task kept the `_SCOPE 2` locks and did not renew the update owner.
  `_SCOPE 2` locks went only after a V1 update had run (still there right
  after the statement, gone within 2 s; at once with `AND WAIT`). So the
  owner model must see the LUW and the update task, not only the COMMIT
  statement.
- **ROLLBACK WORK releases `_SCOPE 2`** and renews the update owner.
  `_SCOPE 1` and the dialog half of `_SCOPE 3` stay.
- **Release at the end of a session is asynchronous.** Straight after
  `RFC_CONNECTION_CLOSE` the rows were still there; one second later they
  were gone. A test of ours may wait up to 1 s; it may not assume zero.
- **An initial key field is generic.** Without `X_<field> = 'X'` an initial
  field matches every value, in both directions, and `ENQUEUE_READ` shows it
  as U+FFFF. `*` in a value is a literal character, not a wildcard.
- **`_WAIT` gives up after about 4.7 s** against a lock that stays held, and
  was granted after about 1.0 s when the holder ended. A host must not hold
  the work-process lock (`osd-dialog-step`) while it waits, or nobody else
  can end the holder's step.
- **The matrices are exact.** Another owner: E and X refuse everything, S
  and O are compatible with S and O; the refusal is `FOREIGN_LOCK`, `MC 601`,
  `sy-msgv1` = the holder. The same owner cumulates one mode with a count,
  keeps mixed E/S/O as separate rows, refuses anything with X as `MC 602`;
  a DEQUEUE takes one count off, and one with the wrong mode, scope or key
  is a silent 0.
- **ADT gets locks for free.** Once the façade is ABAP (ADR 0007), ADT LOCK
  and UNLOCK are `ENQUEUE_*` and `DEQUEUE_*`. The ADT refusal (403,
  `ExceptionResourceNoAccess`, EU 510) is then the façade's rendering of
  `FOREIGN_LOCK`, not a rule of its own.

## Alternatives

- **A map behind a mutex.** Rejected. One goroutine owning the state, with
  requests on a channel, is the house style for the Go runtime (small
  self-contained packages under `tools/gogen/go/<name>`, idiomatic `chan` /
  `select` / `context`). It also serialises the requests the way a single
  lock server does, so ordering questions have one answer.
- **The database as the lock table.** Rejected. Locks must survive a
  rollback that the database undoes: `ROLLBACK WORK` keeps `_SCOPE 1` locks,
  and a step that dumps rolls back its rows but not the session's locks.
- **Locks per request.** Rejected. That is the 0.4 ADT defect: a stateless
  request cleared a session's locks. The measured contract says locks live
  with the session.

## Open questions

These were not measured in E0 and are not in the fixtures. The first
implementation refuses or ignores them visibly rather than guessing:

- `_COLLECT` and `FLUSH_ENQUEUE`.
- Mode R (promotion of O to E).
- V2 update modules, and the locks of an update that fails.
- `_SCOPE` inside the update task itself.
- The `_WAIT` retry count and interval as values; only two elapsed times
  were measured.
- `SUBMIT ... AND RETURN` as an owner.
