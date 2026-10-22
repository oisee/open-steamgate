# VS Code web and desktop: the parity plan

A plan, not work in progress (2026-10-22). Release 0.7.2118 ships one
package with both entries: the desktop `main` (a local osd on Node) and the
`browser` entry, which runs the gateway in the extension host's web worker
([`vscode-web.md`](vscode-web.md)). In vscode.dev that worker already serves
the service tree, F8 Data Preview, SQL notebooks, every launchpad tile, APC
channels and SMW0 media. This file collects what the sessions working on
the runtime, the demo and the release proposed: what to bring to parity, what
to bring to one common implementation, and in what order. Nothing here has
started; each stage gets its own branch when it does.

## Stage 0 -- correctness first

1. **Every entry into the ABAP in the web gateway goes through
   `tools/osd-dialog-step.mjs`, APC included.** This is already the rule in
   CLAUDE.md ("every host" is every entry into the ABAP); the web gateway has
   to catch up with it. The proof is a behavioural test, not a check of the
   imports: a request that dumps after an INSERT, then a modifying request,
   and the first request's rows must not appear. The same test runs on all
   three hosts (Node, the Pages service worker, the VS Code web worker).
   A change to the shared module is announced to the runtime owner.
2. **One contract suite for the database seam.** The eleven methods of
   `DatabaseClient` plus the LUW (commit, rollback, savepoint, trimmed
   literals), run against all four implementations: `@abaplint/database-sqlite`
   and `tools/duckdb-client.mjs` on Node, sql.js and DuckDB-Wasm in the
   browser. sql.js and DuckDB-Wasm both start under Node, so the suite runs in
   mocha without a browser. One DuckDB version is pinned for Node and Wasm:
   the dialect is the same, but versions and the available extensions
   differ, and an unpinned pair differs silently in SQL (AMDP on
   `osd.web.database=duckdb` depends on it). Wasm32 also caps memory near
   4 GB.
3. **The generation hash in the browser equals the one on Node.** Bun and
   Node named different generations until every directory read was sorted;
   walking IndexedDB or OPFS carries the same risk. One test: web hash = Node
   hash for the same input.
4. **No synchronous wait anywhere.** In a worker, `WAIT UP TO` and the
   timers are asynchronous only, so the runtime has to be asynchronous end to
   end; a synchronous sleep on the Node path is the divergence to look for.
   `Atomics.wait` needs cross-origin isolation, which vscode.dev has (it is
   why UI5 loads with `crossorigin=anonymous`), so it remains an option to
   measure, not an assumption. Clocks: `performance.now()` is coarser in a
   browser, so `GET RUN TIME` is coarser too; the time zone comes from
   configuration, never from the browser.

## Stage 1 -- one scenario, two hosts

- **One scenario file, two runners**: real desktop VS Code through
  Playwright `_electron` (headless Ozone), and Chromium on
  `@vscode/test-web`. The oracle is the Node gateway host.
  openvscode-server is dropped as the desktop oracle: its `!isWeb`
  when-clauses hide the desktop commands, and working around that leads
  nowhere.
- **Compare data, not pixels.** Normalised text and data: F8 and notebook
  rows as JSON, OData answers, the APC reply. Fonts, theme, width and the
  vscode.dev chrome differ, so screenshots are kept as artefacts for review
  and for the book, never diffed. The tree is compared as a node list minus
  the documented differences (launcher on desktop, status service on the
  web).
- **Reference scenarios, in this order**:
  1. the tree and the System view;
  2. F8 on the same TABL and the same DDLS;
  3. APC: one Zork command gives the same answer (the open-before-drain
     ordering is host-specific, which is why it comes early);
  4. a SQL notebook cell gives the same result;
  5. launchpad, Travels, Create, and the new row is visible in F8;
  6. one smoke run per tile.
  Media and sound are not reference scenarios: "plays" and "does not fail"
  leave nothing to compare.
- **One driver**: the palette / open / goto / see / step helpers that exist
  twice today (the demo's screenshot script and
  `scripts/equiv-vscode-hosts.mjs`) become one module, `test/vscode-driver.mjs`,
  with a host adapter (electron, web). The demo repository imports it from
  `OSD_HOME`, as it imports Playwright now, and its book shots become the
  shared steps plus `shot()`. The clean-profile settings move there too, and
  both hosts get one "ready" signal (today the demo waits for the status bar
  and the web test for its probe).
- **A desktop-only list with an explicit "n/a on the web"**: F9, the
  debugger, `.http` cases, ADT. A missing feature on that list is a decision,
  not a divergence.

## Stage 2 -- desktop functions on the web

- ABAP Unit (`runUnit`): yes; it is pure runtime and runs in the worker.
- Background jobs: only as "run now", and only after stage 0.1. Periodic and
  background jobs do not live in a browser tab; that is a server's job.
- ADT: no. Its place is the desktop and the server (the osgo runtime).
- Debugger: desktop. A simplified web one (steps and variables through the
  JS source map) is possible later without real ABAP breakpoints.
- HTTP replay from a pack's fixtures: a later candidate, after the port to
  osgo.

## Stage 3 -- one implementation

- **One page runtime for the three Fiori hosts**: the Pages service worker,
  the vscode.dev webview bridge and the desktop webview. After stage 0, or
  the rules get a third copy.
- **One media file-name function with a test**: `build/media` of the preview
  and `dist/web/media` of the extension (`@25` / `@40` escape) name the same
  W3MI objects in two ways. Low priority.

## Stage 4 -- release

As decided: only a must-item blocks a tag; a tag needs Alice's explicit yes;
a merge follows green CI on the head commit, never auto-merge. Open: the
Marketplace token for unattended stable publishing (today it exists only as
an Actions secret, and a stable can also be uploaded by hand).

## Waiting on Alice

1. **The layer of an open repository in the browser.** Today vscode.dev
   shows the bundled system, not "your ABAP". The proposals agree on a
   **precompiled artefact**: the layer is transpiled in CI or on a server into
   a bundle shaped like a pack (a folder, `osd-fetch`, the generation hash)
   and the worker loads it by commit hash. The transpiler in a worker of its
   own, on demand, is possible for small repositories only: a cold parse
   takes about 3 s, 92% of it parsing. gogen is not the route (it targets Go;
   IR-JS is still an experiment), and the browser osgo is parked. After the
   layer: Check and Activate, then F9/classrun in the worker, which turns the
   web story into "edit, then run".
2. **Who owns stage 1.** The driver and the book scenarios exist in the demo
   repository, and the web runner is in this one, so one owner for each side
   is the simplest split.
