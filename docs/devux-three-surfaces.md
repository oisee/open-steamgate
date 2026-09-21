# OSD DevUX: three surfaces, one development model

Status: architecture decision and delivery proposal, 2026-09-21.

Priority addendum: the first implementation wave is now the Gateway regression
kernel and its thin Fiori client, not the polished source editor. The detailed
decision, including Draft, ADT and in-process execution boundaries, is in
[DevUX groundwork: Gateway regression before Draft](devux-gateway-regression.md).

## Decision in one page

OSD should have two primary developer experiences and one optional reference
surface:

1. **Fiori Workbench**, owned by OSD and available wherever OSD UI runs. It is
   the default in-system experience. Its shell and editor control should be
   reusable in a safe static GitHub Pages demonstration, but browser-side
   activation is a separately measured capability rather than a promise.
2. **OSD for desktop VS Code**, a small extension that starts or attaches to an
   OSD runtime and hands editing to VS Code plus `abap-fs`. It is the default
   experience for a developer who already lives in a local Git checkout.
3. **Browser VS Code/code-server**, retained as an optional self-hosted IDE,
   compatibility laboratory and end-to-end conformance client. It is useful,
   but it is not the centre of the product architecture.

These are not three implementations of Save and Activate. They are three
clients of one object store and one state machine:

```text
working text
    |
    v
Save --------> source revision
                   |
             Check + Build
                   |
                   v
             live generation
                   |
              recycle child
                   |
                   v
            serving generation

status = { source, live, serving, synchronized }
failure at any step leaves the previous serving generation alive
```

Git Commit and Push remain separate, explicit actions. A surface may show Git,
but it must not invent another source database or silently publish a saved edit.

## Users and ordering

The primary user of the first delivery is an ABAP developer using local or
hosted OSG to change a service and understand whether it still behaves
correctly. OSG maintainers are the second primary user because the same suites
become compatibility and release gates. An A4H developer is a characterization
and portability user; a GitHub Pages visitor is a demonstration user and must
not be given the illusion of a production development system.

That ordering is why GW0–GW2 precede the polished editor: the first two users
need a trustworthy feedback loop more than a new text surface. After GW2, the
editor and GW3 braid together. Pages reuses the UI only where its browser
adapter can state its limitations honestly.

These are initial relative uncertainties, not calendar promises:

| Track | Uncertainty | Gate before expansion |
|---|---:|---|
| GW0 contract/characterization | medium | synthetic A4H/OSG fixtures and a red negative control |
| GW1 kernel/headless runner | medium | repeatable semantic and wire results |
| GW2 thin Fiori client | medium | same case and verdict from UI and headless runner |
| UX1 hosted editor | high | measured CodeMirror/Monaco spike and conflict test |
| Pages browser activation | very high | transpiler size, latency and correctness measurements |

## Why this split

A Fiori editor is close to the running system. It can share the Launchpad,
identity, object registry, diagnostics and runtime status without giving the
browser a host terminal. It is the best recovery surface when extensions,
containers or a local checkout are broken.

Desktop VS Code is close to the developer's files. It already has excellent
editing, Git, diff, search, keyboard navigation and terminals. OSD should
integrate with those strengths rather than rebuild them in a browser container.

code-server proved the important contract: a real, unmodified client can browse
OSD objects, save inactive source, reject invalid activation, publish valid
source, run ABAP Unit and expose the same change to Git. That evidence remains
valuable even when code-server is no longer the primary product surface.

## Six different meanings of “trusted”

The word “trusted” caused several different concerns to collapse into one. The
architecture treats them separately.

| Trust | Question | Mechanism |
|---|---|---|
| Secure browser context | May the page use protected Web APIs? | HTTPS with a browser-trusted certificate |
| User authentication | Who is opening OSD or the IDE? | OIDC/proxy session or an explicitly local development profile |
| Workspace Trust | May editor extensions execute code from this checkout? | VS Code Workspace Trust and an explicit mounted-worktree boundary |
| Backend authority | Which operations may this user perform? | OSD authorization on read/save/check/activate/test routes |
| Source provenance | Which branch, commit and inactive edit am I looking at? | branch/HEAD, inactive revision and serving-generation identity shown separately |
| Activation confidence | Is this exact revision safe to publish? | immutable revision, checks, build, tests and atomic generation switch |

