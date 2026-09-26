# Ideas register

Every idea that was weighed, with what became of it and why. A rejected or
parked idea is not proposed again without a new fact that answers its reason.
Decisions of weight have an ADR (`docs/adr/`); this file is the index and
the short form.

**Status:** `accepted` (decided, being done or next) · `candidate` (wanted,
not scheduled) · `research` (needs a measurement first) · `waiting` (blocked
on someone else) · `parked` (not now, reason given) · `rejected` (not doing,
reason given) · `fun` (for its own sake).

Costs are estimates by the sessions that proposed them, not measurements.

**Order agreed 2026-09-25:** Q1 → Q2 → Q3 → Q6 → B0 → B1. The Q items are built
against a server started by hand; B0 then carries the same extension with
the system inside it.

## Product and editor (ADR 0003)

| id | idea | status | reason / next step |
|---|---|---|---|
| S0 | SAP's ADT for VS Code against our ADT façade | accepted | a test client for the façade (it is Eclipse ADT on a headless Equinox), not our editor; licence read first; 1–2 d spike; same work as the ADT proxy for OSGo |
| B0 | The system is an extension: a VS Code extension carrying the whole system, no separate binary | spike done (#104), packaged as one universal .vsix (#105, #106, #107) | feasibility measured 2026-09-25: runs unchanged on VS Code's Node v24, `node:sqlite`, no native module by default; needs the DB and TLS paths moved out of the working directory; `output/` is 64 MB |
| B7 | adt-express: one small JSON protocol, answered natively here, by the same ABAP classes on a system with the plugin, and by vsp over ADT on a system without it | accepted (spec first) | optimistic writes (`If-Match`, one LUW) remove the need for a session; APC + daemon + AMC only where state is needed |
| B8 | Multiverse of runs: record and replay a dialog step, find where a failing run leaves a passing one, step back in time | candidate | replay via the dialog-step module and the DB seam works on any engine; the path trace needs our own emitter (Go) |
| Q1 | Debugger through VS Code's JS debugger and the transpiler's source maps | done (#94) | checked 2026-09-25: 795 maps, mapped per statement to the `.abap` line; relative source paths resolve from the real generation folder |
| Q2 | Thin extension: CodeLens run/call, Test Explorer, generation in the status bar | done (#95, #96 keys, #97 Call EntitySet, #109 test groups) | 2–3 d; abaplint stays the language server |
| Q3 | Readers of a class in CodeLens | done (#98, warm index #103) | 0.5 d; the numbers are in the warm registry |
| Q4 | Dumps as diagnostics on the ABAP line ("Hotspots") | done (#100: ZOSD_DUMP, heat, badges) | 1 d; first step of B8 |
| Q5 | The `osd` MCP server as language-model tools in VS Code | candidate | 0.5 d |
| Q6 | ABAP and SQL notebooks | SQL done (#99); classrun and F9 done (#101); ABAP cells need a scratch layer in the object store | 2–3 d; a cell runs through the warm build (an ABAP cell becomes a throwaway class, 0.5 s), an SQL cell through Open SQL |
| Q7 | SEGW editor and Fiori preview in a VS Code tab | candidate | ~1 d; the pages exist |
| B1 | Tests chosen by the closure of an edit, rerun on save, results inline ("Wallaby for ABAP") | accepted (order 6) | 1–2 weeks |
| B5 | Behaviour of recorded OData requests before and after an edit | candidate | +3–5 d on B1's engine |
| B2 | A sandbox MCP for agents (write, activate, run unit, call OData, SQL, where-used, dumps) | candidate | a real system only as the A4H sandbox, only in throwaway packages, only when asked |
| B6 | The same unit test locally and on a system, a mismatch drafted as an ANORMALIES entry | candidate | same condition as B2 |
| B3 | A real debug adapter on Go | candidate | 3–6 weeks; if Q1 is not enough |
| B4 | ABAP in vscode.dev / Codespaces | candidate | the web variant of B0; waits for the OSGo-in-the-browser wave |
| R6 | Zed extension | parked | mostly a repackaging of Q2/B3; almost no audience |
| R7 | The ADT debugger through our façade | research | long-polling and a stateful debug session: weeks |
| — | ABAP-in-CI product (GitHub Action, hosted checks) | rejected | abaplint's own offering serves CI for ABAP; we build on abaplint |
| — | A codename for the project | rejected | the name stays open-steamgate |

## Engines and the hot path (ADR 0004)

| id | idea | status | reason / next step |
|---|---|---|---|
| E1 | Dev loop on JS (Node/Bun, warm), OSGo as the product runtime | accepted | 0.46 s / 0.55 s save to answer; Go's floor is ~1 s plus a restart |
| E2 | Bun + OSGo as the pair when OSGo needs a hot path | accepted | JIT without cgo; both cross-compile to three platforms |
| E3 | IR-JS as a full runtime | parked | 30–45 d for a server ~2× slower than OSGo; stays the oracle |
| E4 | IR-JS hybrid: computation in IR-JS, a bridge to the JS runtime at the by-value seams | candidate | 4–7 d; worth it for a path trace inside the extension |
| E5 | Interpret the emitted Go of an edited class in a running OSGo (yaegi / igop) | research | spike: one class, load time, interface calls both ways |
| E6 | Calls between classes through a registry of slots | research | precondition of any hot swap in Go |
| E7 | Classes loaded as Go plugins, shadowing older ones | research | Linux/macOS only, never unloaded; measure the build time of one plugin |
| E8 | Link without DWARF (`-ldflags=-w`) | research | measure against the 0.5–0.7 s link |
| E9 | Per-class incremental emit + merged IR JSON | accepted | the part of the Go path that is not incremental yet |
| E10 | DIAG and RFC listeners native in OSGo (Go), from the Go code the sibling projects already have (the DIAG tape screen, open-rfc-go) | accepted (backlog) | today the Pi Zero stand runs the JS listeners as a separate Bun binary (81 MB file, ~33 MB RSS); one Go binary should answer HTTP, HTTPS, DIAG and RFC |
| — | V8 inside the Go binary (v8go) | rejected | cgo: per-target C++ toolchains, Windows doubtful, +30–40 MB, still no rebuild without a Go toolchain |
| — | A JS engine compiled to wasm under Go | rejected | no JIT in a wasm guest; goja measured 196 s against 3 s |
| — | abaplint rewritten in ABAP for speed | rejected | ~86,000 lines, a fork of a fast-moving upstream, and ABAP semantics cost speed in Go |

## For its own sake

| id | idea | status | note |
|---|---|---|---|
| F1 | ABAP → MinZ: ABAP on a ZX Spectrum | fun | also a test that the IR is not tied to JS or Go |
| F2 | Numeric kernels of the demo scenes as GLSL shaders | fun | |
| F3 | abaplint's lexer and statement parser compiled from ABAP | fun | a self-hosting test of the compiler (~13,000 lines) |

## Parked elsewhere

- Portable AMDP (pAMDP): parked 2026-09-25; value parity against HANA is the
  first step when it returns (`docs/handover-pamdp-2026-09-24.md`).
- The licence of open-abap-odata: parked (ADR 0003, consequences).

## Tails and small items

Things found along the way that are not ideas of their own: each has the
reason it was noticed and the smallest next step. Status as above.

| id | item | status | reason / next step |
|---|---|---|---|
| T1 | Reuse libraries independently: a transpiled library as its own cached, versioned artefact keyed by its own content; a build transpiles only the upper layers and links the libraries' prebuilt modules | candidate | fast cold builds everywhere (extension first start, CI, fresh clones). Caveat: a module's output depends on the registry it was transpiled in, so an override in a later layer must invalidate the library's dependents (the warm closure knows them). Builds on transpiler `only` (#1900/#1921) |
| T2 | A portable generation hash, so a .vsix can ship a prebuilt generation and the first start is a cache hit (~4 s instead of ~23 s) | candidate | a locally built transpiler puts its path and git state into the hash, and a packaged copy has no git state left; needs a metadata file written at packaging time (docs/vscode-extension.md, Packaging) |
| T3 | A smaller .vsix (0.1.2: 90.8 MB unpacked, 34.7 MB packed) | candidate | ~21 MB is demo-pack media that is already compressed; text compresses only ×4–5 because a .vsix is a zip, compressed per file. Media out of the package, the seed as one solid .tar.xz/.zst unpacked by the materialize step, no .map files: ~8–12 MB expected |
| T4 | One system identity, read by every client | candidate (nailed to client 123 for now) | the data client is one place already (tools/osd-identity.mjs, OSD_CLIENT, default 123); the ADT client 001 is on purpose (Eclipse projects, the session cookie's name). Expose client/SID/user/language on /osd/serving and ADT discovery; the extension reads the data client from there instead of its MANDT_CLIENT constant |
| T5 | Windows: build/live and output are symlinks, which need admin rights without Developer Mode | accepted | junctions for directories |
| T6 | The Pi Zero stand does not come back after the board reboots | candidate | an @reboot start |
| T7 | Warm build inside the extension's launched system: OSD_WARM when memory allows (≥ 4 GB), Rebuild = warm activation, Full rebuild = cold, "warming up" in the status bar | accepted | the server side (warm state on /osd/serving, a copy fallback when hard links fail) is in progress |
| T8 | The extension's tree grouped by kind (OData / Apps / ICF / APC, later daemons, jobs, transactions); a node is a pointer to its source plus one action; a Launchpad node | accepted | one composing GET route on the server, entity sets lazily from segw/entitysets |
| T9 | An Eclipse-like package tree in the extension, over the ADT façade's own repository/nodestructure routes (one truth with Eclipse) | accepted | check how completely nodestructure expands a class before building on it; adt-express only once its spec exists |
| T10 | "Also serve DIAG/RFC for SAP GUI / Eclipse" in the extension, off by default | candidate | a free 32nn/33nn pair shown to the user; the listeners run with demo authentication, so not by default |
| T11 | Smart F8 and a Gateway client: per method, create/update/delete, function imports, $expand, value help | candidate | Q2b covers read only |
| T12 | "Any output": CL_DEMO_OUTPUT (a stub in open-abap-core today), the classic WRITE list, ALV, into the console and notebook cells | candidate | one output sink per run |
| T13 | Classic reports through open-abap-gui's converter: ALV untried, dynpro (module pool) not driven, report state lives in process memory so a recycle or a warm swap loses it | candidate | spike #113 runs three examples in webgui and in a VS Code tab |

| T14 | The extension materializes its system per version, so a rebuilt .vsix with the same version reuses a stale copy | accepted | key the materialized copy by the seed's content (a hash written at packaging time), not the version number; found when a same-version reinstall kept a copy without a newly fetched pack |
| T15 | The extension as its own release artifact from this repository: its own version and CHANGELOG, a `vscode-v*` tag that builds the .vsix and attaches it to a GitHub release (later: the marketplace) | accepted | a separate repository only once adt-express makes the extension a client of real systems too; today server and extension change together in almost every PR |
| T16 | An extension icon from the airship sketch (open-steamgate's steam-and-gate): a vector master in SVG, a 128×128 PNG for the marketplace, and a monochrome silhouette for the Activity Bar | candidate | the Activity Bar needs a single-colour SVG; the marketplace icon must be PNG |
