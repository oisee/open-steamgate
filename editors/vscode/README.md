# open-steamgate (osd)

A local `/IWBEP/` OData v2 runtime for classic, code-based SEGW services --
transpile real ABAP `_MPC_EXT` / `_DPC_EXT` classes, run them over SQLite,
serve a Fiori Elements app -- packaged so it runs entirely inside VS Code.
No SAP system, no separate install, no terminal.

## What it does

- **▶ Start** builds and runs the whole system from inside the extension
  (the "OSD" Activity Bar view): `▶`/`■` in the status bar, a tree of the
  running state, the layers and the OData services it serves.
- Open a folder holding abapGit ABAP (a `.abapgit.xml`, or
  `src/*.clas.abap` / `*.prog.abap`) and it becomes a layer on top of the
  bundled system automatically -- your classes run beside the demo's.
- ABAP Unit in the built-in Test Explorer, one item per test class and
  method.
- `Ctrl+F2` Check, `Ctrl+F3` Activate, `F8` Run, `F9` Run as ABAP
  Application (Console) over an `.abap` editor -- the SAP GUI / ADT
  bindings, on by default (`osd.keymap`).
- A CodeLens "▶ Call \<Set\>" over a SEGW `_DPC_EXT`'s own
  `GET_ENTITYSET` / `GET_ENTITY` methods, and "read by N · tests M ·
  services K" over a class or interface's own definition line.
- Short-dump hotspots as line decorations and Explorer badges.
- `*.osdnb` SQL notebooks over the running system's own database.

## Requirements

Nothing to install beyond the extension itself: the runtime (Node's own
`@abaplint/*` transpiler and runtime, `express`, the SQLite database) ships
inside the `.vsix`. The first `▶ Start` copies it into VS Code's own
extension storage and builds once (a few seconds); after that, an unchanged
build reuses its own cache.

VS Code's bundled Node must be new enough for `node:sqlite` --
practically, a recent VS Code (1.88 or newer, the `engines.vscode` this
extension declares) on desktop or in a Remote-WSL / Remote-SSH window
(`extensionKind: ["workspace"]`: it always runs where the folder is, never
only in a local UI host).

`osd.home` overrides the bundled copy with a checkout of your own (the
development path); leave it empty to use what the extension ships.

## License

MIT. See `LICENSE`.

---

Part of [open-steamgate](https://github.com/oisee/open-steamgate).
See `docs/vscode-extension.md` in that repository for the full design
(Q1-Q6, "B0 spike", "Packaging").
