# ADR 0004 — Which engine does what on the hot path

**Status:** Accepted
**Date:** 2026-09-25
**Deciders:** Alice; open-steamgate (two sessions)
**Context:** how fast an edit can reach a running system on each backend, and
what it would take to make OSGo (ABAP compiled to Go) rebuild itself. The
ideas behind it and their reasons are in `docs/ideas.md`.

## Context

On the JS path a save reaches the running system in about 0.46 s on Node and
0.55 s in the Bun binary (`OSD_WARM=1`, `docs/warm-compile.md`). On OSGo the
same edit needs `go build` and a new process:

| step | measured on the prototype with a Go package per group of dependent classes |
|---|---|
| full build | 17.5 s |
| one method, one package | 9.3 s |
| one method, standard and Z code split in two | 6.4 s |
| a leaf class | 1.2–1.5 s |
| a hub interface | 3.75 s |
| the floor | ~1 s: go overhead 0.25 + main package 0.2 + link 0.5–0.7 |

Those are `go build` alone. The front end (abaplint) and the Go emitter are
not incremental on that path yet: the per-class IR in JSON exists on a branch
and is not merged, and the emitter still writes the whole program. The
estimate of ~1.65 s from save to a new answer for a leaf assumes both become
incremental.

## Decision

1. **The dev loop stays on JS; OSGo is the product runtime.** Node or the Bun
   binary does the warm rebuild; OSGo serves.
2. **When OSGo needs a hot path, the pair is Bun + OSGo.** The Bun binary
   carries abaplint and the emitter with a JIT (JavaScriptCore), and OSGo
   stays pure Go. Both cross-compile to Linux, macOS and Windows without cgo.
3. **IR-JS stays an oracle, not a runtime.** It compiles and loads the whole
   system (784 classes), but its runtime has no database, ICF, APC or store.
   A full port is estimated at 30–45 days for a server about 2× slower than
   OSGo. A hybrid is kept as a candidate: IR-JS for computation, with a bridge
   to the JS runtime at the seams where data crosses by value — the database
   client, the HTTP request and response, the store's JSON. The emitter would
   mark as async only what reaches a bridge. Estimate 4–7 days. The reason to
   do it would be a path trace (ADR 0003, point 7) inside an extension that
   has no Go.

## Rejected, with the reason

- **V8 inside the Go binary (v8go, over cgo).** cgo gives up Go's plain cross
  compilation, so every target needs its own C++ toolchain or a CI runner.
  Windows support is doubtful, and the binary grows by ~30–40 MB. Even then,
  OSGo could not rebuild an edit without a Go toolchain. Bun + OSGo gives the
  same JIT without any of it.
- **A JS engine compiled to wasm** (QuickJS under wazero). It is pure Go and
  portable, but a wasm guest has no JIT. That is the class of engine we
  measured already: goja parsed the system in 196 s against 3 s on Node.
- **abaplint rewritten in ABAP (self-hosted)** as a way to speed. Its core is
  about 86,000 lines, and the half that matters here is syntax (22,000) and
  statements (12,000). A port would be a fork that drifts from an upstream
  that moves every week, and abaplint is its author's main product. ABAP
  compiled to Go also carries ABAP's semantics (padded fixed-length text,
  copy on assignment), so it is not expected to beat TypeScript on V8.
  Kept only as a fun item: compiling the lexer and the statement parser
  (~13,000 lines) as a test that the compiler can host itself.

## Research, parked until measured

- **Interpret the emitted Go of an edited class** inside a running OSGo
  (yaegi or igop), with the rest compiled. The semantics stay one, because it
  is the same Go that is compiled later. The risks are the boundary with the
  compiled runtime — an interpreted type implementing a compiled interface —
  and the language coverage. The spike loads one emitted class and measures
  whether it runs, its load time, and interface calls in both directions.
- **Calls between classes through a registry of slots** instead of direct
  calls, so that a newer version of a class can shadow the old one. This is
  the precondition for any hot swap in Go, whether interpreted or loaded as a
  plugin (`-buildmode=plugin`: Linux and macOS only, never unloaded).
- **Linking without DWARF** (`-ldflags=-w`), measured against the 0.5–0.7 s
  link.
