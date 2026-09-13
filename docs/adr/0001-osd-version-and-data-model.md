# ADR 0001 — OSD version & data model: git-native, no object registry

**Status:** Accepted — all three sessions agreed. Drafted by vsp; transpiler's two amendments incorporated (generation-counter liveness id in point 4, schema-drift rule in point 7); open-steamgate asked for point 5 to be marked a decision rather than a description, which it now is. This copy under open-steamgate is canonical; vsp's is the client-side author copy.
**Date:** 2026-09-13
**Deciders:** Alice; vsp (client), open-steamgate (façade/serving), transpiler (store/runtime)
**Context repos:** open-steamgate (OSD), vsp (the ADT client)

## Context

OSD (the Off-Stack Doppelgänger) has no SAP database of objects. Its objects
**are files in a git working tree**:

- `src/` — ABAP source (`*.clas.abap` + `*.xml`)
- `output/` — transpiled JS
- `data/` — seed rows (`*.tabu.json`); live rows in the DB (`STG_DB_PATH`)

A write through the ADT façade (vsp `source write`, or any ADT client) **edits
those working-tree files**: PUT lands in `src/` immediately, activation
transpiles into `output/` and synchronously recycles the serving runtime. The
serving unit is `(source tree, port, database)`.

There is a standing temptation to track per-object **versions/provenance at
runtime** — a UUID or version register saying "this activated object came from
version N of branch Y", with operations to promote/reconcile versions between
instances. That path **reproduces SAP's Transport-Request pain**: version
divergence, merge-by-copy, "object locked in another request", activation
overtakers, and the "which version is where" problem. Transports are a homegrown
versioning layer that is *worse than git*; re-deriving one on JS would be a
self-inflicted TR.

## Decision

1. **Git is the sole version / branch / provenance layer.** Objects are files;
   versioning is git commits and branches; combining work is `git merge` /
   `rebase` (real 3-way, with history); provenance is `git log` / `git blame`.
   **No bespoke per-object version register.**

2. **The experiment/instance unit is `(git worktree/branch [source], DB file
   [data], port [serving])`.** Parallel experiments are multiple such units.
   Already first-class as of open-steamgate 17e14c2. Example:
   ```
   main   → worktree/   → :8099 → osd.sqlite
   exp-A  → worktree-A/ → :8101 → osd-A.sqlite
   exp-B  → worktree-B/ → :8102 → osd-B.sqlite
   ```

3. **"Deploy" has two separate meanings; keep them separate:**
   - **Into OSD** (edit-and-run): ADT write → working-tree files → **synchronous
     activate** (transpile + recycle, empty-200 = true receipt) → live.
     `git commit` is an optional checkpoint. No UUID, no register.
   - **Out to a real SAP system** (the last mile): an **abapGit archive from a
     chosen git ref** → carried by vsp → the real system. **One transport at the
     boundary, not N.** abapGit is already git-shaped — anti-TR by design.

4. **The runtime liveness id is a generation counter, not a hash.** An integer
   that increments within one supervisor and resets to zero on restart, exposed
   in `/osd/serving` beside `root` and `database`. It is per-instance and
   **meaningless across instances by design**: a counter cannot be compared
   between processes, so no sentence like "instance B should be at generation 7"
   even parses. (A content/commit hash is deliberately *avoided* here — the
   moment two instances can compare hashes, someone asks whether B is at A's
   version, and that question is the first step of the register we refuse.) If a
   content/commit identity is ever wanted it is **derived from git at read time
   and never stored**. **Red line: never build a "move version X from instance A
   to instance B" operation** — that *is* a transport. Cross-instance combining
   is `git merge` + re-`deserialize`; shipping is the abapGit archive.

