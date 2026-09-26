# A thin VS Code extension over a running osd (Q2)

*2026-09-25.* `editors/vscode/` is a VS Code extension that holds no ABAP
and runs nothing itself. It is a client of one listener (`npm start`,
`build/osd up`), set by the setting `osd.url` (default
`http://localhost:3030`). abaplint stays the language server; the debugger
is Q1 (`docs/debugging-abap.md`). What this adds is what needs a running
system:

| In VS Code | Asks the server | Where it is answered |
| --- | --- | --- |
| Test Explorer, "ABAP Unit (osd)": one item per `*.clas.testclasses.abap`, its test classes and methods resolved when expanded | `GET /sap/bc/adt/core/http/unit/object?type=CLAS&name=<X>` | `tools/adt-facade.mjs`, `UnitRun.classes()` |
| Run an object, a test class or one method; a failure carries Expected/Actual (the diff view) and the first ABAP frame of its stack as the place | `POST …/unit/object/run?type=&name=&testClass=&method=` (CSRF token and session cookie fetched with `HEAD /sap/bc/adt/core/discovery`, refetched once on a 403) | `UnitRun.runDetached()`, a child with its own database |
| Status bar: the generation served, hot swaps, the number of short dumps (red when it grows); "osd down" when nothing answers | `GET /osd/serving`, `GET /osd/dumps` every 5 s | `tools/osd-serve.mjs` |
| `osd: Show short dumps` (also a click on the status bar) | `GET /osd/dumps` | `tools/osd-serve.mjs` |

The two `/osd/*` doors are implemented by the child that runs the ABAP, and
under `npm start` the parent used to forward only `/sap/bc/*` and
`/sap/opu/odata/sap/*`, so they answered 404 on the port a client knows.
`test/start.mjs` now forwards every HOST node `src/icf/nodes.json` declares
for `tools/osd-serve.mjs` (#95).

## Key bindings

*2026-09-25.* `osd.keymap` (default `"abap"`) puts an ABAP developer's
fingers where SAP GUI / ADT (Eclipse) put them, over an `.abap` editor; set
it to `"vscode"` to get VS Code's own bindings back everywhere -- every row
below carries `when: config.osd.keymap == abap`, so the setting is the only
place this is decided. Scoped by `resourceExtname == .abap` rather than a
language id: abaplint is an extension this repo does not install or
control, so which language id it registers (if any) is not something a
`when` clause here can depend on.

| Key | SAP GUI / ADT | Here | Gap |
| --- | --- | --- | --- |
| Ctrl+F2 | Check | `osd.check` -- the current buffer (not necessarily saved) against `checkruns` (`tools/adt-facade.mjs` ~1683-1727), diagnostics on the lines | -- |
| Ctrl+F3 | Activate | `osd.activate` -- saves the file, then `activation` (~1835-1924); a failure's issues go to Problems, a pass shows the generation that now serves it (`X-OSD-Generation`) | -- |
| Ctrl+Shift+F3 | Activate all inactive | -- | **left out**: `GET .../activation/inactiveobjects` always answers an empty list by design (`tools/adt-facade.mjs`, "nothing here is ever inactive: an object is what the file says") -- there is no inactive set on the server for this to activate |
| F8 | Run | `osd.run` -- dispatched by object type (`lib.js` `RUN_TABLE` / `runActionFor`, SE80's own dispatch, table below); a class with ABAP Unit tests runs them (Test Explorer's `testing.runCurrentFile`) | see the table below |
| F9 | Run as ABAP Application (Console) | `osd.classrun` -- the current class against `oo/classrun` (Q6b, below), output in its own Output channel "osd console" | -- |
| Ctrl+Shift+F10 | Run ABAP Unit | the built-in `testing.runCurrentFile` | -- |
| F5 / F6 / F7 / F8, while a debug session is active | Step Into / Step Over / Return / Continue | the built-in `workbench.action.debug.step{Into,Over,Out}` / `.continue`, remapped only `when inDebugMode && resourceExtname == .abap`, so a non-ABAP debug session keeps VS Code's own F5 continue / F10 step over / F11 step into | -- |
| Ctrl+Shift+B | Toggle breakpoint | the built-in `editor.debug.action.toggleBreakpoint` | -- |
| F1 on a keyword | ABAP keyword documentation | -- | **left out**: ADT resolves a keyword to its help.sap.com page through its own shipped keyword-to-file index; a guessed URL (`abap` + the word + `.htm`) is wrong for enough keywords that a dead link is worse than no binding |

F8's dispatch by object type (`lib.js` `runActionFor`, held to this table by
`test/vscode-extension.mjs` without a server):

