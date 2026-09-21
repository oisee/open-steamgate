# Workbench object tools and reliable development generations

Status: implemented on `feat/workbench-object-tools`, pending merge.

## Product slice

The Fiori Workbench is the common object surface; it does not create a second
repository, activation engine, SQL path or ABAP Unit engine.

| Object | Source | Save / Check / Activate | Data | Tests |
| --- | --- | --- | --- | --- |
| Class (CLAS) | yes | yes | — | discover and run class/method |
| Interface (INTF) | yes | yes | — | — |
| Program (PROG) | yes | yes | — | discover and run class/method |
| CDS source (DDLS) | yes | yes | preview through the existing ADT SQL door | — |
| Table (TABL) | generated DDL, read-only | no | preview through the same runtime/database | — |
| Service definition (SRVD) | source, read-only | no | — | — |

The browser flow proves both new verticals rather than only rendering their
controls:

1. Open `ZOSD_TEST_ITEM`, observe that it is browse-only, and preview the
   six seeded rows.
2. Open `ZCL_ZOSD_TEST_DEMO`, discover its test tree without executing it,
   run one passing method, then run the deliberate failure and display its
   assertion.

The object-test API validates that the selected test class and method belong
to the requested object before it starts the existing isolated runner.
Doctor owns system/infrastructure checks; Workbench owns tests attached to
the object in front of the developer.

## Why the worktree failure was possible

A git worktree contains only tracked files. OSD also needs three local inputs:
`node_modules`, `.local/lars`, and optionally `.local/tls`. The supported
`osd:worktree` path shares those inputs, but this branch was created with
plain `git worktree add`. The build accepted absent library folders because
the underlying generic transpiler treats a missing library as an empty input.
It therefore produced a smaller but apparently successful system.

There was a second hole: `open-abap-apc` is intentionally represented by a
directory containing a symlink to its sources. The generation walker did not
follow directory symlinks, so those bytes could affect transpilation without
affecting the generation hash.

## Reliability contract

A generation may become live only if all of these statements are true:

1. Every configured source, pack and ABAP library root exists and is non-empty.
2. Every byte that can influence generated or transpiled output participates
   in the generation identity, including bytes reached through directory
   symlinks.
3. Transpilation finishes in a private temporary directory; generators still
   write the working tree's `gen/`, so the build lock protects that shared
   output and its content hash detects drift.
4. The completed generation has a manifest and output entry point.
5. Only then may one atomic rename move `build/live`.
6. Failure before or during any step leaves the old live generation and its
   restart path intact.

This slice enforces points 1, 2 and 6 with regression tests. Missing libraries
fail as `MISSING_LIBRARIES` before the build lock, temporary directory or
live switch. Symlinked library content changes the generation hash.

## Follow-up: remove ambient mutable dependencies

Fail-fast makes the present model safe, but the final model should make the
failure unusual:

1. Add one idempotent `osd deps ensure` operation used by checkout,
   worktree, CI and container builds.
2. Resolve every library to an immutable commit/digest and record the resolved
   identity in a lock manifest. A floating URL is not a reproducible input.
3. Store libraries content-addressed (for example
   `.local/lars/by-id/<commit>`) and give each worktree a small manifest or
   symlink set. Worktrees may share immutable content, never a mutable checkout.
4. Make `osd:worktree` callable from either the main checkout or an existing
   worktree, with an explicit `repair` command and a `doctor` report.
5. Validate dependency identity, not only presence: expected commit, dirty
   state, required selected files, Node package lock and native ABI.
6. Put the resolved closure in `manifest.json` and surface it in System
   Status / Doctor so two systems can explain why their object counts differ.
7. Container and Pages builds must use the same resolver in offline/frozen
   mode; they must never fetch a moving branch while producing a release.

The target lifecycle is:

```text
resolve immutable closure -> validate -> hash every effective input
 -> build aside -> verify entry point/manifest -> atomic live switch
```

Worktree convenience must not weaken that contract. Sharing immutable bytes is
an optimisation; accepting an absent or mutable input is not.
