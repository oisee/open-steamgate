# ADR 0003 — Product direction after the warm build

**Status:** Accepted
**Date:** 2026-09-25
**Deciders:** Alice; open-steamgate (two sessions)
**Context:** the ideas round of 2026-09-25, after a save of a class began to
reach the running system in about half a second (`OSD_WARM=1`,
`docs/warm-compile.md`). The full list, with every idea's status and the
reason, is `docs/ideas.md`.

## Context

The runtime now does things no SAP-side tool does: it runs ABAP locally,
rebuilds only the closure of an edit, knows who reads a class, and can replay
the same request on two generations of the code. The question was which
products follow from that, and which do not.

## Decision

1. **The name stays open-steamgate.** No separate codename. The command is
   `osd`.
2. **We do not build an ABAP-in-CI product** (a GitHub Action or a hosted
   check that runs ABAP Unit on a pull request). CI for ABAP on GitHub is
   served by abaplint's own offering, and this project is built on abaplint.
   If something here is useful only in CI, it goes to those tools as a
   library or a PR, not as a product of ours.
3. **Our editor features add only what a local runtime alone can do.** Parsing,
   diagnostics and navigation are abaplint's language server. What we add
   needs execution: the save reaching the running system, tests chosen by the
   closure of an edit, the readers of a class, the behaviour of a request
   before and after an edit, a run compared with a system, dumps on the line
   they happened at.
4. **SAP's ADT for VS Code is a test client for our ADT façade, not our
   editor.** It is the Eclipse ADT client on a headless Equinox, so it asks
   what Eclipse asks, from a shell that is easier to drive. Its licence is
   read before anything beyond watching its requests.
5. **"The system is an extension" is the flagship candidate.** A VS Code
   extension that carries the whole system and needs no separate binary. The
   engine is the JS path, because a user has no Go toolchain to rebuild an
   edit (ADR 0004). Measured 2026-09-25: the server runs unchanged on the
   Node that VS Code ships (v24), on `node:sqlite`, with no native module
   loaded by default (DuckDB is loaded only when asked for). What packaging
   needs is paths: the database and the TLS directory are written relative
   to the working directory, and `output/` is 64 MB.
6. **adt-express: one small protocol, three implementations.** A JSON surface
   for managing a system: an object is addressed as abapGit addresses it,
   and a source is a file in abapGit's format. The operations are read,
   write, check, activate, run unit, where-used, SQL preview, dumps and
   events.
   - This runtime answers it natively.
   - A system with the plugin installed answers with **the same ABAP
     classes**, deployed through abapGit.
   - A system without the plugin is reached through vsp, which translates to
     ADT and keeps ADT's stateful session itself.

   A client asks for the capabilities and learns which path it is on.
   - **Writes are optimistic**: lock, write and unlock happen in one request
     and one LUW, guarded by `If-Match` on the previous version's hash. So
     editing needs no stateful session.
   - **State only where it is needed** (a debugger, long runs, events): APC
     for the channel, a daemon and AMC so that work outlives the connection.

   On a real system, the plugin goes only where a manifest allows it. The
   specification comes first, reviewed before any code.
7. **Runs are kept and compared** ("the multiverse of runs").
   - **Record a dialog step, then replay it.** A dialog step is recorded at
     the two points where everything nondeterministic enters: the dialog-step
     module and the database seam. It is then replayed exactly.
   - **Find where two runs diverge.** Comparing a failing run with passing
     runs of the same code — from tests, from history, or from the previous
     generation — needs a trace of the path. Only our own emitter can give
     that trace, which in practice means Go.
   - **Dumps on the line they happened at** are the first step.

## Consequences

- `docs/ideas.md` is the register: every idea with a status (accepted,
  candidate, research, parked, rejected) and the reason, so a rejected idea
  is not proposed again without new facts.
- The licence of open-abap-odata (still "todo") is parked. It is revisited
  before anything is published in a way that is clearly distribution (a
  marketplace package); the fallback is a clean-room rewrite of the part we
  did not write.