| Type | F8 here |
| --- | --- |
| CLAS, name ends `_DPC_EXT`, cursor inside a `<set>_get_entityset` / `<set>_get_entity` method | calls the set, the same as that method's CodeLens (Q2b, below) |
| CLAS, name ends `_DPC_EXT` / `_MPC_EXT`, otherwise | not yet: the rest of a Gateway client |
| CLAS, has an ABAP Unit test include | runs them (Test Explorer) |
| CLAS, declares `IF_OO_ADT_CLASSRUN`, no tests | classrun (Q6b, below) -- ABAP Unit still wins when a class carries both |
| CLAS, neither | not yet: put `IF_OO_ADT_CLASSRUN` on the class, or give it tests |
| INTF | nothing of its own to run |
| PROG | not yet: no server route to run a report headlessly |
| FUGR | not yet: a test form from `GET /sap/bc/osd/rfc/functions/<NAME>`, then `POST /call` |
| TABL, DDLS | not yet: data preview |
| IWSV | not yet: the Gateway client on the service document |
| SICF | not yet: open the node's URL |

## Q2b: calling an entity set

*2026-09-25.* A CodeLens "▶ Call \<Set\>" over every `METHOD
<set>_get_entityset.` / `METHOD <set>_get_entity.` line of a SEGW `_DPC_EXT`
class's source. The class → service → set mapping is a server route rather
than a build artefact (the smaller of the two ways the class carried this
work): `GET /sap/bc/adt/core/http/segw/entitysets?class=<NAME>`
(`tools/adt-facade.mjs`) answers `{class, service, mpc, sets: [{method,
kind, set}]}` for a class the registry knows as a service's DPC, 404
otherwise -- read fresh off the tree on every call, never guessed from a
file name: the service comes from `segwRegistrations()`
(`tools/segw-registry.mjs`, the project's own IWSV/IWMO), the set's real
name and case from the MPC's own entity-name constants
(`tools/segw-entityset-map.mjs`, the type SEGW gives every one of them,
`ty_e_med_entity_name`, not the constant's own name). A `_DPC_EXT` and its
model's `_MPC_EXT` are read together with their base classes (SEGW puts the
constants and the generated method bodies there, the hand-written overrides
in `_EXT`), the way inheritance actually resolves them.

Clicking a lens does `GET <osd.url>/sap/opu/odata/sap/<service>/<set>?$top=
20&$format=json` for `_get_entityset`, or prompts for a key (defaulted from
the first row's own `__metadata.uri`, `keyOf` in `lib.js`) and does
`<set>(<key>)?$format=json` for `_get_entity`, and shows the answer in a
webview: the URL, the HTTP status, the time and the row count above a table
(the columns are the properties, `__metadata` left out), a "raw JSON"
toggle beside it. F8 does the same when the cursor sits inside one of these
two kinds of method (`lib.js` `methodAtLine` finds which, `RUN_TABLE`'s
`CLAS` entry answers `{kind: "call-entityset", ...}` when it does); every
other `_DPC_EXT` / `_MPC_EXT` case is still the "not yet" of the F8 table
above.

`editors/vscode/lib.js` carries the pure half (`entitySetMethodLines`,
`entitySetLenses`, `methodAtLine`, `resultRows`, `stripMetadata`, `keyOf`,
`Osd#entitySets`, `Osd#odata`); `tools/segw-entityset-map.mjs` carries the
server's own mapping (`entityNameConstantsOf`, `entitySetMethodsOf`,
`entitySetsOf`, `entitySetMapFor`), both tested without VS Code or a server
in `test/vscode-extension.mjs`; the route itself in
`test/adt-devloop.mjs`, beside the other `core/http/*` routes.

## Q3: readers of a class or interface

*2026-09-25.* A CodeLens "read by N · tests M · services K" over a class's
own `CLASS <name> DEFINITION` line or an interface's own `INTERFACE <name>`
line. It is the reverse of Q2b's own class-to-service map: not what a
`_DPC_EXT` calls, but who calls *this* class or interface, off the
cross-reference tables every host already seeds at start
(`tools/osd-xref-seed.mjs`, from the parse) -- the same direction
`tools/osd-xref.mjs --who-calls` reads for a terminal. A
`WBCROSSGT`/`WBCROSSGTX` row is `{OTYPE: 'TY', NAME: the referenced object,
INCLUDE: the referencer}`, and `INCLUDE` already carries the referencing
object's own name, never a per-include suffix (`tools/osd-xref.mjs`
`CrossReference#build`, the `WBCROSSGT` branch), so no include-to-object
mapping is needed to read it back. `GET
/sap/bc/adt/core/http/xref/readers?type=CLAS|INTF&name=<NAME>`
(`tools/adt-facade.mjs`) answers `{name, readers: [{type, name, include,
isTest, services}], counts: {readers, tests, services}}` for a CLAS or INTF
this store knows, 404 otherwise; the class or interface itself and any
self-reference are left out. The rows are read the same way the client's own
data preview reads any table (`data.query`, `tools/osd-data.mjs`) -- this is
a where-used view over the same seeded tables, not a second index. A reader
is marked a test when it carries its own ABAP Unit tests
(`tools/osd-unit-run.mjs` `testClassesIn`) and a service when it is
registered as a service's own `_DPC_EXT` (`tools/segw-registry.mjs`
`segwRegistrations`, read fresh off the tree the way the entitysets route
does); a reader can be neither, either, or both.

