
## 0. Decisions waiting on Alice

**Four of them were answered on 2026-09-19 and are recorded below the block.
0.1 is retired: it asked whether to package as a Bun binary, and the binary
exists and builds (`npm run binary`), so the gate was removed by fact rather
than by decision.** What is left open is 0.7 only.

Nothing below them starts until the answer.

```
0.1  Bun "local ABAP AS" packaging: yes / no                          [A]
     └─ unlocks 1.1, 1.2, 1.3
     └─ feasibility settled 2026-09-13: bun 1.4.2 runs the whole thing,
        107 ABAP Unit tests and the gateway over HTTP, docs/bun-spike.md
     └─ packaging settled 2026-09-14: the %23 defect does NOT block a
        compiled binary. Bun.build({compile, plugins}) with a five-line
        onResolve builds one that runs; only `bun <script>` and the
        plugin-less CLI `bun build --compile` fail. #1841 is no longer a
        gate here (docs/bun-spike.md part two)
     └─ external: open-abap-apc (T's, local only, no remote) for the APC layer
     └─ settled already: it lives in this repository, not a third one

0.2  ADT façade: ANSWERED YES by Alice 2026-09-13, building              [A]
     └─ the contract for waves 0 and 1 is written: docs/adt-facade.md
     └─ unlocks 2.1 .. 2.4
     └─ external: open-abap-adt (interfaces only, LICENSE empty -> spec, not base)
     └─ external: vsp as the oracle and the test client
     └─ external: sanitized ADT fixtures from V; this repository is public,
        so raw captures never come here, V scrubs before handing over

0.3  A4H: what goes up, and when                                      [A]
     ├─ level 1  the SEGW project as an abapGit repository (13 files)
     ├─ level 2  + DDIC, seed data, search help, the hand-written _EXT
     ├─ level 3  + the Travels app as a BSP (three changes, AGENDA)
     └─ needs: package name, transport, the word
     └─ external: A4H sandbox, abapGit installed on it

0.4  draft oracle: build the sample objects on A4H?                   [A]
     └─ plan: docs/oracle-draft.md
     └─ external: A4H; a browser to capture $metadata (MCP cannot)
     └─ risk named there: the writable draft service may not be a SEGW artifact

0.5  RAP oracle: build the sample objects on A4H?                     [A]
     └─ plan: docs/oracle-rap.md
     └─ external: SAP-samples/abap-platform-refscen-flight (Apache-2.0) is
        most of the oracle already
     └─ **CORRECTED 2026-09-19 by asking the system.** The line that used to
        stand here said "A4H 1909 is unmanaged-only, no managed, no draft".
        It is wrong. `abapRelease 758` -- ABAP Platform 2022 -- and the whole
        flight reference scenario is already installed: /DMO/FLIGHT_MANAGED
        (managed), /DMO/FLIGHT_DRAFT (draft, with the draft table
        /DMO/D_TRAVEL_D), /DMO/FLIGHT_UNMANAGED, /DMO/FLIGHT_LEGACY, and
        service bindings in OData V2 **and** V4. Nothing has to be built

0.6  Is depending on ZADT_VSP being installed on the target ok?       [A]
     └─ decides V's deploy route (2. vs 3. on the ladder in 4.2)

0.7  What S does while the above is open                              [A]
     └─ proposal: the analytics chain, 3.1
```

### Answered 2026-09-19

**0.3 — A4H, what goes up: a ladder, not a choice.** Level 1 first; on
success level 2; on success level 3. Each rung is a gate for the next, so a
failure at 1 stops the climb rather than being worked around. Still needed
before the first rung: **package name and transport**.

**0.4 — draft oracle: find out whether it is a SEGW artefact first.** One
cheap query instead of the full build. The risk named in
`docs/oracle-draft.md` is that a writable draft service may not be a SEGW
artifact at all, in which case the whole question dissolves and the build
would have been wasted. Measure the premise before paying for the
experiment.

**0.5 — RAP oracle: `SAP-samples/abap-platform-refscen-flight`, without
A4H.** Apache-2.0 and already most of the oracle.

**The reason given for it was false, and the decision survives anyway.** The
argument was "A4H 1909 is unmanaged-only, so half of RAP is unreachable
there in principle". Asked the system instead of the memory: `abapRelease
758`, ABAP Platform **2022**, and the reference scenario is installed in
full — managed, draft with its draft table, unmanaged, legacy, and bindings
in V2 and V4. So A4H is not a lesser oracle; it is a **better** one, and it
costs nothing because the objects are already there.

What that changes: 0.5 stays as answered, because the repository is still
the thing to read and version. What it opens is that the answers can now be
**measured** against a system rather than read off source — which is the
difference this project keeps paying for everywhere else.

**And 0.4 is answered by the same look.** A writable draft service on that
system is `SRVD` + `SRVB` — no IWPR, so not a SEGW artifact, which is
exactly the risk `docs/oracle-draft.md` named. But those bindings **do**
carry IWMO entries: they register in the same `/IWBEP/` model registry a
SEGW service registers in. Different front door, one registry.

**0.6 — `ZADT_VSP` as the fast path, clean ADT attempted, plain abapGit as
the mandatory fallback.** Three routes in that order, and the last one is
not optional: the product may not require a bridge to be installed before it
can be used. The fast path is an optimisation for systems that have it.

---

---
