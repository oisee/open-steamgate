# Handover: SP4, the Bun binary, paused mid-spike (2026-09-16 evening)

Written so that the work resumes from any machine without the session. Read
with `docs/bun-spike.md` (parts one and two), `docs/bun-spike-vendoring.md`
(Astra's four gates) and the SP4 row of `docs/plan-spikes-and-sprints.md`.

## Where the tree is

- `main`, last commits: `7d3210d` N3 (the transpile as a library call),
  `6da5710` E.1 (layers). Both pushed. SP4 is committed after this file as
  a WIP commit: Node suites pass with it, the binary does not run yet.
- Done today: E.1, N3, the cleanup (`local/abapgit`, `local/cpm`,
  `local/vivid-vibes` → `.local/trash/2026-09-16/`; `gen/segw-editor`
  removed; `build/` collected). Backlog B.9 and B.10 hold Astra's two gaps.
- The lab instance on 3030 (SID OSF, file database `.local/db/osd.sqlite`)
  and `osd-up -attach` on 3301/3201 were left running; `scripts/osd-restart.sh
  3030` restarts the façade with the env the note in the session used
  (`OSD_LOCAL_PACKAGES='$ZOSD_TEST' STG_ADT_SID=OSF STG_ADT_DUMP=…`).
- Alice's own uncommitted files were not touched: `tools/osd-tls-proxy.mjs`,
  `scripts/osd-restart.sh`, `src/zosd_test/src/zosd_test_demo_inc.prog.abap`,
  `docs/adt-facade-shift-right.md`, `docs/diag-picture-control.md`,
  `docs/bun-spike-vendoring.md` (Astra's).
- The linked transpiler library in the monorepo (`~/dev/transpiler`) was
  rebuilt without its incremental cache (its `build/src` was 2.5 h older
  than the CLI bundle). **The linked runtime is in the same state** (three
  sources newer than `packages/runtime/build`): Alice's call whether to
  `rm build/tsconfig.tsbuildinfo && npx tsc` there.

## What SP4 has measured so far (all with Bun 1.4.2, Linux x64)

Gate 2 in isolation (scratchpad, a 0.5 MB payload binary of 82 MB):

| question | answer |
| --- | --- |
| a compiled binary loads an external module generated after it | **yes**, by `import(pathToFileURL(...))` |
| that module's bare `import "@abaplint/runtime"` | resolved by a **runtime plugin `build.module("@abaplint/runtime", …)`** returning the binary's own module (`loader: "object"`); the generated code and the host then share ONE runtime object (`mod.runtimeRef === runtime.ABAP` true) |
| `Bun.plugin` `onResolve` for a bare specifier | **not invoked** at all (relative and absolute specifiers are); `build.module` is the API for bare names |
| a `node_modules/@abaplint/runtime` beside the generation | **not found by the compiled binary**, even right beside the module (Node and interpreted `bun --no-install` find it). Compiled executables do not resolve packages from external files' node_modules |
| interpreted `bun x.mjs` without node_modules | "works" only because Bun **auto-installs from `~/.bun/install/cache`** — a false green; use `--no-install` when measuring |
| the relative `import("../test/setup.mjs")` the transpiler writes into `init.mjs` | intercepted by `onResolve({filter: /\/test\/setup\.mjs$/})` → a namespace whose `onLoad` returns the bundled `test/setup.mjs` |
| node builtins (`crypto`, `zlib`, …) from the external module | fine |
| a `%23iwbep%23…clas.mjs` file name, edited after the build | loads, new content observed |
| inside the binary | `import.meta.url` is `file:///$bunfs/root/<binary>` for EVERY bundled module, `process.execPath` is the binary, `process.argv` = `["bun", "/$bunfs/root/<binary>", …args]`, `Bun.embeddedFiles` empty unless files are imported `with {type: "file"}` |
| bundling the whole workbench (`test/run.mjs`) | `Bun.build({compile})` succeeds, 86–89 MB, ~300 ms |

Bare imports the generated code makes (measured over the live generation):
only `@abaplint/runtime` (in `_top.mjs` and `init.mjs`, both written by our
`outputFiles`), node builtins, and `../test/setup.mjs`. Per-object modules use
the `abap` global. So the plugin above covers everything.

## What was built for the real binary (WIP commit)

- `tools/osd-host.mjs`: `compiled` (Bun + bunfs URL), `toolCommand(script,
  args)` → `<binary> gen <name> …` when compiled, `serveCommand(child)` →
  `<binary> serve`, `unitCommand(script, args)` → `<binary> unit …`;
  `setHostModules/hostModules` for the bundled transpiler + core.
- `bin/osd.mjs`: modes `up | serve | build | gen <tool> | unit …`;
  registers the Bun runtime plugin (runtime by name, setup by path); sets
  `process.argv[1] = "osd-host"` before importing anything, because the
  five `import.meta.url.endsWith(argv[1])` guards (osd-transpiler,
  osd-unit, osd-runtime, osd-data, osd-build) would otherwise all fire on
  import inside one bunfs URL; `gen` sets `argv[1] = <tool name>` so that
  tool's guard fires on purpose (generators are a static import map).
- `scripts/build-binary.mjs` (`bun scripts/build-binary.mjs [outfile]`,
  default `build/osd`): one `@abaplint/core` for the transpiler and the
  entry (aliased by plugin, else two copies and `instanceof` fails);
  `@duckdb/node-api` replaced by a stub module (a compiled bundle evaluates
  every import at start, `external` does not help).
- Patched: `osd-runtime` (default command via host), `osd-build`
  (generators via `toolCommand`, `main` exported), `osd-unit` (detached
  run via `unitCommand`, `main` exported), `osd-transpile`
  (`hostModules()` before `modulesOf`), `test/start.mjs` (`webapp` from the
  tree, not from the module URL). Node suites: osd-runtime, osd-build,
  osd-unit, osd-child = 26 passing after the patches.

## Where it stopped: the current failure, and the fix

`build/osd up` on 3099 starts, listens, and every request answers an HTML
error: `Cannot find module '@abaplint/transpiler' … Require stack:
…/transpiler/packages/cli/build/config.js`. Cause: `loadConfig(root)` in
`tools/osd-build.mjs` still loads `abap_transpile.json` through the CLI's
`TranspilerConfig.find`, resolved from the tree's node_modules — which
reaches the checkout's linked CLI from inside the binary and drags its
requires along. **Fix first:** read the JSON ourselves in `loadConfig`
(the CLI's loader only parses the file and applies defaults —
`input_folder: "src"`, `output_folder: "output"`, `write_unit_tests`,
`write_source_map`, `options`; see
`node_modules/@abaplint/transpiler-cli/build/config.js` lines 41–70), which
also removes the last use of the CLI from the build path. Then `bun
scripts/build-binary.mjs` and re-run the sequence below.

## The sequence to run next (gates 2 and 3 on the real workbench)

```
bun scripts/build-binary.mjs
STG_PORT=3099 STG_DB_PATH=.local/db/sp4.sqlite STG_DEV=1 STG_ADT_SID=OSB build/osd up
curl http://127.0.0.1:3099/sap/bc/adt/core/http/build      # three names + synchronized
curl http://127.0.0.1:3099/sap/bc/adt/discovery
curl -D- 'http://127.0.0.1:3099/sap/opu/odata/sap/ZOSD_TEST_SRV/$metadata'   # X-OSD-Generation
# edit: append a comment to src/zosd_test/src/zcl_zosd_test_dpc_ext.clas.abap
# expect in the log: 1 file changed → check → built <hash> → recycled; the header changes
build/osd unit CLAS ZCL_ZOSD_TEST_DEMO --json                # unit mode, own runtime
```
Use a database path of its own (3030 holds `.local/db/osd.sqlite`), and an
SID of its own so Eclipse does not reuse 3030's cache.

Expected next walls, in order of likelihood:
1. `sql.js` inside the binary when `STG_DB` is not `file` (the unit run, the
   in-memory path): sql.js loads its wasm from a path beside its own module,
   which does not exist in bunfs. `STG_DB=file` uses Bun's `node:sqlite`
   (present in 1.4.2: `DatabaseSync`) and avoids it. Detached unit runs
   already use `STG_DB=file`.
2. `tools/stg-compile.mjs` reads `src/segw/segw-tables.json` relative to its
   module URL (`fieldsOf`, line ~613): from bunfs that file does not exist.
   Tree-relative (`join(root, "src/segw/segw-tables.json")`) works while the
   workspace is the checkout; a clean workspace is the E.2 question.
3. `tools/osd-transpiler.mjs` `createRequire(import.meta.url)` at import
   with a bunfs URL — may throw; guard it or drop it.
4. `tools/adt-facade.mjs` `facadeBuildStamp` hashes its own source files
   by module path — from bunfs they are absent; it catches and moves on,
   but the stamp is then empty. Give the binary a stamp of its own.
5. `osd gen <tool>` in the builder: cds2ddic runs `main()` on import
   (fine), the three regex-guarded tools run on `argv[1] = name`; the
   generator subprocess is `<binary> gen …` — untested.
6. The generation hash does not know who built it; a generation built by
   the binary and one built by Node have the same name for the same
   inputs. Harmless while both write the same bytes; add a host salt if
   they ever diverge.

Gate 4 (a clean directory, no checkout, no network) is NOT reachable
before E.2: `src/` (the gateway, SADL, SEGW as ABAP), `webapp/`, `data/`
and `test/setup.mjs` are OSD's content, not the workspace's, and a binary
has to bring them as a pack. Record that as the boundary rather than
testing around it.

## Decision rule (from the plan and Astra's doc)

SP4 answers 0.1 "Bun packaging: yes / no". Yes if gates 2 and 3 pass on
the checkout as workspace with the walls above closed; otherwise the
smallest failure is recorded in `docs/bun-spike.md` part three and the
fallback is the executable plus a versioned support directory (Astra's
"intermediate product"), and track D starts.
