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

**Debugging switches itself on; `osd.debug` is gone** (2026-09-28). A
system is started without an inspector, and the first debug intent opens
one in the running serving child, with no restart:

- a breakpoint set (or enabled) in an `.abap` file while the system runs;
- **Run with debugger**, the entity-set CodeLens's and classrun's debugger
  variants (they run in the serving child);
- a system started while `.abap` breakpoints are already set.

The entity-set **Attach debugger and call** action opens the inspector and
attaches before making the same OData request as **Call**. It does not
automatically pause at method entry. An enabled breakpoint can stop it;
ordinary **Call** can stop there too because the extension attaches the
debugger when an `.abap` breakpoint is set.

The extension asks the launcher, which picks a free loopback port and posts
`{open: true, port}` to the system's `/osd/inspector` door (`test/start.mjs`,
answered to callers on this machine only). The supervisor sends the child
`{type: "inspector"}` over the process channel, and the child calls
`node:inspector`'s `open(port, "127.0.0.1")` (`tools/osd-inspector.mjs`,
which refuses any other host). Then the extension starts its Node attach
session with the same source-map settings as before. The supervisor
remembers the port, so a recycle or a warm activation's recycle opens it
again in the new child at its start on the same port, and the attach
session's `restart` option reconnects. A full rebuild is a stop and a start
of the whole system: the session ends with it, and the new system is given
an inspector again only if `.abap` breakpoints are waiting (a Run with
debugger without breakpoints is not re-attached). Once no `.abap` breakpoint is
left **and** the attach session has ended, the inspector is closed again,
so nothing stays open. Removing the last breakpoint while a request is
paused, or during a Run with debugger, leaves the session attached until it
is ended.

The door is for a program on this machine and nothing else, because opening
an inspector is running code in the process. That includes every local
user: like the other `/osd/*` doors it has no authentication, so on a
shared machine anyone who can reach the loopback port can now open the
inspector of any running system, where before only a system started with
`osd.debug` had one. It refuses a request that is
not from a loopback socket, one whose Host is not a loopback name (which a
DNS-rebound page cannot fake), and one that comes from a web page (an
`Origin`, or a `Sec-Fetch-Site` other than `none`). A POST must be
`application/json`. It answers the port, never the inspector's URL, whose
uuid is what keeps a page off its WebSocket. The first version lacked the
last three, and the critic of this change traced (by reading, not by running
a browser) how a page on the same machine could open the inspector through a
rebound name and read the URL back.

The acceptance is measured in `test/osd-child.mjs`. A system is started
the normal way with no inspector, and the door opens one on 127.0.0.1 only;
the machine's other addresses refuse the port. A CDP client (the protocol
js-debug speaks) sets a breakpoint on the gateway's URL parser, and a real
OData request pauses on it and answers 200 when resumed. Closed means the
port no longer answers. `test/osd-runtime.mjs` shows the inspector survives
a recycle and a close survives the next.

The debugger needs one serving work process: with `OSD_WORKERS>1` a
request can be served by a process nobody is attached to, so the door
refuses rather than guessing.

To have the inspector open **from the start**, which is the only way to stop
in code that runs during boot, set `OSD_INSPECT=1` in the environment VS
Code is started from. An existing `"osd.debug": true` in settings.json is
still honoured the same way, silently, for one release. Such a system keeps
its inspector: only one opened on demand is closed again.
For a packaged install, workspace ABAP is compiled through symlinks in the
extension's storage. The attach configuration maps those pack source-map URLs
back to the workspace folders, so a breakpoint in the open editor binds to
the compiled line.

ABAP Unit uses a separate inspector for each detached test child. The child
gets `--inspect=127.0.0.1:<port>` and `--enable-source-maps`. The extension
starts the attach session before requesting the detached run. The child uses
`--inspect-brk`, so it waits at entry until the debugger has installed
breakpoints; js-debug's `continueOnAttach` then resumes it. `test/vscode-debug.mjs`
exercises this ordering against a real detached run. The Test Explorer's
**Debug** profile always uses this path; its **Run** profile and F8's unit
run attach only when the inspector is asked for at start (`OSD_INSPECT=1`).

The status-bar item **Toggle ABAP breakpoints** runs VS Code's global
breakpoint activation command; it leaves the breakpoint markers in place
while temporarily disabling or reactivating them. VS Code does not expose
this global activation state to extensions, so the item does not claim an
on/off state that could disagree with the built-in toggle.

The launcher removes an inherited `OSD_INSPECT` from the system it starts,
and sets its own when the inspector is asked for at start. Ordinary test
children get no inspector flags unless the Debug profile or a debugger run
command requested one. By hand, a number is a port and `1` is Node's 9229:

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
  `OSD_WORKERS=1` for its debug launches, and `/osd/inspector` refuses to
  open one inspector for several workers. A manually started debug server
  still needs one worker.
- **A compiled binary has no inspector to open.** Bun 1.3.11's
  `node:inspector` exports `open`, and it throws "node:inspector is not yet
  implemented in Bun" (checked by hand). The door answers with that reason
  instead of pretending.
