# ADR 0007 — The ADT façade in ABAP, clean room

**Status:** Accepted (Alice, 2026-10-01). Release tier: 0.6; the skeleton is must, the endpoint groups are should (`docs/backlog/gogen-osgo.md`, "The lock server (ENQ) and the ADT façade in ABAP")
**Date:** 2026-10-01
**Deciders:** Alice; open-steamgate (dell, stoker, osg-research)
**Context:** vsp's integration suite against `osd` vscode-v0.4.1444 found
session and lock defects in the ADT façade, and showed which routes are
missing. The façade is Node code today, so OSGo and the browser preview have
no ADT. The lock side of this decision is ADR 0008.

## Context

The ADT façade is `tools/adt-facade.mjs` (3000 lines on `main`, 2026-10-01)
plus five helper modules (`tools/adt-session.mjs`, `adt-versions.mjs`,
`adt-cds.mjs`, `adt-documents.mjs`, `adt-source-properties.mjs`). It runs
only in the Node host (OSG-JS, `test/start.mjs`):

| host | ADT today |
|---|---|
| OSG-JS (Node) | yes, `tools/adt-facade.mjs` |
| OSGo (ABAP compiled to Go) | none |
| the browser preview (service worker) | none, apart from the data preview route in `web/preview-runtime.mjs` |

vsp's integration suite ran against vscode-v0.4.1444 on 2026-10-01. Of its 57
tests:

| result | tests |
|---|---|
| pass | 18 |
| fail: a route we do not serve | 16 |
| fail: needs an SAP-standard object | 7 |
| fail: we answer differently | 5 |

The remaining 11 are not counted in these four groups.

The suite also found session and lock defects. They are fixed in the Node
façade on branch `fix/adt-lock-session`:

- A stateless request no longer clears a session's locks.
- One lock owner per object, across sessions.
- A held lock is refused in A4H's format: HTTP 403,
  `ExceptionResourceNoAccess`, T100 message EU 510 with V1 = the user and V2 =
  the object. It is refused per session, even when both sessions are the same
  user.
- A database error keeps its text on the way to the client.
- A package created over ADT is visible at once.

The lock map in the Node façade is a private enqueue table. Each fix above
was one more rule added to it by hand. A system answers these questions with
`ENQUEUE_*` calls and its lock server; ADR 0008 builds that.

## Decision

1. **The façade moves to ABAP.** It becomes ABAP source under `src/`,
   compiled by the transpiler to JS and through the IR to Go. One codebase
   then serves OSG-JS, OSGo, the browser preview and vsp's CI.

2. **The core is our own URL router.** An ICF handler for `/sap/bc/adt/*`
   (`if_http_extension`, as `zcl_stg_http_handler` already is for OData) owns:
   routing, the CSRF token, and the stateful session. Everything else is
   content: a handler per endpoint group, written to the wire contract. The
   router is ours and fast; it is not a framework copied from anywhere.

3. **Host interfaces stay thin.** The ABAP side asks the host for three
   things only: the object store (read and write source), git history
   (versions), and the build (check, activate). Each is a small interface the
   host implements; no ADT logic lives in the host.

4. **Clean room.** We do not use, read or name SAP's server-side ADT
   implementation classes, and we do not use SAP client jars. The contract
   comes only from the wire:
   - A4H answering us as a client (vsp, curl, our own probes);
   - the open-source abap-fs client, where its behaviour shows what a client
     expects.

   This is the same rule as ADR 0008's lock contract and the rest of the
   repository: the interfaces we implement are the contract, the
   implementation is ours.

5. **Migration by diff, two gates.** An endpoint group moves to ABAP only when
   both hold:
   - **Gate 1, every change:** its answers diff equal against OSG-JS (the Node
     façade) on vsp's scenarios. Until then the Node façade serves it.
   - **Gate 2, before the switch:** the A4H diff harness from vsp-i7 shows no
     difference for that group that is not already a recorded, accepted entry
     in ANORMALIES. It is the oracle's oracle: it checks what OSG-JS answers
     against a real system, so it runs before each group switches and
     occasionally otherwise, not on every change. A known difference from the
     system is fixed in OSG-JS first (where Gate 1 then carries it over), never
     copied into the ABAP façade.

6. **Ownership.** dell builds the skeleton: router, CSRF, session, and locks
   through ENQ (ADR 0008). After that the endpoint groups run in parallel:

   | group | owner |
   |---|---|
   | versions; lock / write / unlock / activate | stoker |
   | search, nodestructure, source read | osg-research |
   | check, ABAP Unit, data preview | dell |

7. **Release.** 0.6. The skeleton is a must and blocks the tag. The groups
   are should. The ABAP façade replaces the Node one group by group, and only
   when that group is diff-equal.

## Consequences

- OSGo and the preview get ADT as soon as a group moves, with no
  per-host port. vsp's CI can run against any of the three hosts.
- A lock becomes an ordinary `ENQUEUE_*` call, as on a system. The session
  and lock rules fixed by hand in `fix/adt-lock-session` come from ENQ's
  measured contract instead (ADR 0008), so the façade cannot drift from it.
- For a while there are two façades. The Node façade stays the reference
  until the last group has moved, and every fix to it before then is also a
  case the ABAP group must pass.
- The diff gate needs vsp's scenarios to run against two hosts and compare.
  That harness is part of the skeleton's work.
- Some of the 7 tests that need SAP-standard objects stay red. Clean room
  means we do not ship those objects; a test that needs one is answered with
  our own object or marked as out of scope.
- Speed: every ADT request now runs ABAP. On Node that is the transpiled
  code; how much slower than the hand-written JS router it is gets measured
  on the skeleton, not guessed.
- ABAP source is 7-bit ASCII. Handler code and its comments go through
  `npm run lint` like any other ABAP under `src/`.

## Alternatives

- **Keep the façade in Node and port it to Go and the preview by hand.**
  Rejected: three implementations of one wire contract, and the lock defects
  above show how a hand-kept copy drifts. One ABAP source is one
  implementation.
- **Write the façade in Go and call it from the other hosts.** Rejected: the
  preview has no Go, and ADT would then not run on a system's ICF the way the
  OData path does.
- **Build on SAP's own ADT framework classes or client jars.** Rejected:
  clean room. We reimplement the wire, not SAP's code.
- **Move everything at once.** Rejected: without the per-group diff a
  regression has nowhere to show. Group by group keeps the Node façade as a
  live reference.

## Open questions

- How the stateful session maps onto each host: one ABAP session per ADT
  session on OSG-JS is clear; on OSGo it depends on the multi-WP dispatcher
  (ADR 0008, E2).
- The exact host interface for "build": check and activate are deferred
  operations today (compiler-deferred); the interface may need an
  asynchronous answer.
- Which of the 16 missing routes go into 0.6 and which wait. The groups
  above are the first cut.
- Where the diff harness lives: in vsp, here, or both.
