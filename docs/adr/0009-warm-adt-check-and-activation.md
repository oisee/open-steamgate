# ADR 0009 — Warm ADT Check and activation of classes and programs

**Status:** Accepted for the Node runtime; implementation on `feat/adt-warm-edit-loop`.
**Date:** 2026-10-05
**Deciders:** Alice; open-steamgate

## Context

ADT Save previously rebuilt the whole source index before acknowledging the
write. Save now only stores inactive source and invalidates the index. Check
and Activate perform validation when requested. Full validation of dependencies
must remain correct; cached callers cannot be trusted after a provider changes.

Classes and interfaces already have a warm compiler and module replacement
behind `OSD_WARM=1`. The compiler retains the active registry in a separate
process and recompiles an edited object and its transitive readers. The Eclipse
diagnostic server previously ran with that flag disabled.

Compilation and loading are separate decisions. Importing a class module
registers its class in `abap.Classes`; calls subsequently use that registry.
Importing a program module executes report code at module scope. Treating a
program as a class replacement could run a report merely because its source
was activated.

## Decision

| Object/change | Compilation | Loading the result |
| --- | --- | --- |
| Class body or supported interface edit | Warm: object and transitive readers | Replace modules under the work-process lock when safe |
| Existing include without a program declaration or generator-sensitive constructs | Warm: include and transitive readers, including programs | Recycle the serving runtime if the rebuilt closure contains a `.prog.mjs` module |
| Report/program declaration; SUBMIT lowering; generator input; new/deleted file; unsupported edit | Full build and generators | Recycle the serving runtime |
| Module held by the host, unsafe imports, or refused replacement | Warm build may remain usable | Recycle rather than replace modules |

1. **Save does not compile or validate.** It writes inactive source and returns.
   Compilation, dependent checks, publication and runtime loading belong to
   Activate. A successful activation is returned only after its generation is
   available to the serving runtime and the checked source revision is promoted.

2. **Reuse the compiler for Check.** The worker serializes Check, prime and
   build. Check temporarily substitutes the requested editor text, invalidates
   the object and its transitive readers, checks them, and restores active text
   in `finally`. It neither publishes modules nor promotes inactive source.
   Findings carry the actual source URI and ADT severity, including findings in
   dependent objects.

3. **Preserve the saved-source semantics of ordinary Check.** If another file
   has different saved and active bytes, including another include of the same
   class, Check falls back to the existing saved-tree check. It does not silently
   substitute active dependencies only because the warm compiler is available.
   Activate retains its existing semantics: selected objects as saved, other
   inactive objects as active. Unavailable or stale warm state also falls back.

4. **Warm includes conservatively.** The current report generator reads sources
   with `REPORT` declarations, not include contents. Declaration-bearing sources
   stay cold, as do SUBMIT sources and the existing AMDP/interface generator
   exclusions. An unchanged include's XML metadata may be reused; metadata
   changes still require a full build. Rebuilt program modules are never imported
   by `HotLoader`. Runtime recycling provides the new generation to subsequent
   explicit report execution.

5. **Keep the full dependency check at activation.** Warm compilation rechecks
   the affected closure, including previously cached callers. Compiler failure,
   source revision changes and refused loading cannot yield successful activation.
   A warm activation does not rebuild the parent source index before responding;
   the invalidated index is recreated when an outline request needs it.

## Consequences and limits

Class edits can avoid both a full compile and a runtime restart. Includes can
avoid a full compile but still pay for a restart when they affect programs.
Reports retain the full path until generator inputs and explicit report loading
are separated further. A warm registry must finish priming before it is used.

This does not add INCLUDE execution to the pinned transpiler. Where that
transpiler emits an INCLUDE placeholder, warm compilation must produce the same
bytes as cold compilation; interpreting or expanding includes is a separate
task. The regression checks dependent diagnostics and cold byte equivalence.

The flag, compiler timeout, process/heap recycling and cold verification remain
the existing mechanisms described in [warm-compile.md](../warm-compile.md).
Measured Eclipse timings should distinguish compile time from runtime recycle
and the complete ADT request. These choices apply to Node; they do not claim
module replacement for the Go runtime.

## Implementation and verification

- Compiler: `tools/osd-warm.mjs`, `osd-warm-process.mjs`, `osd-warm-worker.mjs`.
- Check: `tools/adt-warm-check.mjs`, `adt-checkrun.mjs`, and both ADT serializers.
- Activation/load: `tools/adt-facade.mjs`, `osd-store.mjs`.
- Regressions: `test/warm-edit-loop.mjs`, `warm.mjs`, `warm-process.mjs`,
  and ADT wire checks in both Node and ABAP modes.
