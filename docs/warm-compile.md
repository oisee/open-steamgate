# The warm compile: a save in half a second

*Measured 2026-09-25 on one 16-core x86-64 workstation (i7-10700K), Node 26
and the Bun 1.4.2 binary, on this tree (1728 objects, 976 source files,
5107 hashed inputs).*

A save of a class used to reach the running system in about 18 seconds:
the parent's check (3.1 s, a reparse of the tree), the cold build (11.3 s,
twelve generators and a transpile of every object) and a recycle of the
serving process (3.0 s, most of it the start-up's own checks). With
`OSD_WARM=1` it is under half a second:

| the save | before | warm, Node | warm, Bun binary |
| --- | --- | --- | --- |
| a class a few objects read (the demo DPC, 3 objects rebuilt) | ~18 s | **455–504 ms, median 463** | 540–568 ms, median 550 |
| an interface 141 objects read (`ZIF_STG_CDS_SOURCE`) | ~19 s | **1.94–2.07 s** | not measured |

The time is from the write of the file to the first OData answer that
carries the change (the class) or to the dev loop's own line (the
interface), five runs each, through the real dev loop (`STG_DEV=1
OSD_WARM=1`). Of the 463 ms, the build is ~410 ms (~290 of it the
transpile of the three objects) and the swap is 4 ms; the rest is the file
watcher and a 30 ms debounce.

## How it works

1. **The registry is kept.** `tools/osd-warm.mjs` holds the abaplint
   registry of the live generation for as long as the process lives. It is
   primed once, in the background, after the runtime is up (8–9 s), and the
   prime checks its premise rather than assuming it: a full run of the kept
   registry must give the live generation's files byte for byte.
