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

## The build view, with objects inactive

An ADT save makes its object inactive, and an inactive object is kept out
of every build (`ObjectStore#overlay`, #460): its last active copy from
`build/inactive/active/`, or nothing when it never had one. The registry is
primed from that view and not from the raw tree, and an activation of a set
S is a warm edit of it: S's saved sources replace their copies, every other
inactive object keeps serving its copy, before and after. A file is known by
its place in the tree, whichever copy the view reads (`#logical`), so a
promotion is a content edit and the warm rule applies to it as to any save
(a new object, `INTERFACES`, AMDP and generator inputs stay cold). A file
the view reads from elsewhere with the same bytes is rebuilt for its source
map, which names where it was read. A refused build leaves the registry on
the old view (the edit held, reverted by the next build that does not
activate it). The comparison runs a cold transpile of the same view
(`OSD_VERIFY_OVERLAY`). A prime that is due after a cold build runs at the
next activation if the five seconds have not passed, since an ADT client
saves and activates at once. A prime whose view names the live generation
differently (an object saved since, read from its copy) is accepted only on
proof that the saves since are the whole difference: the live view rebuilt
-- those objects read from the tree as live read them, each file counted
with its active copy's digest -- must hash to the live name exactly, so a
generator input (a `.stg.yaml`), a library, the config or a generator that
changed since refuses the prime and the build goes cold. A full run of the
registry cannot see those (it transpiles today's `gen/`), and neither can
the comparison. The registry then takes live's file order (a copy is listed
after the tree, and `init.mjs` loads objects in that order), and each
copied file is placed where the live source map says it was read from.

Before this every activation through ADT was cold. Measured on the stand-in
(create, two edits, delete, twice; `OSD_WARM=1 STG_DEV=1`): 110 s and 7
boots with every activation cold, then 77 s and 4 boots with both edits
warm (1.5 s each); with the proof, 103 s and 5 boots, both edits warm (the
second after a prime on demand, 18 s in all).

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
- **One activation per save, answered once it is live.** `publish()` runs
  one at a time per store, and a caller whose tree is the one already
  queued, or the one a build in flight named its generation after, takes
  that publish's answer instead of building again behind it: the dev loop
  and VS Code's activation of one disk save are one build and one swap, and
  both answers carry `X-OSD-Swap-Ms`. A build the serving process already
  runs (same generation, same process) loads nothing -- no swap, no
  recycle, sessions kept -- and says how that process got it. A catch-up
  recycle a swap brings (the swap limit, the heap) is awaited by that
  swap's activation, which then answers cold with the reason. A runtime
  changing hands is waited for while its boot keeps talking, and the
  activation fails, saying so rather than hang, once it has said nothing
  for `OSD_TRANSITION_MS` (60 s) -- silence, not slowness, as the
  runtime's own boot limit already was. A fixed 60 s had turned a boot
  that was slow and correct into a failed activation (vsp-i7, 0.6.1511: a
  boot past 60 s under load, the cross-reference alone 21.6 s).
- **A save is not an activation.** The dev loop (`STG_DEV=1`) never builds
  a file of an object that is inactive and still holds the version saved
  through the store (`ObjectStore#savedInactive`): an ADT create or save,
  whose activation is the façade's. Without this every create and PUT
  through the façade was a cold build and a recycle of its own -- 21
  recycles in vsp-i7's suite, 1.52x the cold run's wall time, and the
  activation behind them timed out -- and the build made a saved-only
  version live. The rule reads the store's persistent inactive set, not a
  record of the write: it ends with the activation, the delete, or bytes
  that differ from the saved version (`outside`, which the dev loop builds
  and activates like any other editor's change). So the same bytes again
  -- another editor, a checkout, a watcher event that comes late, a retry
  after a failed activation -- stay that inactive source until somebody
  activates it. A delete is not covered: it takes effect at once, as on a
  system, and the dev loop builds the tree without the object.
  Measured on a create, two edits and a delete, twice
  (`OSD_WARM=1 STG_DEV=1`): 290 s and 10 recycles before, 83-90 s and 2
  recycles after, both edits warm (1.3-1.5 s).
- **The prime waits for a runtime changing hands**, and a cold build stops
  a comparison of a warm generation the tree has left (it could only end
  inconclusive, and it was a second cold transpile beside the build). The
  prime blocks the process that supervises the runtime; landing in the
  middle of a recycle, it made that recycle read 17-30 s slower.

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
- **The cross-reference is still a full parse per new generation** at every
  start (~5 s alone, 21.6 s on vsp-i7 under load). `build/xref/` now keeps
  the last eight generations' rows rather than one, so a tree that goes
  back to a generation (an object created and deleted again) is a hit.
  Seeding after the runtime answers would not take the parse off the
  child's single thread, only move the stall to the first requests and
  leave where-used empty meanwhile; per-object rows keyed by the file
  digest are the follow-up.
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
