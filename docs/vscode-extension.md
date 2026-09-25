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
| F9 | Run as ABAP Application (Console) | -- | **left out**: no `oo/classrun` route exists (`docs/adt-facade-shift-left.md`: "`oo/classrun` -- not served today") -- binding it would invent server work instead of calling it |
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
| CLAS, neither | not yet: `IF_OO_ADT_CLASSRUN` has no server route (see F9 above) |
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

Left for Q6b: ABAP cells (`IF_OO_ADT_CLASSRUN`-shaped, `classrun`) -- the F8
table above already notes `oo/classrun` is not served today.

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
  `<` and `&`.
- `test/adt-devloop.mjs`: `core/http/segw/entitysets` against the real demo
  service, beside the other `core/http/*` routes; Q6a's `datapreview/
  freestyle` round trip (a SELECT over the demo data, through the same CSRF
  session the rest of that suite uses).
- `test/osd-child.mjs`: the extension's own client (`Osd`) against a real
  `npm start`, through the parent -- the doors, discovery, one method run
  with the CSRF round trip.

`extension.js` itself (the Testing API wiring) is checked by hand in VS Code
only; there is no `@vscode/test-electron` here, on purpose, since it would
download a VS Code per run.

## Next

- Smart F8 / Runner, the rest of it: create/update/delete entity, a function
  import, `$expand` on the lens's own request. Today's lens and F8 only
  read (Q2b, above).