2. **A save builds what it reaches.** The changed file replaces its copy in
   the registry, and the transpiler builds the edited objects and,
   transitively, their readers, taken from abaplint's scope references
   (`only`). This needs three transpiler changes, all offered upstream under
   [abaplint/transpiler#1898](https://github.com/abaplint/transpiler/issues/1898):
   [#1899](https://github.com/abaplint/transpiler/pull/1899) (temporary names
   numbered per object), [#1900](https://github.com/abaplint/transpiler/pull/1900)
   (`only`) and [#1921](https://github.com/abaplint/transpiler/pull/1921) (a
   second run with `only` checks the chosen objects, not the registry).
   `probe()` tries them on two classes at start; without them the warm path
   says which is missing and every build stays cold.
3. **The generation is an ordinary one.** Hard links to the live
   generation's files (2529 files, 24 ms), the rebuilt modules and the
   scripts written over them, the manifest a cold build would write, named by
   the same hash of the inputs, switched to by the same rename. The input
   hash is per-file digests kept by stat, and the libraries' walk is kept
   while a watcher on each hears nothing: 155 ms became a few.
4. **The serving process takes the modules.** `tools/osd-hot.mjs` loads them
   under the work-process lock, between two dialog steps. A transpiled module
   registers its class itself (`abap.Classes['ZCL_X'] = zcl_x`) and runs its
   class constructor when evaluated, and everything else reaches a class
   through that table at call time; the only bindings a module holds are its
   static imports, and each rebuilt module's imports are rewritten to the
   instance the process already has. The copies go to
   `build/hot/<generation>/`, file URLs with `?swap=N`, so stack traces and
   source maps read as files and a generation swapped back to is evaluated
   again.

## What is warm, and what is cold

The generators read the tree too, and a change one of them would see has to
reach them. Read off each of them (`GENERATORS_READ`, pinned by
`test/warm.mjs` so a new generator makes somebody read this again), an edit
is warm when it is a **content edit of an existing class or interface**
outside `gen/`, **with no AMDP body** before or after (amdp-gen reads those),
**the same `INTERFACES` lines** (osd-tran-registry reads them), and for an
interface, **no AMDP class naming it** (amdp-gen reads interfaces as type
sources). A new or removed file, DDIC, CDS, SICF, IWSV, a YAML, a library,
the config, a page or a generator is the cold build, after which the
registry is primed again.

## The checks, and why each exists

- **The importer check.** A module a warm build does not replace keeps its
  binding to the old instance of anything it imported. So before a swap,
  every module that statically imports a rebuilt one must be rebuilt too;
  otherwise the build is refused as not warm. The scope references are the
  plan; this is the check on it.
- **The comparison with a cold transpile.** After a warm build, a child
  process transpiles the same inputs cold into a scratch folder and compares
  the output byte for byte (`osd-warm.mjs verify`). Until it has passed, the
  generation answers `X-OSD-Generation: <hash> warm-unverified`, and
  `<hash>.warm.json` beside it says so -- a process started later on it says
  so too, and a cold build never takes it as a cache hit: it builds it again
  and replaces it if the bytes differ. A difference found by the comparison
  rebuilds cold and recycles. Measured: 2529 files, 0 differing, 8.5 s in
  the background. A tree that changed while it ran is `inconclusive`, not a
  pass. **It runs no generators**: it compares the transpile of today's
  `gen/`, so it checks the warm build and not the rule of what is warm; a
  generator reading something the rule lets through would go unseen by it
  until the next cold build.
- **One lock, one read.** The build lock is held from the first read of the
  tree to the switch, and a file is read once: its bytes are hashed against
  the digest the generation is named by, and a save that lands in between is
  refused rather than named wrongly. What the compiler knows of the tree
  changes only once the new generation is live; an edit the transpiler
  refuses stays in the registry and is built with the save that fixes it,
  and any other failure drops the registry.
- **What the process holds itself.** `osd-serve.mjs` imports a few modules
  (the ICF shim, the APC host, the registries, the status writer) and keeps
  them: a build that rebuilds one of those is recycled, not swapped
  (`HOST_HELD`, kept equal to its imports by a test). The gateway's model
  cache (`zcl_stg_model_info`) is cleared after every swap, so an edited
  `_MPC_EXT` is read again.
- **The catch-up recycle.** Every swap leaves its old module instances in
  the module map, and the start-up's own work (the init script's rows, the
  cross-reference) is only done by a start. After 25 swaps, a heap 512 MB
  larger than at the first swap, or a minute without a save
  (`OSD_WARM_SWAPS`, `OSD_WARM_HEAP_MB`, `OSD_WARM_QUIET_MS`), the process
  is replaced by one started on the live generation, and `build/hot/` goes.

## What a swap means, compared with a system

The next dialog step that uses the class gets the new one, with its class
constructor run again for it, as activation gives a new load to new
sessions; an object created before the swap keeps the code it was created
with, as a running session does. One difference is written down as
`NOTE-2026-09-25-warm-swap-class-constructor`: a system runs the class
constructor at the first access, and a swap runs it at once.

## Running it

```
OSD_WARM=1 STG_DEV=1 npm start          # or: OSD_WARM=1 STG_DEV=1 build/osd up
```

With the pinned transpiler the log says `warm: builds stay cold: the
transpiler has no \`only\` option (abaplint/transpiler#1900)`. To try it before
those land, link a transpiler built from the pin plus the four branches
(`node tools/osd-link.mjs transpiler packages/transpiler` in a clone with
them cherry-picked).

## Not yet

- **The cross-reference after a swap** stays at the generation the process
  started on until the catch-up recycle: where-used over a class edited
  since reads the old rows. Incremental over the closure is the follow-up.
- **The dev loop's cold path** still reparses the tree three times (the
  parent's check, the build, the child's cross-reference seed; foreman-dell's
  measurement) and runs every generator on every save. The warm path skips
  all of it; the cold path is unchanged.
- **The prime blocks the process that holds the store** for its 8–9 s:
  after the runtime is up, and again five seconds after the last cold build
  (a new file, DDIC, CDS, a YAML), since a cold build is a new start for the
  registry. A worker thread would take it off that process.
- **The init script's rows** (`reposrc`, `tadir`) stay at the text the
  process started with until the catch-up recycle, like the
  cross-reference.
- **A cold build in the dev loop is not reproducible** on the pinned
  transpiler (`ANOMALY-2026-09-25-in-process-numbering`), because it runs a
  second transpile in one process; #1899 is the fix.
