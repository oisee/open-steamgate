# Developer experience roadmap

Status: product roadmap, started on `feat/live-workbench-activation` on
2026-09-21. This document joins the ideas discussed around “what should we
build next?” into one ordered plan.

The target experience is **SE80-like in outcome, not in implementation or
appearance**: a developer can find an object, understand it, edit it, check
it, activate it, execute focused code or tests, inspect the result and recover
an earlier version without leaving the workbench. OSD may use its own UI,
highlighting and protocol machinery.

## Current status

| Track | State | Result |
|---|---|---|
| D0 activation truth | implemented on feature branch | failed publication and a concurrent save remain inactive; previous live generation survives |
| D1a Fiori Workbench | first vertical implemented on feature branch | full-width Launchpad editor; Class, Interface, Program and CDS search; Discard; Check/Problems; guarded inactive Save/Activate; generation identity |
| D1 browser VS Code + abap-fs | parked conformance surface | authenticated code-server sidecar, real abap-fs client, shared dedicated worktree |
| D2 host-Git history | hosted vertical implemented | branch/HEAD, per-object status/diff, 20 file versions and restore-to-buffer; active-generation diff remains |
| D3 test and execution loop | partial backend exists | ABAP Unit already has ADT routes; needs isolated data and a useful UI/report |
| D4 SEGW client | planned | browse model, inspect metadata, issue OData requests, then controlled model edits |
| D5 ADT/abap-fs coverage | continuous | desktop and browser abap-fs are acceptance clients for the same ADT/store contract |
| D6 DIAG/RFC consolidation | parked research | consider moving protocols from the sidecar only after the edit/test loop is pleasant |

## D0 — one source state machine

Every surface uses the same object store:

```text
working text -> Save -> inactive revision -> Check -> Build -> Publish -> active generation
```

Save is not Activate, Activate is not Git Commit, and Git Commit is not Push.
A failed check/build/recycle never clears the inactive revision or replaces
the previous working runtime. A save arriving during activation belongs to a
new revision and needs its own check. Multi-object activation completes all
named revisions or none.

This is the foundation for the small OSD editor, ADT/Eclipse, desktop abap-fs,
browser abap-fs and future SEGW tooling. The implementation and regression
tests are commit `6291936` on the feature branch.

## D1 — rich browser workbench

Provide code-server in an opt-in container with a pinned, preinstalled
`vscode_abap_remote_fs`. It talks to OSD over the private Compose network and
opens the same dedicated Git worktree. It starts in a separate tab; iframe
integration is a later, separately tested concern.

The first acceptance path is deliberately small and real:

1. browse a package and open a class;
2. save an invalid edit and see the exact diagnostic;
3. prove failed activation leaves the previous runtime live;
4. fix and activate it;
5. run one ABAP Unit method;
6. see the same edit in VS Code Source Control.

The reproducible container/security plan is in
[`vscode-workbench-spike.md`](vscode-workbench-spike.md).

### D1b — desktop VS Code runs local OSD

Build a separate extension for ordinary desktop VS Code. Its Node extension
host acts as a thin supervisor for a pinned OSD runtime/CLI in the currently
opened checkout. Commands start, stop and report OSD, open its launchpad, and
hand the local endpoint to abap-fs. The default bind is loopback on an
allocated instance/port; Workspace Trust is required before any process starts.

Do not bundle a moving source checkout, run npm installs, or compile OSD at
extension activation. Choose one explicit delivery contract after measuring
VSIX size and native dependencies: download a signed platform archive by exact
version/checksum, or invoke an already installed `osd` CLI. Persist databases
outside the extension directory, terminate child processes reliably, redact
secrets from logs, show source/runtime version mismatch, and never commit or
push. Test Windows x64, macOS arm64, Linux x64 and Raspberry Pi arm64; an
unsupported platform gets a clear diagnostic rather than a partial startup.

## D2 — host Git as source history

The host checkout is the history layer; do not invent transports or a second
revision database for local OSD development.

Expose three identities separately:

- Git branch and `HEAD`: what was deliberately recorded;
- inactive source revision: what the developer most recently saved;
- active generation hash: what the runtime is actually executing.

The workbench should offer diff against active and `HEAD`, file/object log,
author/time, and restore. Restore writes a new inactive edit and follows the
normal Check/Activate path. Never auto-commit or auto-push on Save/Activate.
Handle dirty trees, detached HEAD and images without `.git` explicitly.

The first hosted vertical now resolves the selected Object Store object to its
actual repository file on the server and shows a collapsible bottom panel with
branch, exact `HEAD`, clean/modified/untracked/ignored status and a unified
diff of the stored inactive source against `HEAD`. Detached and unborn heads,
untracked objects and runtimes without Git are explicit states. The adapter is
read-only; HTTP parameters are never used directly as Git pathspecs. Unsaved
browser-buffer edits are intentionally not presented as stored-source diffs.