GitHub Pages solves only the first row. Its `https://` origin is a secure
browser context, but it does not authenticate a user to a private OSD, trust a
Git checkout, start a Node extension host or make an arbitrary backend safe.

## Surface A: Fiori Workbench

### Product shape

The Fiori Workbench is an OSD application launched from a normal Launchpad
tile. It should feel native to the system without copying the visual design or
name of SE80.

A useful first layout is a flexible three-pane workbench:

```text
+----------------------+-----------------------------+----------------------+
| Packages / objects   | Source tabs                 | Context              |
|                      |                             |                      |
| $TMP                 | ZCL_DEMO.clas.abap          | Problems             |
|   $STG               | --------------------------  | Unit tests           |
|     classes          | CLASS ...                   | Active / inactive    |
|     CDS              |                             | Git / generation     |
|     services         |                             | Runtime links        |
+----------------------+-----------------------------+----------------------+
| Save inactive | Check | Activate | Test | Diff | History | Open runtime     |
+----------------------------------------------------------------------------+
```

On a narrow screen the panes become pages in a drill-down flow rather than
three squeezed columns.

### Editor engine

OSD should own the application and interaction model, but should not implement
cursor movement, selections, IME input, undo, accessibility and incremental
highlighting from scratch. The recommended first spike is a pinned open-source
editor kernel, wrapped as an OSD/UI5 control.

**CodeMirror 6 is the leading candidate, not yet the decision.** Before UX1,
build equivalent CodeMirror 6 and Monaco spikes inside an OpenUI5 application.
Record added minified/gzipped bytes, cold time-to-editable and browser heap
while editing a representative large ABAP source. Both spikes must prove
backend diagnostics and a usable diff; the decision is written beside those
measurements. Dependencies are pinned and bundled locally, never loaded from a
CDN.

The selected editor is wrapped as a custom `sap.ui.core.Control`. Its renderer
owns only a host element; `onAfterRendering` creates the editor and `exit`
destroys it. The controller owns the local dirty buffer, explicit Save with an
ETag, Check/Activate calls and navigation. Backend diagnostics enter the editor
as markers/decorations; syntax colour is not treated as validation. Keystrokes
must not become OData writes.

The ABAP and CDS highlighters are presentation helpers, not parsers of record.
Diagnostics come from the same Check/Activate backend used by ADT. A coloured
line is never evidence that code activates.

#### First vertical result (2026-09-21)

The first hosted slice uses the pinned UI5 1.120.50
`sap.ui.codeeditor.CodeEditor` as an interim engine. It already ships an ABAP
Ace mode and owns input, undo, selection, resize, UI5 theme changes,
accessibility labelling and destruction. This was a better first integration
than adding a second editor dependency before the source loop existed. It is
not yet the final CodeMirror-versus-Monaco decision; that measured comparison
remains before the editor contract is declared stable.

The integration rules are now executable rather than stylistic advice:

- declare `sap.ui.codeeditor` in `manifest.json` and the XML view; do not
  construct an editor DOM subtree in a controller;
- isolate Ace-only annotations and `gotoLine` in one `AbapEditor` adapter.
  UI5 marks access to the internal editor as restricted, so no controller or
  application service may depend on it;
- take the already registered parent renderer from UI5 metadata. This pinned
  release has no separately loadable `CodeEditorRenderer.js`, while omitting
  a renderer makes UI5 search for `AbapEditorRenderer.js` by convention;
- put a custom control's `layoutData` aggregation in the custom XML namespace
  and give it `FlexItemData(growFactor=1, baseSize=0)` inside a `VBox`. The
  editor otherwise exists with zero height inside the Splitter;
- keep the live dirty buffer in the editor engine. Binding every keystroke
  back into a JSON model caused a render storm and risked returning stale text
  to the caret. Check and Save read `getCurrentValue()` explicitly;
- acquire the ADT CSRF token and session cookie before any parallel reads.
  Two simultaneous first requests can create two sessions and pair one token
  with the other cookie;
- derive `/sap/bc/adt` from the component resource root rather than the origin
  root, so the same application path remains valid below a Pages prefix.

The permanent browser test enters through the Launchpad tile, opens a real
class in ABAP mode without falsely marking it dirty, refuses an incomplete
Check, checks it clean, preserves an invalid unsaved buffer across a UI5
rerender, follows the Problems row to the exact gutter marker, and proves the
stored source is byte-for-byte unchanged. It also verifies a 412 Save conflict preserves the live buffer and that Activate saves a dirty valid buffer first, carries the resulting ETag into activation, and reports an unswitched serving identity as a warning.

