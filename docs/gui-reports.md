# Classic reports (and a little ALV) through open-abap-gui

A timeboxed spike, not a track: prove the path end to end on two or three
examples, and write down what does not work. Backlog track G's webgui
(`docs/webgui.md`) already runs one hand-written transaction
(`ZOSD_NOTE`); this asks whether a *converted* classic report can run the
same way, using Lars's PROG-to-CLAS converter
([`open-abap/open-abap-gui`](https://github.com/open-abap/open-abap-gui),
converter/) rather than anything hand-written.

## The bridge, in one paragraph

`tools/osd-gui-convert.mjs` runs every `*.prog.abap` the content folders
declare through the converter's `convertProgram` (`mode: "strict"`, falling
back to `"partial"` + `partialStrategy: "skeleton"` when strict has no
supported output; the generator says which it used). A supported report
becomes a class implementing `zif_gg_report_v1` -- unmodified converter
output, written to `gen/gui/`. That class is not, by itself, something
`ZCL_OSD_TRAN_REGISTRY` can enter: a transaction here is a class
implementing `ZIF_OSD_TRANSACTION` (`docs/webgui.md`, backlog G.3), and the
registry's `CREATE OBJECT ri_tran TYPE <className>` names one class with no
constructor argument, so one wrapper class per report is the smallest
change that fits the existing contract rather than a second dispatch
mechanism beside it. The generator writes that wrapper too
(`ZCL_OSD_GUITX_<base>`) and a `*.tran.xml` naming it under `ZGUI_<base>`,
so `ZCL_OSD_TRAN_REGISTRY` picks it up exactly the way it picks up
`ZOSD_NOTE` -- nothing about the registry, `ZCL_OSD_TRAN` or the screen
changed for this.

The wrapper drives Lars's own `zcl_gg_host_runtime` (`framework/`, wired in
2026-09-26; see "The framework filter" below), which already keeps a
session's state in its own `CLASS-DATA`, keyed by a session id it hands
back in every response. So `ZIF_OSD_TRANSACTION`'s own state string --
the one thing this system's design says must survive `/ui2/cl_json`
serialisation between two requests -- only has to carry that id, not the
report's model:

- **`roll_in('')`** (a fresh transaction): `zcl_gg_host_runtime=>start(
  io_report = NEW <converted class>( ) )`, keep the response and its
  `session_id`.
- **`roll_in(iv_state)`** (resuming one): keep `iv_state` as the session id;
  nothing else is reconstructed, because the actual report state already
  sits in `zcl_gg_host_runtime`'s class-data under that id, in the same
  process.
- **`pbo`**: render whatever response this instance is currently holding.
  On the first PBO of a resumed step (before the click is dispatched) there
  is none yet -- an empty placeholder document is enough, because
  `ZCL_OSD_TRAN=>draw` calls PBO once to register the viewer's sapevent
  handler and once more after PAI to render what the handler produced, and
  only the second render reaches the browser.
- **`on_sapevent`**: turn the posted fields into
  `zif_gg_host_html_v1=>ty_request`, call `zcl_gg_host_runtime=>dispatch`,
  keep the response for the second PBO.
- **`roll_out`**: the response's own `session_id`, or the one `roll_in`
  was given.

The one rewrite the wrapper does to the page itself: Lars's renderer
already writes a plain HTML `<form method="post" action="/dispatch">` with
every field the dispatcher reads as an ordinary field (`session_id`,
`page_id`, `gg_ucomm`/`gg_action`) -- his own frontend (`web/web.mjs`) is a
plain HTTP client, no different from a browser with JavaScript off, which
is exactly the shape `cl_gui_control`'s existing sapevent rewrite
(`docs/webgui.md`, G.2) wants. `document()` does one
`REPLACE ALL OCCURRENCES OF `action="/dispatch"`` before handing the page
to the viewer, and the round trip G.2 already proved carries the rest: the
rewritten form posts to `/sap/bc/gui/sap/its/webgui/tx/?okcode=dispatch`
with the session id folded in, `dispatch_sapevent` raises `sapevent` on the
wrapper's viewer, and `on_sapevent`'s `query_table` is the same posted
fields, read directly rather than through a second parser.