5. **OSD must run from a dedicated worktree, never a human's main checkout —
   DECISION, not yet implemented.** *Current state (2026-09-13): OSD runs from a
   human's checkout; ADT writes land in that checkout's tracked `src/` (a new
   object from an IDE lands in `src/osd/`), so edits accumulate uncommitted in
   the working tree an operator is using.* The decision: OSD should run from a
   **dedicated worktree**, so every ADT edit dirties the working tree of an
   isolatable, revertible branch (`git checkout .` / commit) rather than an
   operator's main checkout. Until that lands, treat this isolation as a target,
   not a guarantee — do not assume it exists. *Update, same day: `npm run
   osd:worktree -- <name>` now makes one (`tools/osd-worktree.mjs`), sharing
   `node_modules`, `.local/lars` and `.local/tls` by symlink rather than
   copying them, and serving from it needs no code change because the store
   and the supervisor already take their root from the working directory.
   Measured: a write through the store with the worktree as root landed in
   the worktree's `src/osd/` and the operator's checkout stayed clean. What
   is still true is the default — `npm run osd:serve` serves from wherever
   it is run, so the isolation is available rather than enforced.* **`/osd/serving` answers with the
   tree and database file the instance is actually using**, so which checkout an
   instance serves is at least verifiable, not assumed (a real bug caught today:
   two trees served, the address looked right, the code behind it was not).

6. **Data (DB rows) is per-instance and persisted (`STG_DB_PATH`), separate from
   source (git).** A recycle must not eat a client's rows; source and data
   version on different axes (git vs the DB file).

7. **Schema drift between the two axes is detected, never pretended.** A DB file
   carries a **fingerprint of the schema it was created from**. A runtime that
   opens a file whose fingerprint does not match the schema its current code
   would generate must **say so and not serve the old schema** — otherwise
   "separate axes" (point 6) becomes a lie: a DB seeded from branch A's DDIC,
   opened by branch B whose tables differ, would silently serve rows the current
   code does not describe (reachable today by the very worktree-per-experiment
   workflow this ADR recommends). The fingerprint is a **compatibility check
   only** — never promotable, never compared between instances — and the answer
   to a mismatch is always to **rebuild local data**, never to move data from
   elsewhere. **Policy (default, Alice's to flip):** on mismatch, **report
   loudly and rebuild clean** (reseed for the current schema), since mismatched
   rows are incompatible with the current code anyway; an opt-out **refuses and
   lets the human choose** when the data is worth inspecting. Never silent either
   way — never silently serve the old schema, never silently wipe.

## Consequences

- Merge, history, rebase, blame come for free from git; none of the TR-class
  pain is built, because it is not built at all.
- Parallel experiments = more (worktree, port, DB) triples; no shared mutable
  state, isolation by construction (a broken experiment can't touch another).
- Richer provenance, if ever wanted ("running object ← commit X of branch Y"),
  is **derivable from git at any time** (blame; the abapGit archive carries the
  commit) — a derivation, not a schema change. The design stays open.
- Cost: a **recycle within an instance is cheap** — the serving runtime does not
  parse (0.7–0.9s boot); only the façade parses (3.9s), which is why only the
  serving half is recycled. N parallel experiments on N *different* branches
  still cost N façade parses (each parses its own branch); optimization (later):
  share the immutable library parse (open-abap-core, gateway) and re-parse only
  the experiment delta.
- Discipline required: run OSD from a worktree; `git commit` to checkpoint.

## Alternatives rejected

- **Per-object UUID / version register with cross-instance promotion.**
  Reproduces Transport Requests — the exact pain OSD exists to escape. Rejected.
- **One shared instance with branch-switching.** Different branches = different
  code and data; a single running module graph and DB cannot represent several
  at once, and isolation is weak (one crash/mutation affects all). Rejected in
  favour of instance-per-worktree.

## One-line summary

OSD objects are files in a git tree; the ADT façade edits them; **git is the
only version/branch/provenance layer**; an experiment is `(worktree, port, DB)`;
the boundary to a real system is an abapGit archive. The TR problem is not
solved — it is **never built**, because git already does the hard part.