The same panel lists the last 20 versions of the file with commit, author,
time and subject. Restore reads only a full SHA that belongs to that file's
history and replaces the browser buffer after confirmation; it does not write
until the developer follows the normal Save inactive, Check and Activate path.

VS Code's ordinary Git UI remains the rich implementation. The compact hosted
view is backed by the host Git adapter. `tools/osd-git.mjs` clones remote
repositories through ABAP; it is not this local-history adapter.

## D3 — test and execution loop

Make focused execution feel immediate:

- run an ABAP Unit class or method from the object;
- show running/pass/fail/skip, elapsed time and failure lines beside source;
- keep test writes out of the working database;
- retain a bounded, readable report for the current developer session;
- allow cancellation/timeouts and only allowlisted suites.

The initial surface is ABAP Unit through ADT because the backend already
exists. A later operator page may manually launch supported repository suites,
but it must not expose arbitrary shell commands or run automatically at normal
startup. Full Node/integration/Playwright tests normally remain outside the
ABAP runtime in CI or an isolated runner.

“Execute code” begins with ABAP Unit and explicitly allowlisted reports or a
bounded REPL contract. It does not begin with a browser button that can execute
arbitrary host commands.

## D4 — SEGW client in the same workbench

Start read/test-first:

1. browse projects, entity types/sets, associations and generated artifacts;
2. inspect service metadata and annotations next to the model;
3. compose an OData request, execute it and inspect response, timing and SQL
   trace without leaving the workbench;
4. show whether generated files are inputs to the next build;
5. only then add controlled model edits and explicit promotion through the
   same inactive/check/activate state machine.

This avoids a second SEGW write path. F4/value-help and CDS associations are
useful demonstrations and tests of the generated service, not a substitute for
model activation semantics.

## D5 — ADT and abap-fs as a contract

The built-in UI and VS Code may look entirely different. What must agree is
object identity, locks, source versions, diagnostics, activation, tests and
runtime generation.

Use current desktop and browser abap-fs as uncompromising real clients. Record
their traffic with `STG_ADT_DUMP`, inspect `/osd/not-served`, and add a
regression for each blocker actually encountered. Do not advertise unsupported
ATC/debugger/CTS/DDIC editor families merely because the extension has buttons
for them. Eclipse ADT and vsp remain additional conformance clients.

Likely short-term gaps are object-name validation/create routes, interface
outline merge, `localtypes`, several non-class editor documents and persistent
test-database isolation.

## D6 — DIAG/RFC without the sidecar

This is valuable only after D0–D5 produce a comfortable daily loop. Research
whether DIAG/RFC should live in the primary implementation language/runtime
and whether “JA” means JavaScript or Java before selecting a target.

The decision must preserve wire compatibility, instance-derived 32NN/33NN
ports, ADT-over-RFC session affinity and the ability to run without proprietary
SAP SDKs. Porting for packaging neatness alone is not enough: it must reduce
operational complexity or unlock a real developer workflow. Until proven, the
open-rfc-go/open-diag-go sidecar remains the known boundary.

## Order of delivery

The three-surface decision and its Gateway addendum in
[`devux-three-surfaces.md`](devux-three-surfaces.md) update the product order:
code-server remains a conformance surface. First build the regression
instrument; after its thin Fiori client, braid the hosted editor with the
activate-and-run integration.

1. Keep D0 and the real-client D1 acceptance green.
2. Complete GW0/GW1: the clean-room case contract, matchers, isolated
   executors and headless positive/negative controls.
3. Complete GW2: a thin Fiori Gateway Client over the same runnable cases.
4. Braid UX1 with GW3: edit through the live Object Store, activate, then run
   the selected suite and retain the exact source/live/serving identities.
5. Add D2 history and make the D3 ABAP Unit loop excellent in hosted mode.
6. Add a Pages replay/read-only adapter; browser activation remains a separate
   measured feasibility track, not a prerequisite.
7. Build the desktop OSD supervisor extension on the stable runtime API and
   grow D5 from captured client failures.
8. Re-evaluate D6 with measurements after the workbench is in daily use.

Each step stays in a feature branch, has a small real-client acceptance, and
enters `main` only through PR checks. The compact in-system editor remains a
recovery surface when a richer frontend or extension fails.

## Related plans

- [`devux-three-surfaces.md`](devux-three-surfaces.md) — the target split among
  Fiori Workbench, desktop VS Code, Pages and optional code-server.
- [`branch-plan-live-workbench.md`](branch-plan-live-workbench.md) — the active
  branch boundary and activation/Git-history slice.
- [`vscode-workbench-spike.md`](vscode-workbench-spike.md) — container,
  security and E2E plan for browser VS Code.
- [`adt-facade-shift-right.md`](adt-facade-shift-right.md) — lifecycle and ADT
  architecture gaps identified before this branch.
- [`architecture-split-astra.md`](architecture-split-astra.md) — larger
  workbench/runtime ownership analysis; not all of it is committed to this
  delivery sequence.
