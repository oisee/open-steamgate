# Stopping on a breakpoint set in a `.abap` file

*Measured 2026-09-25, Node 26.9.0, against this tree's `output/` (generation
`96efd101f48945df`).* `write_source_map: true` in `abap_transpile.json`
already writes a `.mjs.map` beside every `.mjs`, per-statement, whose
`sources` entry is a relative path back into `src/` (or `gen/`). This is
what makes a breakpoint on the `.abap` line possible at all; nothing here
adds source maps, it only gets a debugger onto the process that runs them.

## Which process to debug

`npm start` is two processes: `test/run.mjs` (the façade -- static files,
the ADT surface, a proxy) and a child, `tools/osd-serve.mjs`, spawned by
`tools/osd-runtime.mjs` (`ServingRuntime#spawnOne`). **The child is the one
that imports `output/*.mjs` and runs the transpiled ABAP.** The façade
imports none of it. A breakpoint has to reach the child.

Setting `NODE_OPTIONS=--inspect=<port>` on the shell before `npm start`
reaches both: the child's env is `{...process.env, ...}` in
`osd-runtime.mjs`, so it inherits whatever `NODE_OPTIONS` the façade itself
was started with. Checked by hand: two Node processes started a beat apart
with the same `--inspect=127.0.0.1:<port>` in `NODE_OPTIONS` do not crash --
the second one logs `Starting inspector on 127.0.0.1:<port> failed: address
already in use` and keeps running undebugged. Whichever of the two wins the
port is a race, and it is at least as likely to be the façade, which never
runs ABAP, as the child.

So `OSD_INSPECT=<port>` (this change, `tools/osd-runtime.mjs`) asks
`ServingRuntime#spawnOne` to fold `--inspect=127.0.0.1:<port>
--enable-source-maps` into the **child's** `NODE_OPTIONS` only, appended to
whatever `NODE_OPTIONS` the instance already carries rather than replacing
it. The façade's own process is never touched, so there is no port to race
for.

```
OSD_INSPECT=9229 npm start
```

`RuntimePool` (`OSD_WORKERS>1`) constructs one `ServingRuntime` per worker
with the same options, so today every worker would try the same inspector
port and only the first would get it -- debug with `OSD_WORKERS=1` (the
default).

## Proof, without a VS Code UI

**1. A thrown ABAP exception's stack already names the `.abap` line.**
`node --enable-source-maps` resolves it through the transpiler's own
`.mjs.map`, with no code of ours involved (`tools/osd-where.mjs` is a
second, independent reader of the same maps, used for `ST22`-style dumps --
this is V8's own `--enable-source-maps`, the mechanism a debugger's call
stack also reads):

```
$ node --enable-source-maps script.mjs   # imports output/zcl_stg_url.clas.mjs,
                                          # calls parse() with a bad path
Error: [object Object]
    at zcl_stg_url.parse (/home/alice/dev/open-steamgate/src/gateway/zcl_stg_url.clas.abap:59:7)
    at file:///.../script.mjs:23:21
```

Checked both ways `output/` can be reached: importing through the `output/`
symlink (`-> build/live -> by-input/<hash>/output`) and importing the real
`build/by-input/<hash>/output/zcl_stg_url.clas.mjs` directly give the
**identical** resolved `.abap:line` -- Node resolves a compiled module's own
path to its real path before applying the map's relative `sources` entry,
so the symlink is transparent. (Without `--enable-source-maps`, the same
throw's stack already names the *real* path, `build/by-input/<hash>/output/
zcl_stg_url.clas.mjs:84:32`, confirming the realpath resolution happens
before source maps ever get involved.)

**2. A breakpoint set over the debug protocol actually stops there.** This
is the same protocol (CDP) `vscode-js-debug` speaks; a raw WebSocket client
was used in place of the VS Code UI. Against a live child (`OSD_INSPECT` as
above):

```
setBreakpointByUrl: {"breakpointId":"1:83:0:file:///.../by-input/96efd101f48945df/output/zcl_stg_url.clas.mjs",
                      "locations":[{"scriptId":"1861","lineNumber":83,"columnNumber":24}]}
RACE: paused
PAUSED at scriptId 1861 line(0-based) 83 col 24 fn parse (breakpoint was on scriptId 1861)
evaluate result: {"result":{"type":"string","value":"Not an OData path: /definitely/not/an/odata/path"}}
```

Line 83 (0-based) = generated line 84, the exact line the source map above
resolves to `zcl_stg_url.clas.abap:59` (`RAISE EXCEPTION TYPE
zcx_stg_error`). The call was made through `Runtime.evaluate` reaching the
class via `globalThis.abap.Classes["ZCL_STG_URL"]` (a plain
`Runtime.evaluate` cannot `import()` -- Node's inspector has no
`importModuleDynamicallyCallback` wired up for it,
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` -- the runtime's own class
registry has no such limit and is what a debugger session would reach for
anyway). `Debugger.resume` let it finish and return the ABAP exception's
own message, proving the process was genuinely paused and not just
inspected after the fact.

