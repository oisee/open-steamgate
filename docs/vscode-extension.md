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
  method, the frame a failure points at.
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