### Minimum useful feature set

The first product slice should include:

- package/object search and navigation;
- class, program, interface and CDS source tabs;
- Save as a new inactive revision;
- Check with exact line/column diagnostics;
- Activate with visible progress and serving-generation confirmation;
- ABAP Unit at class and method level;
- Problems and test-result panes linked back to source;
- diff against active source and Git `HEAD`;
- explicit branch/HEAD, inactive revision and active generation badges;
- a runtime link for an object that exposes HTTP, OData or an application;
- read-only fallback when the backend does not advertise a mutation capability.

Creation, rename, delete, transports, debugger, ATC and arbitrary report
execution are later capabilities. They must not appear enabled merely because
a UI button is easy to draw.

### One write path

The Fiori Workbench must use the same object store and activation endpoints as
ADT. It must not write repository files directly from a second endpoint.

```text
Fiori Workbench ----+
                    +--> Object Store --> Check/Build --> Generation Manager
ADT / abap-fs ------+
```

This gives both clients the same ETags, inactive source, diagnostics and
publication rules. A saved source revision is immediately readable from the
other surface; it is not necessarily live or serving until build and recycle
finish. Cross-surface locking and optimistic-conflict behavior are an explicit
UX1 acceptance test, not inferred merely from sharing the store.

## Surface B: OSD for desktop VS Code

The desktop extension is a supervisor and integration layer, not another ABAP
language client. `abap-fs` continues to own the ADT filesystem and VS Code owns
editing, Source Control, diff, search and terminal UX.

### Commands

The extension should initially provide:

- `OSD: Start`;
- `OSD: Stop`;
- `OSD: Restart`;
- `OSD: Status`;
- `OSD: Connect with ABAP FS`;
- `OSD: Open Launchpad`;
- `OSD: Open Fiori Workbench`;
- `OSD: Open System Status`;
- `OSD: Show Runtime / Source Version Difference`.

### Runtime contract

It operates on the currently opened, trusted Git checkout. It allocates or
validates instance-derived ports, starts a pinned OSD runtime, waits for health,
then configures the matching `abap-fs` connection. Database files live outside
the extension installation and survive extension upgrades.

Two distribution modes deserve measurement:

1. download a signed, checksummed platform archive by exact OSD version;
2. call an explicitly configured, already installed `osd` executable.

The extension must not run `git pull`, `npm install`, a moving-branch build,
Commit or Push during activation. It shows version mismatch instead of silently
changing either side.

### Security boundary

Starting a local runtime is code execution. The extension therefore requires
Workspace Trust, requests a loopback bind and then verifies the actual listener
addresses before declaring readiness, never mounts the Docker socket, redacts
secrets and stops only the child it owns. Windows x64, Linux x64, macOS arm64
and Linux arm64 need native lifecycle and persistence tests.

## Surface C: optional browser VS Code

The existing code-server image remains useful for:

- a remote development workstation where installing desktop VS Code is not
  possible;
- real-client ADT compatibility tests;
- reproducing extension-specific bugs;
- CI or manual E2E of Save, Activate, Unit and Git visibility;
- demonstrating that OSD is not coupled to its own editor.

It should remain an opt-in container, not an iframe hidden inside every OSD.
It has a larger attack surface because it deliberately exposes an editor and
terminal over the network. A hosted deployment needs HTTPS, authentication,
WebSocket support, session/logout coverage and an isolated worktree per user.

## What GitHub Pages can and cannot do

### What it can do well

GitHub Pages can host immutable HTML, JavaScript, CSS and data over HTTPS. It
is therefore an excellent home for a **safe Fiori Workbench demo**:

- the Launchpad and editor load in a secure browser context;
- the OSD browser runtime runs in a Worker;
- demo source and generated artifacts are immutable application assets;
- edits may persist in IndexedDB/OPFS under the Pages origin when storage is
  available;
- a browser database holds demo data;
- Reset restores the shipped snapshot;
- Export Patch downloads the user's changes without requiring GitHub access;
- Playwright can exercise the exact public artifact before Pages promotion.

No production credential belongs in that static bundle.