Clicking the lens shows a quick pick of the readers (Test / Service tagged in
the description) and opens the file of the one chosen, by the glob its own
type and name give (`readerFilePattern` in `lib.js`: `**/<base>.<ext>.abap`,
the same namespace-to-`#` mapping `objectOf` reads back) -- a type this
extension has no file shape for (FUGR, TABL, DDLS, ...) opens nothing rather
than guessing. A save anywhere refreshes the lens, since a reference to the
class open in the editor can be added or removed in any other file.

`editors/vscode/lib.js` carries the pure half (`readersLensLine`,
`readersLensTitle`, `readersQuickPickItems`, `readerFilePattern`, `Osd#readers`),
tested without VS Code or a server in `test/vscode-extension.mjs`; the route
itself in `test/adt-devloop.mjs`, beside the other `core/http/*` routes.

## Q4: hotspots

*2026-09-25.* Short dumps are kept in a table the way a system keeps them
for ST22: `ZOSD_DUMP` (`src/dumps/zosd_dump.tabl.xml`, client-dependent,
key `MANDT` + `DUMP_ID`), one row per dump -- the runtime error, the
message, the ABAP position (object type, object name, include, line), the
request (method, path truncated to 120), the generation, and the frames as
a JSON string. Capped at the last `OSD_DUMP_CAP` rows (default 1000, an
env var read once) so a long-lived process does not grow it without bound.

**Writing is a kernel job, not the application's** -- the same rule as the
end of a dialog step (`tools/osd-dialog-step.mjs`, "a rule for what every
host must do lives in a module they all import"): an AS ABAP writes a dump
*after* the LUW has been rolled back, in its own statement and its own
commit, never inside the failed one. `tools/osd-dumps.mjs` (`persistDump`)
is that module; `tools/osd-serve.mjs`'s `dump()` calls it, not awaited, only
after the request's own `dialogStep()` has already rolled back (its catch
runs on a rejected `await`, by which point `exclusive()`'s `finally` has
released the work process) -- `persistDump` commits through a fresh
`dialogStep()` of its own. `test/start.mjs`'s inline front (`MODE ===
"inline"`, `runtime === undefined`) has **no dump hook at all**: its catch
logs to the console and answers 500, with no ring and no `/osd/dumps` --
that door is declared only for `tools/osd-serve.mjs`
(`src/icf/nodes.json`), so there was nothing to wire this into, and it is
left that way on purpose rather than given a second, parallel writer.

`/osd/dumps` keeps its current shape (the in-memory ring of the last 100,
tested by `test/osd-child.mjs` and depended on by the status bar below) --
smaller than teaching it to read the table, and the two are two views of
the same events rather than two sources of truth.

**Reading is the freestyle SQL door Q6a's notebook already uses** -- no new
route. `editors/vscode/lib.js` `HOTSPOTS_SQL` groups `ZOSD_DUMP` by
`(objname, include, line)`, with a correlated subquery for each line's own
last message; `Osd#hotspots()` runs it through `Osd#freestyle()` and
`hotspotsFromRows` turns the answer into `{byLine: [{objname, include,
line, count, lastAt, lastMessage}], byFile: {OBJNAME: count}}` --
normalising every column to lower case first, because `tableDataDocument`
(`tools/adt-facade.mjs`) always writes `dataPreview:name` upper-case
regardless of how the SQL cased it, and a reducer that trusted the SQL's
own case would only fail against the real door, never against a fixture
that happened to agree with it.

