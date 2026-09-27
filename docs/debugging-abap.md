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

## VS Code extension-managed debugging

Set `osd.debug` to `true` before using **osd: Start**. The launcher picks a
free loopback inspector port, sets `OSD_INSPECT` only on the launched system,
and starts VS Code's Node attach configuration itself. The child that serves
ABAP is the process being debugged; the façade remains uninspected. A normal
**Full rebuild** keeps the same port where it is free, so the attach session's
`restart` option reconnects when the new serving child starts. Warm activation
recycles that same child port and uses the same reconnect path. Debug launches
use one serving worker because multiple workers cannot share one inspector
port.
For a packaged install, workspace ABAP is compiled through symlinks in the
extension's storage. The attach configuration maps those pack source-map URLs
back to the workspace folders, so a breakpoint in the open editor binds to
the compiled line.

ABAP Unit uses a separate inspector for each detached test child. The child
gets `--inspect=127.0.0.1:<port>` and `--enable-source-maps`. The extension
starts the attach session before requesting the detached run. The child uses
`--inspect-brk`, so it waits at entry until the debugger has installed
breakpoints; js-debug's `continueOnAttach` then resumes it. `test/vscode-debug.mjs`
exercises this ordering against a real detached run. The Test Explorer's **Debug** profile always uses this
path. With `osd.debug` enabled, the ordinary Test Explorer Run profile and F8
unit runs also attach automatically.

**Run with debugger** is available beside F8's ordinary Run action. The
entity-set CodeLens and classrun command also have debugger variants; those
execute in the persistent system, so that system must have been started by
the extension with `osd.debug` enabled. Turning the setting on after a system
has started takes effect on its next start. The status-bar item **Toggle ABAP
breakpoints** runs VS Code's global breakpoint activation command;
it leaves the breakpoint markers in place while temporarily disabling or
reactivating them. VS Code does not expose this global activation state to
extensions, so the item does not claim an on/off state that could disagree
with the built-in toggle.

When `osd.debug` is false, the launcher removes inherited `OSD_INSPECT` from
its child environment. Ordinary test children get no inspector flags unless
the Debug profile or a debugger run command requested one.

```
OSD_INSPECT=9229 npm start
```

`RuntimePool` (`OSD_WORKERS>1`) constructs one `ServingRuntime` per worker
with the same options, so today every worker would try the same inspector
port and only the first would get it -- debug with `OSD_WORKERS=1` (the
default).

## Which copy

A breakpoint binds only in the file a loaded source map names. The
transpiler writes each `sources` entry relative to the generation's own
`build/by-input/<hash>/output`, so it always resolves inside the tree that
built it -- the system's osdHome. Measured 2026-09-27 on this tree:
`output/zcl_stg_url.clas.mjs.map` names
`../../../../src/gateway/zcl_stg_url.clas.abap`, which resolves to
`<osdHome>/src/gateway/zcl_stg_url.clas.abap` and nowhere else.

That is correct for a checkout that runs itself, and it is exactly why
breakpoints did not stop for a user whose running system was a different
copy of the same file. Three ways to get there, all confirmed by reading the
extension and the maps:

- **The bundled copy with a checkout open.** A packaged install runs the
  seed materialized in `globalStorage/osd-home-<seed>` (real copies, not
  links -- `linkOrCopyTree`). The checkout in the window is a second tree
  with the same file names. The attach configuration's
  `sourceMapPathOverrides` covers workspace packs only, so nothing maps the
  home's `src/` back to the checkout's.
- **`osd.home` pointing at another checkout** than the one being edited.
- **An object a later layer overrides** (`osd-build: overridden: ...`).
  The hidden file is still on disk and still opens; the build compiled the
  winner. On this tree, `packs/zvdb/src/zcl_vdb_100_hana.clas.abap` is
  hidden by `gen/amdp/zcl_vdb_100_hana.clas.abap`.

A fourth case is not a copy: a library's map (open-abap-core, the
open-abap-odata interfaces) names a bare file name,
`cl_abap_char_utilities.clas.abap`, which resolves inside `output/` to a
file that does not exist, so no breakpoint binds in a library at all. On
this tree 1696 modules carry 830 maps; 462 of those are library maps of
that kind, and the ones left name 362 files that exist.

The extension now says so instead of leaving a grey marker. When an OSD
debug session starts, and whenever a breakpoint is added during one, each
`.abap` breakpoint is checked against the set of files the running
generation's maps name and that exist on disk (`runningAbapSources` in
`editors/vscode/lib.js`: 362 files, a few tens of milliseconds here, cached
per generation, pack storage paths mapped back to the workspace folder the
same way the attach configuration maps them). A breakpoint outside that set gets one warning per file per
generation, naming the copy that runs and offering to open it. The check
does not move a breakpoint or change which copy runs; that stays the
person's choice (**osd: Choose which system Start runs**, `osd.home`).

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

The attach config is the manual alternative: start the server by hand
(`OSD_INSPECT=9229 npm start`, or `npm run osd:serve` with the same env)
and attach to port 9229. The launch config runs `npm start` from VS Code
itself and relies on `autoAttachChildProcesses` to notice the child's
inspector. With the extension, no `launch.json` is needed for systems it
starts itself.

`customDescriptionGenerator` was checked the same way as the breakpoint,
not through the UI: the expression above, wrapped as
`function() { return <expr>; }` and sent as `Runtime.callFunctionOn`'s
`functionDeclaration` with `objectId` bound to a live `abap.types.String`
and a live `abap.types.Integer` (which is how `vscode-js-debug` evaluates
it, `this` bound to the inspected object) -- both returned `"hello world"`
and `42` rather than `[object Object]` or throwing.

## Not yet

- **The serving child uses `--inspect`, not `--inspect-brk`.** It does not pause at start,
  so a breakpoint on code that only runs during boot (the ICF registry
  apply, the cross-reference seed, the demo data write) has already run by
  the time a debugger attaches. `OSD_INSPECT_BRK` would be the same change
  with `--inspect-brk`; not added for the serving child. Detached debug tests
  use `--inspect-brk` because their test methods can finish before an attach.
- **The VS Code UI is still unverified here.** `test/vscode-debug.mjs` starts
  a detached ABAP Unit child, attaches to it over CDP, sets a breakpoint
  from the test method's source map and asserts that the child pauses on that
  line. This verifies the inspector and source-map path without a UI; whether
  a click in the editor resolves identically and how the Variables pane
  renders `customDescriptionGenerator` still need an interactive VS Code
  session.
- **A pooled server (`OSD_WORKERS>1`).** `RuntimePool` builds one
  `ServingRuntime` per worker from the same options, so `OSD_INSPECT` would
  point every worker's `NODE_OPTIONS` at the same port; the extension sets
  `OSD_WORKERS=1` for its debug launches. A manually started debug server
  still needs one worker.