## `launch.json`

`.vscode/` is gitignored in this repo; paste this into your own.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "OSD: attach to the child (ABAP runs here)",
      "type": "node",
      "request": "attach",
      "address": "127.0.0.1",
      "port": 9229,
      "restart": true,
      "resolveSourceMapLocations": [
        "${workspaceFolder}/build/**",
        "!**/node_modules/**"
      ],
      "skipFiles": [
        "<node_internals>/**",
        "${workspaceFolder}/node_modules/@abaplint/runtime/**"
      ],
      "outFiles": ["${workspaceFolder}/build/**/*.mjs"],
      "customDescriptionGenerator": "this && this.get ? (this.getQualifiedName && this.getQualifiedName() ? this.getQualifiedName() + ' ' : '') + JSON.stringify(this.get()) : undefined"
    },
    {
      "name": "OSD: npm start, debug the child",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["start"],
      "cwd": "${workspaceFolder}",
      "env": {"OSD_INSPECT": "9229"},
      "autoAttachChildProcesses": true,
      "console": "integratedTerminal",
      "resolveSourceMapLocations": [
        "${workspaceFolder}/build/**",
        "!**/node_modules/**"
      ],
      "skipFiles": [
        "<node_internals>/**",
        "${workspaceFolder}/node_modules/@abaplint/runtime/**"
      ],
      "outFiles": ["${workspaceFolder}/build/**/*.mjs"]
    }
  ]
}
```

The attach config is the reliable one: start the server by hand
(`OSD_INSPECT=9229 npm start`, or `npm run osd:serve` with the same env)
and attach to port 9229. The launch config runs `npm start` from VS Code
itself and relies on `autoAttachChildProcesses` to notice the child's
inspector; unverified here, since it needs the VS Code UI to observe the
attach actually happen (see below).

`customDescriptionGenerator` was checked the same way as the breakpoint,
not through the UI: the expression above, wrapped as
`function() { return <expr>; }` and sent as `Runtime.callFunctionOn`'s
`functionDeclaration` with `objectId` bound to a live `abap.types.String`
and a live `abap.types.Integer` (which is how `vscode-js-debug` evaluates
it, `this` bound to the inspected object) -- both returned `"hello world"`
and `42` rather than `[object Object]` or throwing.

## Not yet

- **`--inspect`, not `--inspect-brk`.** The child does not pause at start,
  so a breakpoint on code that only runs during boot (the ICF registry
  apply, the cross-reference seed, the demo data write) has already run by
  the time a debugger attaches. `OSD_INSPECT_BRK` would be the same change
  with `--inspect-brk`; not added, because nothing needed it yet.
- **VS Code itself is unverified.** Everything above was proven by speaking
  CDP directly (the same protocol, not the same client): whether
  `vscode-js-debug` actually resolves a breakpoint placed by clicking in a
  `.abap` file to the generated location the way this doc's raw
  `setBreakpointByUrl` call did by hand, whether `autoAttachChildProcesses`
  actually notices the child, and whether the Variables pane renders
  `customDescriptionGenerator`'s output, all need the UI this environment
  does not have.
- **A pooled server (`OSD_WORKERS>1`).** `RuntimePool` builds one
  `ServingRuntime` per worker from the same options, so `OSD_INSPECT` would
  point every worker's `NODE_OPTIONS` at the same port; only the first
  binds it, checked above for the plain-`NODE_OPTIONS` case and true here
  for the same reason. Debug with one worker.
