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
| CLAS, name ends `_DPC_EXT` / `_MPC_EXT` | not yet: a Gateway client prefilled with the service and the entity set of the method under the cursor |
| CLAS, has an ABAP Unit test include | runs them (Test Explorer) |
| CLAS, neither | not yet: `IF_OO_ADT_CLASSRUN` has no server route (see F9 above) |
| INTF | nothing of its own to run |
| PROG | not yet: no server route to run a report headlessly |
| FUGR | not yet: a test form from `GET /sap/bc/osd/rfc/functions/<NAME>`, then `POST /call` |
| TABL, DDLS | not yet: data preview |
| IWSV | not yet: the Gateway client on the service document |
| SICF | not yet: open the node's URL |

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
  `activationFailureDocument`, imported directly rather than re-typed), and
  F8's dispatch table.
- `test/osd-child.mjs`: the extension's own client (`Osd`) against a real
  `npm start`, through the parent -- the doors, discovery, one method run
  with the CSRF round trip.

`extension.js` itself (the Testing API wiring) is checked by hand in VS Code
only; there is no `@vscode/test-electron` here, on purpose, since it would
download a VS Code per run.

## Next

- OData: from a `_DPC_EXT` method, call its entity set. The class → service
  → set mapping is `segwRegistrations()` (`tools/segw-registry.mjs`); it
  needs to be written out as JSON at transpile (`gen/segw/registry.json`)
  or served, then a CodeLens on `GET_ENTITYSET` opens the result.
- Q3, readers of a class, as a CodeLens count over the xref route.
