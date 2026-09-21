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
   the default in-system experience and the only rich editor that must also
   work as a safe static GitHub Pages demonstration.
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
Save -> inactive revision -> Check -> Build -> Publish -> active generation
             |                                      |
             +-------------- failure ---------------+
                         previous generation stays live
```

Git Commit and Push remain separate, explicit actions. A surface may show Git,
but it must not invent another source database or silently publish a saved edit.

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

**Recommendation: start with CodeMirror 6.** It is modular, relatively small,
works well as an embedded editor and allows OSD to ship only the language and
features it supports. Monaco is a valid fallback if protocol-aware editor
features require more of VS Code's model, but it is larger and makes the small
in-system surface resemble a second VS Code distribution.

The ABAP and CDS highlighters are presentation helpers, not parsers of record.
Diagnostics come from the same Check/Activate backend used by ADT. A coloured
line is never evidence that code activates.

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

This gives both clients the same ETags, locks, inactive source, diagnostics and
atomic publication rules. A save in one surface is immediately visible in the
other.

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
Workspace Trust, binds loopback by default, never mounts the Docker socket,
redacts secrets and stops only the child it owns. Windows x64, Linux x64,
macOS arm64 and Linux arm64 need native lifecycle and persistence tests.

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
- edits live in IndexedDB/OPFS under the Pages origin;
- a browser database holds demo data;
- Reset restores the shipped snapshot;
- Export Patch downloads the user's changes without requiring GitHub access;
- Playwright can exercise the exact public artifact before Pages promotion.

No production credential belongs in that static bundle.

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
| Pages demo | packaged snapshot + IndexedDB/OPFS edits | browser Worker | shipped commit plus downloadable patch |
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

All surfaces should depend on a small, explicit capability contract:

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

## Persistence and recovery

| State | Pages demo | Hosted OSD | Desktop VS Code |
|---|---|---|---|
| shipped source | static assets | checkout/image | local checkout |
| inactive edits | IndexedDB/OPFS | Object Store | Object Store + checkout |
| active runtime | Worker generation | server generation | local generation |
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

### UX1 — Fiori editor vertical slice, after GW2

- create the Launchpad tile and UI5 application;
- wrap a pinned CodeMirror 6 build;
- browse one package and open one class;
- Save inactive, Check, Activate and show Problems;
- display all three version identities;
- keep the old editor as fallback.

Acceptance: invalid code stays inactive and the old runtime remains live;
valid code changes the runtime; refresh preserves the inactive edit.

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
| invalid activation preserves runtime | required | required | required | conformance |
| valid activation changes runtime | required | required | required | conformance |
| ABAP Unit report | required | required subset | required | conformance |
| Git working-tree visibility | server facts | exported patch | native | native |
| offline startup | optional | required after load/install | required for pinned runtime | deployment-specific |
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