In the editor: a `vscode.TextEditorDecorationType` per intensity bucket
(`hotspotBucket`, 1 dump to 4 = ten or more), a translucent red
(`rgba(255, 0, 0, alpha)`, heavier per bucket) laid over whatever the
theme's own background is rather than a colour of its own, so it reads in
both; hovering a coloured line shows `hotspotHoverText` ("N dumps, last
\<ISO time\>: \<message\>"). A `FileDecorationProvider` puts a badge
(`hotspotBadge`, "1".."9", else "9+" -- VS Code keeps at most two
characters of it) on an `.abap` file in the explorer, summed over every
include of the object. Command "osd: Refresh hotspots"
(`osd.refreshHotspots`) re-reads the table and redecorates; so does a timer
(`osd.hotspots.refreshSeconds`, default 30, 0 = off, re-read on a settings
change) and the end of `osd.run` / `osd.activate` (fire-and-forget, so
neither waits on it). The status bar's dump count (Q2, `$(bug) N`) is left
reading `/osd/dumps` as before -- the ring and the table are fed by the
same `dump()`, so the two numbers are already the same kind of count, just
with different caps (100 vs. `OSD_DUMP_CAP`).

`editors/vscode/lib.js` carries the pure half (`HOTSPOTS_SQL`,
`hotspotsFromRows`, `hotspotBucket`, `hotspotColor`, `hotspotBadge`,
`hotspotHoverText`, `Osd#hotspots`), tested without VS Code in
`test/vscode-extension.mjs`, including one round trip through
`tableDataDocument` so the upper-casing above is caught by a fixture built
the way the server actually answers, not typed by hand to agree with the
code under test. The write, the rollback and the read together, against a
real `tools/osd-serve.mjs` (`ServingRuntime`, in-memory database) rather
than a synthetic dump: `test/osd-dumps.mjs`.

**ANORMALIES-worth noting here rather than there** (a one-liner, since the
difference is deliberate and small): unlike SAP's `SNAP`, `ZOSD_DUMP` is
one flat table with no TemSe cluster and no per-user/task columns -- a
short dump here is what `tools/osd-where.mjs` can already say (the ABAP
position and the frames), and this table is exactly that, kept.

Not done: `test/start.mjs`'s inline front writes nothing (see above); OSGo
(the Go runtime) does not write the table at all -- named as a follow-up,
not attempted here.

## Q6a: a SQL notebook

*2026-09-25.* `*.osdnb` is a small JSON file of SQL (or markdown) cells
(`editors/vscode/examples/demo.osdnb`): a VS Code
[NotebookSerializer](https://code.visualstudio.com/api/extension-guides/notebook)
for the type `osd-sql-notebook` (`package.json` `contributes.notebooks`,
selector `*.osdnb`), and a `NotebookController` named "osd SQL" that runs a
cell the way ADT's own SQL Pane does: `POST
/sap/bc/adt/datapreview/freestyle?rowNumber=<osd.notebook.rowLimit>` with
the cell's own text as the body (`tools/adt-facade.mjs`, ~2358; `data.query`
underneath is SELECT-only and applies the row limit itself -- this is the
one façade route that already does exactly what a notebook cell needs, so
Q6a adds no new server route). The answer is XML, column-oriented (one
`<dataPreview:columns>` per selected column, its own metadata and a
`<dataPreview:data>` per row -- `tableDataDocument`, ~257); a cell's output
is that answer turned into an HTML table (`text/html`, escaped so a value
carrying `<` or `&` renders as text) with a status line "N rows · M ms ·
\<generation\>" (the generation off `X-OSD-Generation`, set on every façade
answer), plus the same rows as `application/json` so VS Code's own JSON /
table renderers work on them too. A refused statement (not a SELECT, or a
database never built) becomes the cell's error output, the server's own
message unwrapped. Command "osd: New SQL notebook" opens a fresh one-cell
notebook of the type.

`editors/vscode/lib.js` carries the pure half (`freestyleRows`,
`freestyleTableHtml`, `htmlEscape`, `notebookFromJson`, `notebookToJson`,
`Osd#freestyle`), tested without VS Code or a server in
`test/vscode-extension.mjs`; the route itself (already exercised in
`test/adt-facade.mjs`) also gets one round trip in `test/adt-devloop.mjs`,
beside the other façade routes that suite drives through a CSRF session.

## Q6b: classrun

*2026-09-26.* ADT's own F9, "Run as ABAP Application (Console)":
`POST /sap/bc/adt/oo/classrun/<name>` (`tools/adt-facade.mjs`), advertised
in discovery the way the real system does it -- a plain collection, no
`app:accept`, no compatibility-graph node
(`.local/adt-corpus/latest/bodies/00009-response.xml` /
`00008-response.xml`, the discovery and compatibility captures) --
instantiates a class that declares `INTERFACES if_oo_adt_classrun` and
calls its `MAIN` with a console object of this repo's own,
`ZCL_OSD_CLASSRUN_OUT` (`src/classrun/`), implementing
`IF_OO_ADT_CLASSRUN_OUT` the interface `main` takes. Both interfaces are
open-abap-core's own (`src/classrun/if_oo_adt_classrun*.intf.abap`), an MIT
library `abap_transpile.json` already pulls in whole -- they were not
missing, so nothing here is a clean-room addition of the interfaces
themselves, only of the OUT implementation and the route.

`WRITE` is kept modest: a simple value becomes one line (`name = value`
when a name is given), a structure becomes one `field: value, field: value`
line, and an internal table becomes a header line of column names followed
by one tab-separated line per row (its own line per row for an
elementary-typed table); anything RTTI resolves to neither elem, struct nor
table becomes a line saying WRITE does not format it, rather than dumping.
The answer is always `text/plain`; a dump is still a 200, the way ADT's own
console shows a partial run -- whatever the class had already written, then
`Runtime error: <message> at <ABAP position>`.

Unlike an ABAP Unit run (`tools/osd-unit.mjs`), which spawns a detached
child with its own throwaway database because a test's writes must never
land in the rows the application serves, a classrun **is** a run of the
application: it shares the one live connection every other request runs
against, wrapped the same way -- a dialog step
(`tools/osd-dialog-step.mjs`), commit when the work is done, roll back when
it dumps, the work-process lock in between. A dump is recorded exactly like
a runtime dump (`tools/osd-dumps.mjs` `ZOSD_DUMP`), not swallowed; the
console text already written survives the rollback because it lives in the
OUT object's own memory, not in a row. `tools/osd-classrun.mjs`'s
`ClassRun#run` (asked for through `store.classrun()`, the same lazy pattern
as `store.unit()`) does the work when the façade holds the connection
itself (inline mode, and every test here); when a served (child) runtime
holds it instead (`STG_SERVE=child`, `npm start`'s and `test/run.mjs`'s own
default), the façade forwards through a door of the same shape as the
existing SQL one -- `POST /osd/classrun` on `tools/osd-serve.mjs`
(`src/icf/nodes.json`, `Data#classrun` in `tools/osd-data.mjs`) -- because
that is the process actually holding the connection there. Verified live on
both: inline through the mocha suites below, served (child) mode by hand on
a throwaway port (5, in the PR).

**F9** (`osd.classrun`, its own Output channel "osd console") runs the
current class standalone, and **F8** dispatches to it
(`RUN_TABLE.CLAS`, `ctx.hasClassrun`) for a class that declares the
interface and carries no ABAP Unit tests -- tests still win when a class
happens to have both. `ctx.hasClassrun` is `implementsClassrun`
(`editors/vscode/lib.js`), the same regex `tools/osd-classrun.mjs` runs
server-side, over the editor's own buffer (not necessarily saved), the way
`ctx.hasUnitTests` is a file-system fact and Ctrl+F2's check already reads
the unsaved buffer.

Not done: ABAP cells in the SQL notebook (Q6a). The obvious design -- a
scratch class in a gitignored layer, written and activated per cell,
classrun immediately -- runs into two facts of this tree rather than one:
`ObjectStore#rootsOf` resolves the writable roots **once, at construction**
(`tools/osd-store.mjs`), so a pack folder (`tools/osd-packs.mjs`,
`OSD_PACKS`) has to exist on disk *before* the façade's process starts, not
something a notebook cell can arrange against an already-running `osd`; and
`ObjectStore#write` puts a brand-new object in the **first** writable root
regardless (`this.roots.find((r) => r.writable)`), not a root a caller
names, so even with the pack pre-existing, nothing hands a cell's scratch
class to it without a small store change (an optional target root on
`write()`). Under that, activating and classrunning the same class within
one still-running process hits the fact `tools/osd-classrun.mjs` documents
at length: Node pins a module graph for the life of a process, the same
reason the serving runtime recycles into a new one after every activation
rather than reload; measured directly on this worktree (occasional `lstat
ENOENT` on a file the build had just written, naming the *previous*
generation's hash even though `readlinkSync` in the same process already
showed the new one) and the reason this repo's own classrun fixtures
(`src/classrun/zcl_osd_classrun_demo.clas.abap`,
`zcl_osd_classrun_dumper.clas.abap`) are ordinary tracked objects built by
`npm run transpile`, not written by a test. The smallest fix that keeps
"sources stay files, git is the only version layer" is two small, separate
pieces of future work: an optional `root` on `ObjectStore#write` for a
caller that already knows which one, and a permanently-declared (not
pack-discovered) scratch root so a notebook does not need `OSD_PACKS` set
before `osd` starts -- neither attempted here.

## Trying it

No build step and no dependencies: plain CommonJS, VS Code's own Node.

```sh
npm start                                   # in one terminal
code --extensionDevelopmentPath="$PWD/editors/vscode" "$PWD"
```

or, to keep it installed, *Developer: Install Extension from Location…* on
`editors/vscode`. Never `npm install` in that folder: it has nothing to
install.

## Tests

- `test/vscode-extension.mjs`: `editors/vscode/lib.js` without VS Code --
  file name to object and include, include to file, a run's answer per
  method, the frame a failure points at, a check run's diagnostics and an
  activation's result read off the real documents (`tools/adt-documents.mjs`
  `checkReportDocument` / `activationSuccessDocument` /
  `activationFailureDocument`, imported directly rather than re-typed), F8's
  dispatch table, and Q2b's lens placement / cursor-to-method / OData row
  shapes, including one test run against the demo's own DPC_EXT and MPC
  sources through `tools/segw-entityset-map.mjs` end to end; Q6a's
  `freestyleRows` / `freestyleTableHtml` / `htmlEscape` /
  `notebookFromJson` / `notebookToJson`, including a cell value carrying
  `<` and `&`; Q6b's `implementsClassrun` against the tracked demo fixture
  and against a comment merely naming the interface, and `RUN_TABLE.CLAS`'s
  classrun branch (tests still win over it, a DPC_EXT still wins over both).
- `test/adt-devloop.mjs`: `core/http/segw/entitysets` against the real demo
  service, beside the other `core/http/*` routes; Q6a's `datapreview/
  freestyle` round trip (a SELECT over the demo data, through the same CSRF
  session the rest of that suite uses); Q6b's `oo/classrun` against the
  tracked demo class (a scalar and a table, formatted), a class that does
  not implement the interface (400), an unknown class (404), discovery, and
  the tracked dumper fixture's rollback-and-record path read back through
  `ZOSD_DUMP` -- all against fixtures already transpiled before this
  suite's `before()` boots, on purpose (see Q6b above).
- `test/osd-child.mjs`: the extension's own client (`Osd`) against a real
  `npm start`, through the parent -- the doors, discovery, one method run
  with the CSRF round trip.
- `test/osd-dumps.mjs`: Q4 -- `objectOf`/`rowOf` (`tools/osd-dumps.mjs`)
  against abapGit file names and `dumpOf()`'s own shape; a real request that
  dumps, against a real `tools/osd-serve.mjs` (`ServingRuntime`), writes one
  `ZOSD_DUMP` row with the right object and line while the rest of its
  changeset is still rolled back, readable through `/osd/sql` and through
  the same `GROUP BY` a hotspot query runs; the cap.

`extension.js` itself (the Testing API wiring) is checked by hand in VS Code
only; there is no `@vscode/test-electron` here, on purpose, since it would
download a VS Code per run.

## Next

- Smart F8 / Runner, the rest of it: create/update/delete entity, a function
  import, `$expand` on the lens's own request. Today's lens and F8 only
  read (Q2b, above).