Browser storage is a cache and working copy, not the only copy of valuable
source: it may be denied, evicted, cleared, or unavailable in an ephemeral
profile, and it is scoped to one browser and origin. Export Patch remains
available and the UI must surface persistence failures. Offline applies first
to the application shell and precached fixtures; lazily loaded media is not
claimed offline until an explicit precache policy and size budget exist.

Editing on Pages does not currently imply activation. The preview contains
ABAP source but not the transpiler. Browser activation is its own feasibility
track, gated on the added worker size, activation latency and correctness
against the server build. Until that gate passes, Pages edits export a patch
and run replay/synthetic cases against the shipped generation.

### What it cannot do by itself

Pages cannot run the current code-server Node process or a Node extension host.
It cannot see a user's local checkout, start a native OSD binary, safely retain
server secrets or bypass CORS, mixed-content and browser private-network rules.
An HTTPS Pages application calling an HTTP OSD on a LAN is intentionally a bad
browser security shape.

A VS Code for Web port is technically a separate future product. It would need
a browser build of the extension, a browser filesystem, Worker/WASM execution,
persistence and a new authentication design. It is not a packaging switch for
the current VSIX.

### Two Fiori modes, one application

The same Fiori Workbench should support two explicit adapters:

| Mode | Source/store | Runtime | Git meaning |
|---|---|---|---|
| Pages demo | packaged snapshot + optional IndexedDB/OPFS edits | shipped browser generation; activation is a separate spike | shipped commit plus downloadable patch |
| Connected OSD | server Object Store | active server generation | real checkout branch/HEAD |

The UI must label the mode. A local browser snapshot must never imply that a
server generation was activated.

## HTTPS, reverse proxy and one-login UX

For a hosted OSD, the reverse proxy is the only public ingress:

```text
Browser -- HTTPS + one session --> reverse proxy
                                  |-- /      --> OSD / Fiori Workbench
                                  +-- /ide/  --> optional code-server
```

The IDE port stays private. After the proxy validates the session, code-server
may use `--auth none` on that private network. This removes the second password
from the user experience without removing authentication from the system.

For a closed LAN demo, a local CA or `mkcert`-style certificate can make the
browser origin genuinely trusted. A self-signed certificate without installing
its CA merely changes an HTTP warning into a certificate warning.

GitHub Pages is a different origin and should not receive the hosted OSD's
session or production credentials. Its default mode is the browser sandbox.

## Shared contracts

All surfaces should depend on a small, explicit capability view:

- discovery: object kinds and operations the runtime actually supports;
- identity: branch/HEAD, inactive revision and active generation;
- source: read, lock, save inactive, diff;
- validation: syntax/semantic diagnostics;
- activation: publish an exact immutable revision and report the generation;
- testing: start, observe, cancel and read a bounded result;
- runtime links: open the application/service produced by an object;
- history: inspect Git and restore as a new inactive edit.

ADT remains the compatibility contract for external tools. OSD-specific UI may
use a compact endpoint where necessary, but it must call the same store and
services underneath rather than reimplement semantics.

This view is derived, not a new registry. Object/path availability comes from
`tools/osd-nodes.mjs`; source/live/serving identity and synchronization come
from the existing build endpoint; remote targets come from the destination
registry. The view only joins those facts for a client and must not maintain a
second list of objects, routes or destinations.

The Workbench itself follows the same rule. In OSG it is a pack `webapp/`,
whose `/app/<pack>` HOST node is derived by `packNodes()`. On a real SAP
system it is deployed as its own BSP application and child SICF node under the
delivered UI5 namespace. It must never claim the delivered namespace node
itself.

## Persistence and recovery

| State | Pages demo | Hosted OSD | Desktop VS Code |
|---|---|---|---|
| shipped source | static assets | checkout/image | local checkout |
| inactive edits | optional IndexedDB/OPFS + Export Patch | Object Store | Object Store + checkout |
| active runtime | shipped Worker generation until the activation spike passes | source/live/serving generations | source/live/serving generations |
| history | snapshot + exported patch | host Git | native VS Code Git |
| recovery | Reset / export | previous generation | Git + previous generation |

The compact zero-JavaScript editor at `/sap/bc/osd/edit/` remains a repair
surface until the Fiori Workbench proves it can recover from its own broken
frontend bundle.

## Delivery plan

### UX0 — record the decision