## `request_of`: a deliberately small subset

`framework/http/zcl_gg_http_handler.clas.abap`'s `request_from_payload` is
Lars's own answer to the same question -- turning posted fields into a
`ty_request` -- for his HTTP transport. The wrapper's `request_of` is not a
second copy of it: it covers only what the three examples below need
(`docs/gui-reports.md`, this file, is the record of the rest):

| posted field | maps to | covers |
| --- | --- | --- |
| `gg_ucomm` (a selection screen's Execute/other function keys) | `action = action_submit`, `ucomm = <value>` | Execute (`ONLI`) |
| `gg_action = EXIT` | `action = action_exit` | Cancel |
| `gg_action = LINE:<row>\|<token>` | `action = action_line`, `row`, `token` | a list line click |
| `gg_action = COMMAND:<ucomm>` | `action = action_command`, `ucomm` | a plain toolbar button |
| `gg_action = SCREEN:<n>` | `action = action_screen`, `target` | (untested; wired for completeness) |
| anything else | `action = action_command`, `ucomm = <the kind>` | a deliberate best-effort fallback, refused by the host rather than misfiring |
| every other field | one row of `values` | selection-screen parameters (`P_DATE`, ...) |

Not covered, and known not to be: `TAB:name\|ucomm`, a dynpro grid cell's
own naming, F4 (`action_value_help`), free selections
(`gg-free-*`/`gg_free_action`), and the checkbox "unchecked" companion
field (`gg-unchecked-<name>`) the renderer emits beside every checkbox. A
report using any of those needs `request_of` extended, not a different
design -- the shape is already `ty_request`.

## The framework filter

`zcl_gg_host_runtime` lives in `framework/`, which `abap_transpile.json`
and `abaplint.jsonc` only let in three named files of before this (the
`cl_ctmenu`/`cl_gui_toolbar`/tree-and-grid closure `docs/webgui.md`
already named). `node tools/osd-closure.mjs
.local/lars/open-abap-gui/framework zcl_gg_host_runtime` says the real
closure is 45 of the folder's 50 objects -- essentially all of it except
`zcl_gg_workbench` and `zcl_gg_selector` (Lars's own IDE-side program
lister, not needed to run one). Both configs now take `framework/**` minus
`framework/http/` (Lars's own HTTP adapter, `if_http_server`-bound, not
this bridge's transport) and `framework/assets/` (not ABAP), the same
"minimal, and say what was added" `docs/webgui.md` used the first time:
+301 objects there, and this build measured 1773 → 1782 objects for these
nine (`node tools/osd-gui-convert.mjs` itself writes the other new ones:
three converted reports, three wrappers). `abaplint.jsonc`'s own dependency
list is separate from `abap_transpile.json`'s and needed the same change,
plus a `/gen/gui` entry it had no reason to have before (the same reason
`/gen/stg` has one instead of being folded into `"global"`).

## One-shot batch runner

The same generator also writes `ZCL_OSD_BATCH_REPORT` as a static registry of
the reports it converted. `RUN( iv_program = ..., it_input = ... )` creates a
fresh converted report and calls `ZCL_GG_HOST=>RUN` with `iv_batch = abap_true`.
The result has separate list `lines`, `messages`, `terminal`, `status`, and
`detail` and `navigation` fields. Status is `COMPLETED`, `SELECTION` if the
selection screen remains active, `INCOMPLETE` if the host returned a terminal
or navigation request that this one-shot call cannot resume (`LEAVE PROGRAM`
is a normal completion), `UNSUPPORTED` for
a known report that could not be converted or for a host operation it cannot
perform, `INVALID_INPUT` for an undeclared or repeated selection field, and
`UNKNOWN` for a name outside the registry. The caller receives no rendered
HTML and no persistent report session. A supplied value is a row of
`ZIF_GG_SELECTION_SCREEN_TYPES=>TY_VALUES` such as `P_DATE = 20251231`.
Input names are checked against the converter's selection-screen metadata
before the report runs; an unrecognized name cannot silently disappear.

This is a supported converted report runner, not a generic ABAP `SUBMIT`.
The registry is rebuilt from the winning content layers, and only generated
static calls can execute. It has no scheduler, variants, spool, job log,
cross-process continuation, or support for a report the converter skips.
Two different files declaring the same `REPORT` name fail the generator before
it replaces the previous output, since they would create duplicate dispatch
arms and generated class names.
`test/unit/zcl_osd_batch_runner_test.clas.testclasses.abap` executes the
converted `ZGG_EX_012` twice: first with a supplied date, then with its own
`INITIALIZATION` default, proving one call does not leak selection state into
the next. It also checks invalid input, unfinished host flow, and unknown and
known-but-unsupported names.

## Narrow synchronous SUBMIT

`tools/osd-narrow-submit.mjs` lowers only `SUBMIT <static PROG> [WITH
<field> = <scalar> ...] AND RETURN` in OSD's own ABAP sources before the
upstream transpiler sees it. Each named scalar becomes a selection value for
`ZCL_OSD_BATCH_REPORT=>SUBMIT`; a fresh report object is created. The target
must be in the converter's registry and complete normally. A missing,
unsupported, or incomplete target raises `ZCX_OSD_SUBMIT` with its status and
detail. Dynamic program names, ranges, variants, `VIA JOB`, spool options,
`EXPORTING LIST TO MEMORY`, and `SUBMIT` without `AND RETURN` fail at build
time with the source file and line. Dependencies are not rewritten.

The synchronous call passes the caller's `sy-batch` to the report host. The
converted report reads it from its per-run context, as it does `sy-repid`;
`ZOSD_SUB_CTX` and ABAP Unit exercise both dialog and batch contexts. This
does not globally change `sy-batch` in the runtime or create a background
process. The one-shot report's typed result is available through `RUN`, but
this first `SUBMIT` slice does not yet forward its list to a dialog screen,
memory list, or spool. The lowering preserves source line counts so later
statements keep their source-map rows; it refuses comments within the
statement rather than removing them.

## Saved one-shot runs

`node tools/osd-batch-runs.mjs run ZGG_EX_012 P_DATE=20251231` runs a
converter-supported report once with `sy-batch` set for that report and saves
its result. `list` shows recent run IDs; `show <run-id>` opens a run and its
list output after a process restart. The command invokes the same generated
`ZCL_OSD_BATCH_REPORT=>RUN` registry as the synchronous `SUBMIT` bridge. It
does not require a WebGUI session or create a scheduled job.
The command starts its own runtime process; pass the same `STG_DB` and
connection settings as the instance whose business rows it should use.

Run metadata lives in a separate SQLite file, `.local/osd-operations.sqlite`
in a checkout; `OSD_OPERATIONS_DB` overrides it. When `STG_DB_PATH` is set,
the operations file sits beside the business database. The Docker image sets
`OSD_OPERATIONS_DB=/data/osd-operations.sqlite`; the HANA and PostgreSQL
Compose stacks now mount a named `/data` volume too. The VS Code launcher uses
its per-instance storage directory, including when the business database is
HANA or PostgreSQL. Output is an immutable JSON artifact under
`batch-output/<run-id>.json`, bounded to 5 MiB and checked
against its SHA-256 digest on read. A run row is written before execution and
closed with `COMPLETED` or `FAILED`. An exception records result status `DUMP`;
a process that dies during a run leaves `RUNNING` for a later doctor to
classify. The operations database is independent of a replaceable build
generation and the business database.

Selection values are kept in the local operations file for eventual job
execution; normal `list` and `show` output reveals names only. The file and
artifacts are created with owner-only permissions. Anyone with direct access
to the instance's operations files can read them, so they need the same
protection as the instance's business data. These slices have no public
HTTP monitor, retry or spool semantics. A future operations API needs
an explicit authorization boundary before exposing saved parameters or output.

## One BGR worker

`node tools/osd-batch-runs.mjs enqueue ZGG_EX_012 P_DATE=20260202` writes a
durable `QUEUED` run without executing it. `work` claims and executes one
queued run in its own process; `worker` stays up, polling for further work
until SIGINT or SIGTERM. `list` and `show <run-id>` show the same saved status
and output as a direct run. This is an explicit process to start for now; it
is not yet supervised by the OSD launcher. Its direct `enqueue` command is
separate from the transactional ABAP job facade below.

## Immediate JOB_OPEN / JOB_SUBMIT / JOB_CLOSE report steps

For a durable `STG_DB=file` instance, the common `JOB_OPEN` / `JOB_SUBMIT` /
`JOB_CLOSE` call shape schedules up to 16 ordered converted static reports in
one LUW. `JOB_SUBMIT` accepts no variant or ad hoc selection; each report runs with its own
`INITIALIZATION` defaults. `JOB_CLOSE` requires `STRTIMMED = 'X'` and rejects
date, time and target-system scheduling. External programs are refused.
`JOBCOUNT` is an eight-digit handle for the current
dialog step; the durable run identity is a separate UUID. Exact SAP signatures,
exception mapping and cross-dialog-step lifetime still require A4H measurement.
The [SAP background programming guide](https://help.sap.com/docs/SAP_NETWEAVER_702/ff5bceb06c551014a400edb223056da3/4d94511b2cdb6c14e10000000a15822b.html)
documents `JOB_SUBMIT` with a report variant; this subset deliberately refuses
variants until their lookup and execution are implemented.

An open definition belongs to the current dialog step and disappears on
`COMMIT WORK`, `ROLLBACK WORK`, `WAIT` (which commits), dump or step exit.
`JOB_CLOSE` inserts a parent dispatch intent and keyed ordered children with
Open SQL into `ZOSD_JOB_OUTBOX` and `ZOSD_JOB_STEP`, without committing its caller.
`node tools/osd-batch-runs.mjs drain` reads a committed parent and children
from one snapshot and imports them into the operations SQLite store. `work`
and `worker` drain before claiming work. An import ledger keeps the outbox ID
and a versioned digest of all ordered steps: a crash after import but before
business-DB acknowledgement retries the same run, and changed payload is
refused. Parent and children are acknowledged in one business LUW. Legacy
one-step intents retain their original digests. The one-step file SQLite
outbox schema upgrades additively, preserving committed rows.
The worker claims only rows for its business DB, client and SID. A mismatched
build generation fails visibly before each report executes. One `work` call
executes at most one step. A successful step atomically records its result,
readies the next step and queues the parent again; the last step completes the
parent. A failed step skips later steps. A crash before recording a step leaves
the active step and parent `RUNNING` for manual review. Each step has its own
immutable output artifact; the parent's output contains the last executed
step. The file SQLite adapter writes a
committed LUW to its WAL on disk; its `synchronous=NORMAL` setting gives
process-crash recovery, not a power-loss guarantee. The in-memory/sql.js,
DuckDB, HANA, PostgreSQL and browser modes reject this first scheduling slice
until their persistence and transaction boundaries are proven.

A SQLite `BEGIN IMMEDIATE` claim admits at most one queued run at a time,
even if two worker processes start together. FIFO uses enqueue time and row
order. A queued run records the generation it was submitted against; if
the worker sees a different generation, it records `GENERATION_CHANGED`
without executing potentially changed code. A worker that dies mid-report
leaves the run `RUNNING` and blocks later queue claims. After confirming the
old worker process has stopped and inspecting possible business effects,
`interrupt <run-id> --worker-confirmed-stopped` marks that run `INTERRUPTED`
and lets the next queued run proceed. It never replays the interrupted run;
submit a new one explicitly if appropriate. A richer doctor and supervised
worker lifecycle are later steps. Direct synchronous `run` remains outside
this BGR admission limit.

Selection support is a later compatibility slice with three distinct cases:
persisted report variants, RSPARAMS or range selections, and typed
`PARAMETERS ... NO-DISPLAY` values (which can include tables). These steps
store default selections only. Standard ABAP job read, state and log functions
and an external scheduler API remain separate work.

`tools/osd-job-snapshot.mjs` is a private read model for that future ABAP
facade. Given a trusted caller's client, user and SID plus `JOBNAME` and
`JOBCOUNT`, it reads the retained business identity, committed outbox and
imported operations rows with read-only SQLite connections. It prefers the
verified operations row during import-before-ack and reports a missing or
inconsistent durable record instead of guessing a state. A reserved `OPEN`
has no steps; a committed outbox has ordered `READY`/`PENDING` steps; imported
runs expose their saved per-step states. Reads never drain, commit the caller's
LUW, or open list artifacts. They expose neither a SAP job log nor BAL entries.
Creation date/time currently comes from the outbox only and is unavailable
after acknowledgement. Standard `BP_JOB_READ`, `SHOW_JOBSTATE` and
`BP_JOBLOG_READ` still require measured A4H signatures and behavior.

The operations SQLite store keeps a small technical job log for imported
jobs. Import, claim, step completion/failure and job completion/failure or
manual interruption append ordered rows in the same transaction as their
state changes; a repeated outbox import adds no second entry. The private
`readJobLog` reader checks the retained identity and owner, then validates the
operations run, steps and import digest with the log rows in one read-only
operations snapshot.
It does not drain work or end the ABAP caller's LUW. A read can observe a later
transition than an earlier separate status read. Older imported runs without
log rows report a historical gap rather than invented entries. The read is
bounded at 2000 rows and fails explicitly beyond that size. This log contains
only controlled technical events: captured `WRITE` list output, BAL entries,
selection values and report messages remain separate. The standard ABAP log
function and its line format still require A4H measurement.

## Local read API for saved runs

`GET /osd/batch-runs` lists up to 50 recent runs (`?limit=1..200`).
`?id=<run-id>` reads one record; `?id=<run-id>&output=1` reads its saved
output after the SHA-256 check. Stored selection input values are omitted
from run metadata; the report's detail and output may still contain business
data or parameter values. Responses are not cached.

The route is **disabled by default**. An instance owner may set a random
`OSD_BATCH_READ_TOKEN` of at least 32 letters, digits, `_` or `-` before
starting OSD. A caller sends `Authorization: Bearer <token>`. A missing token
configuration returns 404; a missing or wrong bearer returns 401. This is a
loopback-only, read-only operator door for trusted clients, not yet a Fiori
browser login or a SAP jobs API. Keep the token out of URLs and logs. Enqueue,
cancel, retry and job-definition operations are not available through it. A browser-facing
monitor needs an explicit user/session authorization model first.

## The three examples

`packs/gui-examples` fetches exactly three files out of
`oisee/open-abap-gui`'s `examples/` at the commit recorded for
`open-abap-gui` in [`libs.lock.json`](../libs.lock.json). The pack manifest
uses that lock entry directly, so the fetched examples and transpiled library
cannot drift apart. All three convert in **strict**
mode, zero diagnostics.

| report | what it is | proves |
| --- | --- | --- |
| `ZGG_EX_001` | `WRITE 'hello world'.`, no selection screen | it renders at all |
| `ZGG_EX_012` | one `PARAMETERS p_date TYPE d`, an `INITIALIZATION` default, `WRITE p_date` | a selection screen renders, Execute posts back and the report's own read of what came back appears in the list; Cancel returns to a fresh selection screen rather than running anything |
| `ZGG_EX_043` | `DO 3 TIMES` with `HIDE`, `AT LINE-SELECTION` | an interactive list renders, and clicking a line posts back and the handler's own `WRITE` is appended below the three lines that were clicked among |

Run locally (`STG_PORT=3578`, since the family this file's worktree used
is 3571-3579):

```
http://localhost:3578/sap/bc/gui/sap/its/webgui/?okcode=ZGUI_GG_EX_001
http://localhost:3578/sap/bc/gui/sap/its/webgui/?okcode=ZGUI_GG_EX_012
http://localhost:3578/sap/bc/gui/sap/its/webgui/?okcode=ZGUI_GG_EX_043
```

A module pool (a dynpro program) converts to `zif_gg_dynpro_v1`, not
`zif_gg_report_v1`; the generator writes its class the same way but skips
the wrapper and the `*.tran.xml`, and says why (`programKind is
module-pool`). Driving a dynpro through `zcl_gg_host_runtime`'s
`io_dynpro_program` is the obvious next step and was not attempted here --
timeboxed out, not found difficult.

## VS Code: F8, and a lens

`editors/vscode/lib.js` `RUN_TABLE.PROG` used to answer "not yet: run a
report -- no server route to run one headlessly yet" unconditionally. It
now computes the same transaction code the generator wires
(`progTcodeOf`, `ZGUI_<base>`; `namesOf` in the generator and this
function are two small pure functions kept in step by
`test/vscode-extension.mjs` rather than shared code, since one belongs to
a build tool and the other ships inside the extension) and answers
`{kind: "webgui", tcode}`. It does **not** ask osd whether that
transaction actually exists first: F8 opens the webview either way, and a
report nobody converted gets the same "Transaction ZGUI_X does not exist"
the real Easy Access screen would print, in the panel instead of a dialog
-- one fact, wherever it is read, rather than a second way of finding it
out. `progRunLens` places a CodeLens, "▶ Run in Easy Access (ZGUI_...)",
on a `*.prog.abap`'s own `REPORT` line -- "Open in VS Code" for a
converted report, symmetric to F8 rather than a second command with its
own idea of what to do.

The extension resolves the configured listener with `vscode.env.asExternalUri`
and then appends `/sap/bc/gui/sap/its/webgui/?okcode=<tcode>` to that base.
This leaves the webgui resource and its direct-start command together in the
iframe URL; `test/gui-reports.mjs` confirms the same `okcode` entry path by
requesting it directly. F8 and the CodeLens share one panel per transaction
code, reserved before the external URI lookup so concurrent runs cannot open
two tabs. A later run reveals that panel and changes a run marker in its HTML
to reload the iframe and start the report again. VS Code ignores assignments
of identical HTML.

The panel itself iframes the running osd's URL rather than carrying a copy
of the page, so the sapevent round trip runs exactly as it does in a
browser tab. Two things a webview needs that "Open launchpad"'s
`vscode.env.openExternal` does not:

- **A Content-Security-Policy.** A webview's default is no origin at all;
  the panel's page sets one `<meta http-equiv="Content-Security-Policy">`
  naming only the osd origin as `frame-src`, nothing else runs a script.
- **`vscode.env.asExternalUri`.** A webview panel renders in the *local* UI
  process, on the other side of the remote/local boundary from a remote
  osd under Remote-WSL or Remote-SSH, so a bare `http://localhost:<port>`
  is a coincidence when it resolves (Remote-WSL's own automatic port
  forwarding) and a dead port otherwise (Remote-SSH forwards nothing
  unless asked). `asExternalUri` is VS Code's own answer: it hands back
  the base URL this window's UI can actually reach, forwarding the port
  first if that remote needs it, and is a no-op when nothing is remote.
  The extension adds the webgui path and `okcode` after resolving this base.
  This was not measured against a real Remote-SSH window in this spike (no
  such window was open); it follows the API's own contract, which is exactly
  what it is documented to solve.

## Tests

```
STG_PORT=3578 npx mocha test/gui-reports.mjs test/vscode-extension.mjs
```

`test/gui-reports.mjs` is two kinds of test kept apart the way
`test/transaction.mjs` keeps its three apart: a generator test (the three
examples convert in strict mode, wire a transaction, and both the
converted class and its wrapper parse under abaplint with no `structure`
issues -- a fast parse-only proxy for "transpiles"; `npm run transpile`
and CI are the real gate for that and were run by hand for this spike) and
an HTTP test, the browser played by hand the way `test/transaction.mjs`
plays `ZOSD_NOTE`: `ZGUI_GG_EX_001` renders "hello world", `ZGUI_GG_EX_012`
Executes and Cancels, `ZGUI_GG_EX_043` clicks a line. `test/vscode-extension.mjs`
checks the extension's pure transaction URL builder as well. Both files are in
`test/suites.json`.

## Licence

The converter's own `converter/package.json` has `"license": ""`, the same
shape `open-abap-odata`'s does (`CLAUDE.md`, "known traps"; parked as MIT
for planning per the 2026-09-25 decision). Not blocked on for this spike;
revisit at the same time the `open-abap-odata` question is revisited.

## What does not work yet, and why

- **A dynpro (module pool) program.** The converter emits `zif_gg_dynpro_v1`
  for one; the wrapper only drives `zif_gg_report_v1` through
  `zcl_gg_host_runtime=>start(io_report = ...)`. Its `io_dynpro_program`
  parameter exists and is presumably the right seam -- not attempted
  here, timeboxed out.
- **Classic ALV** (`CL_SALV_TABLE`, `REUSE_ALV_GRID_DISPLAY`). None of the
  three chosen examples uses it, and no example under `examples/` calls
  those APIs directly (the ALV-shaped demos in that repo,
  `zcl_gg_control_showcase_base` and friends, are hand-written against the
  framework's own interfaces, not classic reports the converter would ever
  see). Whether the converter's `src/function-modules.mjs` adapter for
  `REUSE_ALV_GRID_DISPLAY` (README: "classic ALV" is one of the named
  families) produces something this bridge can run is genuinely unknown --
  not tried, for lack of a report to try it on within the timebox.
- **`request_of`'s coverage**, named above: tabs, a dynpro grid cell, F4,
  free selections, a checkbox's unchecked-companion field. Each is a case
  `request_of` does not parse yet, not a design gap.
- **No cross-process affinity for a running report.** `zcl_gg_host_runtime`
  keeps a session in its own `CLASS-DATA`; `ZOSD_TSES` (the row this
  system's own transactions use, `docs/webgui.md`) is not involved at all
  for a converted report. A recycle of the work process between two
  requests of the *same* report session loses it -- the row-based session
  design `docs/webgui.md` chose specifically to avoid this for
  `ZOSD_NOTE` does not cover this bridge, because the state that would
  need to move is Lars's own and not serialisable the way a notepad's
  three fields are. Fine for a single dev server across the length of one
  demo; not fine for the browser preview (a service worker recycling would
  behave the same as a work-process recycle: the id remains valid,
  Lars's row does not) or for `OSD_WARM`'s process-swap warm compiles.
  Out of scope for this spike; a real fix is D.1-shaped (a row, keyed by
  the host's own session id, holding whatever of `zcl_gg_host_runtime`'s
  state turns out to be worth serialising) and was not designed here.
- **`asExternalUri` under a real Remote-SSH window** was reasoned from the
  API's contract, not measured against one -- noted above.
- **The generator's own build-cache tracking.** `tools/osd-build.mjs`'s
  `generatorClosure` walks static `from "./x.mjs"` and `import("./x.mjs")`
  patterns to know which tool edits should invalidate a build's cached
  generation; `osd-gui-convert.mjs`'s `import(resolve(root, LIB,
  CONVERTER))` is a computed path into `.local/lars/open-abap-gui`, which
  that walk does not and should not try to follow. Editing the converter
  itself will not automatically bust a cached generation -- acceptable for
  a pinned-commit dependency, worth a line if the pin ever needs a manual
  bust.
