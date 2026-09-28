# Source layers: current behavior and design map

This page connects the current source-layer implementation to plans for archives and immutable dependencies. It is a map of existing behavior and open decisions, not a new runtime contract.

## Current behavior

| Input | Discovery and storage | Write behavior |
| --- | --- | --- |
| Project source (`input_folder`) | Listed in `abap_transpile.json`; later folders win on an object name. | `ObjectStore` marks ordinary roots writable, except `gen`. An existing object is written in the root that owns it; a new one goes to the first writable root unless a caller names a root. |
| VS Code workspace folder | `detectWorkspaceLayers()` accepts a folder with `osd-pack.json`, `.abapgit.xml`, or class/program ABAP under `src/`. `ensureWorkspacePacks()` links the folder into extension storage as a pack. | The pack root is writable. The link points to the opened folder, so source edits change that folder. |
| VSIX bundled system | The package carries a seed tree; the launcher copies it into extension storage on first use. | The copied home is writable. Updating the extension does not make the installed package directory a workspace. |
| ABAP libraries | Configured in `abap_transpile.json`; ObjectStore loads them as library roots. | Read-only (`writable: false`). |
| abapGit ZIP | Export exists; automatic ZIP import as a source layer does not. | Undecided. |

The effective build order and collision rules are described in [Track E of the backlog](backlog.md#track-e--content-packs-and-layers-what-the-tree-is-made-of) and [Generations](generations.md). The write rules live in [`tools/osd-store.mjs`](../tools/osd-store.mjs) (`rootsOf`, `ObjectStore.write`), and VS Code discovery/projection in [`editors/vscode/launcher.js`](../editors/vscode/launcher.js) (`detectWorkspaceLayers`, `ensureWorkspacePacks`).

## ZIP layer proposal (not implemented)

Treat an abapGit archive as a content-named, immutable extracted source layer. Verify archive paths and contents before publication to the cache. Reusing the same archive should reuse the same extracted bytes; replacing it should create a new cache entry. Send edits to an explicit writable workspace/overlay rather than modifying the extracted cache. Record both the archive identity and overlay order in the effective input manifest, so the generation hash changes when effective source changes.

This needs a write policy for an object whose winning definition comes from the archive: either refuse a direct edit until the user chooses a writable target, or create an explicit copy in the overlay and show where it lives. Do not silently write through a cache path. Decide whether an override replaces a complete ABAP object or individual files; the backlog identifies `.clas.abap` without `.clas.xml` as the deciding case.

The current `writable` flag distinguishes store roots that can receive writes; it does not encode source provenance, cache lifetime, or an overlay target. Those are design inputs for ZIP support, not current behavior.

## Related decisions and plans

- [ADR 0001: git-native version and data model](adr/0001-osd-version-and-data-model.md) makes Git the source history and branch model and recommends isolated worktrees for edits.
- [Generations](generations.md) describes immutable built artifacts and content-derived build identities. Source ZIPs would be inputs to a generation, not generations themselves.
- [Workbench object tools](workbench-object-tools.md#follow-up-remove-ambient-mutable-dependencies) plans content-addressed immutable library dependencies shared across worktrees.
- [VS Code extension](vscode-extension.md) describes workspace packs and the writable copy of the VSIX seed.
- [Backlog, binary layers 1.5](backlog.md) records ZIP-as-layer and the unresolved object-vs-file override rule.

ADR 0001's per-process liveness counter and the later Generations document's content identity serve different purposes, but their wording about hashes differs. Clarify that relationship before making an archive hash visible as an ADT version identifier.