- treat code-server as optional/conformance rather than the product centre;
- keep the full W2 test as a real-client gate;
- name the two primary surfaces Fiori Workbench and OSD for VS Code.

### GW0/GW1 — regression contract and kernel

- characterize the real A4H Gateway execution boundary;
- define canonical cases, explicit matchers and immutable results;
- implement isolated OSG and A4H execution adapters;
- prove one positive and one intentionally failing case in both headless and
  wire end-to-end runs.

### GW2 — thin Fiori Gateway Client

- add the Launchpad tile, case list/detail and request editor;
- Run, cancel and show response plus semantic diff;
- import and export canonical JSON/ZIP without credentials;
- keep the same suite runnable headlessly.

After GW2 the plan becomes a **braided track**, not a monolithic GW0–GW4
sequence. UX1 supplies source changes; GW3 supplies the test feedback for those
changes. They advance together in end-to-end slices.

### UX1/GW3a — measured editor and first source loop

- create the Launchpad tile and UI5 application;
- measure CodeMirror 6 and Monaco in the actual OpenUI5 shell, then pin the
  winner;
- browse one package and open one class;
- Save inactive, Check, Activate and show Problems;
- display all three version identities;
- keep the old editor as fallback.

Acceptance: invalid code stays inactive and the old runtime remains live;
valid code reaches `source`, then `live`, then `serving` after recycle;
refresh preserves the inactive edit; two surfaces cannot silently overwrite
one another.

### UX1/GW3b — join source and service feedback

- associate the edited object/service with a selected regression suite;
- offer `Activate and Run` without nesting the target request in the save LUW;
- show the exact source/live/serving identities on the immutable RunResult;
- keep the same case runnable headlessly.

### UX2 — Unit, diff and history

- run one class/method and show pass/fail/skip with source navigation;
- diff inactive against active and `HEAD`;
- show object history and restore into a new inactive revision;
- isolate test database writes.

### UX3 — Pages sandbox

- introduce the browser storage/runtime adapter;
- persist edits in IndexedDB/OPFS;
- provide Reset and Export Patch;
- test the deployed Pages artifact, not only the build directory;
- show an unmistakable “browser demo” identity.

### UX4 — desktop extension

- scaffold Start/Stop/Status/Open/Connect commands;
- prove one platform archive and one external-CLI mode;
- add port collision, crash cleanup, persistence and version-mismatch tests;
- expand to the four target platforms only after native runners pass.

### UX5 — hosted single sign-on

- put OSD behind an HTTPS reverse proxy;
- establish a real user/session contract;
- add the Workbench tile;
- optionally place code-server behind the same authenticated ingress;
- test WebSockets, cookies, logout, CSP and direct-port denial.

## Acceptance matrix

| Behavior | Fiori hosted | Pages demo | Desktop VS Code | code-server |
|---|---:|---:|---:|---:|
| browse/open source | required | required | required | conformance |
| invalid activation preserves runtime | required | deferred browser-activation spike | required | conformance |
| valid activation changes runtime | required with source/live/serving proof | deferred browser-activation spike | required | conformance |
| ABAP Unit report | required | replay/read-only subset initially | required | conformance |
| Git working-tree visibility | server facts | exported patch | native | native |
| offline startup | optional | shell/precached fixtures only; media measured separately | required for pinned runtime | deployment-specific |
| no second login | same OSD session | no server login | local trust | hosted proxy target |

## Explicit non-goals

- implementing a text cursor or syntax parser from scratch;
- claiming GitHub Pages can host a Node extension;
- embedding production credentials in a static site;
- creating a second Save/Activate implementation for Fiori;
- auto-committing or auto-pushing source;
- enabling unsupported debugger/ATC/CTS actions as decorative buttons;
- making code-server mandatory for running OSD.

## Recommended next move

Take **GW0/GW1: Gateway regression contract and kernel** next, followed by its
thin Fiori client. This builds the instrument that will verify the editor and
closes the missing `activate -> call -> compare -> keep result` loop. Draft is
not a prerequisite: explicit Save, ETags and immutable case/run versions are
the first contract.

The first demo is successful when a user opens the Launchpad, selects one saved
case, runs it against OSG or A4H, sees a useful semantic diff, and can reproduce
the same verdict headlessly. The next Workbench demo then adds source editing
and `Activate -> Run selected suite` on top of that proven instrument.
