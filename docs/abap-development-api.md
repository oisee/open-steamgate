# An ABAP development API inside OSG, and GENERATE SUBROUTINE POOL on top of it

*Design note, 2026-10-02. Nothing here is built. Backlog: [adt.md](backlog/adt.md#an-abap-development-api-and-generate-subroutine-pool-2026-10-02), **should**, 0.7 or later.*

## Why

ABAPiti, a WASM/LLVM to ABAP compiler, wants ABAP code to create CLAS, PROG, FUGR and FUNC objects at run
time. Its self-hosted compiler, `abap/wasm_compiler` running inside the system, needs `GENERATE SUBROUTINE
POOL` from milestone M2. OSG can already create, write and activate objects through ADT, so the run-time path
is built on that and not on a second generator.

M1 needs only the kernel-style refusal, which is in progress elsewhere: `GENERATE SUBROUTINE POOL` sets
sy-subrc 8, MESSAGE `GENERATE SUBROUTINE POOL is not supported`, LINE 0, NAME and WORD initial, and raises no
exception (`feat/gogen-generate-refusal` for OSGo; the JS runtime gets the same refusal). The pinned
transpiler still emits `throw new Error("GenerateSubroutine, not supported, transpiler")`.

## What exists

- **The store.** `ObjectStore` creates (`create` in `tools/osd-store.mjs`), writes (`write`), deletes (`delete`) and
  checks activation over the object and its dependents (`activate`, `dependents`). Only
  CLAS, INTF, PROG, INCL, DDLS and DEVC are creatable (`tools/osd-store-create.mjs:22-75`); FUGR has no
  source (`tools/osd-store-types.mjs:13`).
- **The inactive set (#460).** A write marks the object inactive (`#markInactive`, `osd-store.mjs`).
  Every build reads the last active copy from `build/inactive/active/` (`overlay`). A failed
  activation stays inactive and breaks nothing. `completeActivations` promotes only the revision
  that was checked and built.
- **`$TMP` (#463).** `$TMP` is a permanent local package in `local/tmp` (`tools/osd-tmp.mjs:33-36`). Its
  authors are kept in `tadir.json` (`noteAuthor`, `tools/osd-store-tmp.mjs:131`). It is a build layer when
  it exists, and `forPublishing` (`osd-tmp.mjs:181`) leaves it out of every published build. Names must
  match `OBJECT_NAME` (`osd-tmp.mjs:228`), so `%` is refused.
- **Publish.** `publish()` (`osd-store.mjs`) runs one activation at a time per store. It transpiles,
  then hot-swaps a warm build into the serving process or recycles that process (`#publish`).
- **Warm.** A content edit of an existing class or interface is warm (`warmRule`, `tools/osd-warm.mjs:91`);
  a new or removed file is cold (`:74-76`; `docs/warm-compile.md`, "What is warm, and what is cold"). Since
  #466 (merged) the registry is primed from the build view (`docs/warm-compile.md`, "The build view, with
  objects inactive"), so an activation of a set S is a warm edit. Until generators read that view, any
  inactive generator input forces cold.
  `verify()` compares each warm generation with a cold transpile. The swap runs under the work-process lock
  (`tools/osd-serve.mjs:389`).
- **WAIT.** `WAIT` commits, rolls out (snapshots the ICF shim's static server), releases the FIFO lock and
  takes it back afterwards (`tools/osd-dialog-step.mjs:239-345`, #438). Session memory stays where it is.
- **ZOSD_STORE ACTIVATE.** It already awaits `publish()` inside the calling step
  (`tools/osd-store-destination.mjs:399`). It says so when the process serving the screen keeps its old code
  (`:414`).
- **The ABAP ADT façade.** It lives in `src/adt/`: `ZCL_OSD_ADT_HANDLER`, `_ROUTER`, `_HOST` (the one host
  seam, `ZOSD_STORE DESTINATION 'STORE'`), `_LOCK` (`ENQUEUE_EZOSD_ADT_OBJ`, `zcl_osd_adt_lock.clas.abap:199`),
  `_SESSION` and `ZCX_OSD_ADT`. Port-map section 3 adds the store commands CREATE, DELETE and OBJECT, and
  extends ACTIVATE (`docs/adt-abap-port/port-map.md:262-290`). Port-map risk 2 (`:537-541`) already says that
  a swap or recycle happens after the response, never during it.
- **Slice 3, option B** (`docs/adt-abap-port/slice-3-front.md:107-129`). On `feat/adt-front-up` (**not merged**,
  in progress) a HOST verdict carries `ZIF_OSD_ADT_ROUTE=>TY_CONTINUATION` (kind, JSON payload). Node runs the
  handler registered with `registerContinuation(kind, handler)` (`tools/adt-abap-front.mjs`) after the step,
  outside the lock. stoker's 4b design (**not merged**, not yet in a tracked file) uses this: ABAP gives the
  activation verdict, and the host publishes after the step. P3 depends on both.
- **The kernel oracle** (PR #467, `test/fixtures/kernel-oracle`, P7). A good pool returns subrc 0, NAME
  `%_T002O3` (generated, different on every run), and `PERFORM f IN PROGRAM (name)` works. A semantic error
  returns subrc 4 with MESSAGE `Field "UNDEFINED_X" is unknown.`, LINE 3 and WORD `UNDEFINED_X`. A syntax
  error returns subrc 4, LINE 2 and WORD `SYS$$INCOMPLETE$$`. There is no exception in any case.

## 1. The API surface

`ZCL_OSD_DEVELOPMENT` is the layer below the ADT routes, not beside them. Group A's write path (stoker's)
puts its logic here, and the ADT routes become XML adapters over it. One implementation serves both the API
and ADT.

```
create( type name package description source )      -> name
write( type name source include )                   -> revision
activate( objects )                                  -> result: active, live, messages[]
delete( type name )
object( type name )                                  -> exists, package, author, version (active/inactive)
lock( type name ) / unlock( type name )              -> through ZCL_OSD_ADT_LOCK, ENQUEUE_EZOSD_ADT_OBJ
```

- **Types.** CLAS, INTF and PROG come first, because they are already creatable. FUGR and FUNC need a
  `CREATABLE` entry (the `.fugr.xml` header plus includes) and are always cold, because
  `osd-fm-registry` reads them (`GENERATORS_READ`, `osd-warm.mjs:77`).
- **Errors.** `ZCX_OSD_DEVELOPMENT` carries a table of messages (object, include, line, column, severity,
  text, word), shaped like ADT's activation messages, and maps the store's errors the way `ZCX_OSD_ADT`
  does: NotFound, ReadOnly, Conflict, NotSupported, InvalidName.
- **Packages.** A package must be named, as `create` requires today (its package check in `create`, `osd-store.mjs`). The default is
  `$TMP`. A library package is ReadOnly. There is no CTS (`backlog/adt.md`, A.8), so no transport is asked.
- **Author.** The author is `sy-uname`, recorded through `noteAuthor`.
- **Locks.** The API uses the ADT lock, so the API and an open Eclipse editor cannot both write one object.
  The lock owner is the caller's ENQ session. A.11 (INCL and PROG are two locks for one file) applies here too.
- **RFC-enabled function modules** (`ZOSD_DEV_CREATE` and so on) wrap the class for callers outside ABAP,
  and only if a caller needs them. ADT already serves those callers.
- **Store writes are not part of the LUW.** A step that dumps after `write` leaves an inactive version,
  which #460 makes harmless.

## 2. The step boundary

A publish transpiles, then swaps or recycles. It cannot finish inside the step that asked for it: a
recycle ends the process the step runs in, and a swap needs the lock the step holds.

- **(a) Roll-out, like WAIT.** The step commits, rolls out and releases the lock. The host builds, and the
  step rolls back in. What survives: the session's memory, its stack frames and its references, because the
  roll-out leaves memory in place. What does not survive: a recycle, which kills the step, so under (a) a
  publish may swap but must never recycle. A swap during the roll-out reaches later `abap.Classes` lookups.
  Frames already on the stack keep the old functions, so the caller's own class, if it is swapped, runs mixed
  versions within one step.
- **(b) Asynchronous.** `activate` returns a ticket, and completion arrives by callback or AMC. This is
  honest about time, but every caller needs a second entry point, and `GENERATE` cannot be written this way,
  because the statement is synchronous.
- **(c) Write now, activate after the step,** through a continuation: front-up's registry for ADT, and an
  "after the step" queue in `osd-dialog-step.mjs` for every other entry (jobs, APC, OData). That queue is a
  sibling of `onStepLuwEnd` (`:126`). The rule belongs to the step module, as the dialog-step rule already
  does.

**Recommendation: (c) for anything already loaded, and (a) only for objects nobody has loaded yet.** An
edit of a loaded object is published after the step, which is stoker's 4b. This matches a system, where a
running internal session keeps the load it has and activation gives the new load to the next session
(`docs/warm-compile.md:188-192`). A new object with no dependents (section 3) has nothing to replace. It can be
built while the step is rolled out and loaded into the serving process once the step rolls back in,
without a swap or a recycle. `activate` answers `live = abap_true` only in that case, and otherwise says
"active, live after this step", as `ZOSD_STORE` ACTIVATE already does. (b) is left to HTTP clients that
want a job id (the port-map's JOB command).

## 3. Speed: the fast path for a new standalone object

A new object is a cold build today, which takes 30 to 350 s (measured by vsp-i7's abapGit spike on 0.6.1504,
vibing-steampunk report 2026-10-02-003) and ends in a recycle. The fast path builds the
new object alone with the warm compiler's registry (`only: [object]`, transpiler #1900) and loads its module
with `import()`. Nothing that is already loaded is replaced. It is safe only when all of these hold:

1. **New.** The object has no module in the live generation and no active copy.
2. **No dependents.** `dependents()` is empty, so nothing in the tree names it. Otherwise a dependent's
   module changes, which is a warm edit at best.
3. **Not a generator input.** It is not read by any entry in `GENERATORS_READ`: no AMDP, no SUBMIT, no
   transaction `INTERFACES`, no FUGR. A PROG under a layer is read by `osd-gui-convert` and
   `osd-tran-registry`, so a PROG in `$TMP` stays cold until the warm rule gains a "new file" case, proved per
   generator.
4. **A name nobody else uses,** and no `@KERNEL` lines (section 6).
5. **A primed registry.** Without `OSD_WARM` or the transpiler fixes there is no fast path.

The verifier does not see a module that is outside a generation. A fast-path module is therefore checked on
its own: a cold transpile of the same source in the verify child, compared byte for byte. #1899 makes the
numbering per object. Until the check passes, the object is reported `warm-unverified`. A repository object
built on the fast path still enters the next cold build, and from then on it is an ordinary module.

## 4. GENERATE SUBROUTINE POOL

- **Not a `$TMP` object.** A pool is not a repository object on a real system, so here it is not a store
  object either. If it were one in `$TMP`, every pool would become a build input, change the generation hash
  and force the next build cold, and the dev-only rule would apply to it, which it must not (section 5).
  Instead the source goes to a transient area (`build/pools/`, outside the layer list), keyed by a hash of
  the source.
- **The path.** It uses the same check and the same `only` transpile as the fast path, against the live
  registry. A cache hit (the same source generated again; how common that is, UNMEASURED) costs nothing.
- **NAME.** The kernel's shape: `%_T` plus five characters, unique per process. The forms register as
  `abap.Forms['PROG-%_Txxxxx-<FORM>']`, which is what `PERFORM ... IN PROGRAM (name)` looks up at call time
  (transpiler `perform.js`). A gap to fix first: that branch passes only CHANGING parameters, while the
  oracle's `USING 21` needs USING passed as well.
- **Errors.** The first issue gives sy-subrc 4, LINE (the issue row) and WORD (the token at the issue start).
  A parser error gives WORD `SYS$$INCOMPLETE$$`. MESSAGE is abaplint's text, not the kernel's. The tests
  compare subrc, LINE and WORD, and MESSAGE only for the few messages mapped. Anything else (no registry,
  limits) gives the M1 refusal, subrc 8.
- **Lifetime.** A pool lives for the internal session: the step for a stateless request, and the session
  token for a stateful one (ADT, APC, webgui). At the end its `abap.Forms` entries are removed. An ES module
  cannot be unloaded, so pools count toward the catch-up recycle's heap limit (`OSD_WARM_HEAP_MB`), and there
  is a cap per session and per process (the kernel's limit is to be measured).
- **Browser preview.** It has no transpiler and no `fs`, so it keeps the refusal. OSGo keeps it too.

## 5. Development systems only

The API writes only in a development system or client, and otherwise it refuses with `NotSupported`. The
signal is **UNMEASURED**. The candidates are `T000-CCCATEGORY`, `T000-CCCORACTIV` and
`T000-CCNOCLIIND` (repository changes per client), plus the system change option. OSG keeps its own client
row and sets it to development by default. A published build (`forPublishing`: preview, VSIX seed, Docker)
is not a development system. The decision recorded on 2026-09-29 says the same: an on-system design-time
runtime writes only in development and elsewhere only reads or checks.

`GENERATE SUBROUTINE POOL` is the exception. On a real system it works in every client, because a pool is
temporary and not a repository object. It therefore bypasses the gate here as well, which is one more reason
it does not go through `$TMP`.

## 6. Security

The system is open by design: any logon is accepted, and only the loopback bind keeps it local (`OSD_BIND`,
`tools/osd-bind.mjs`; `backlog/adt.md`, "Logon"). An HTTP client that reaches the port can already write and
activate through ADT, so the API gives such a client nothing new. The new risks are these:

- **`@KERNEL` is raw JavaScript.** Any generated or API-written source can contain it and run with full Node
  privileges. Generated pools always refuse it. API writes refuse it unless the system is a development
  system and the caller opts in.
- **Injection.** `GENERATE` over strings built from request input is code injection, as on a real system.
  This is the caller's responsibility, but every pool is logged (author, hash, size).
- **Exhaustion.** A `GENERATE` loop costs heap, CPU and disk: the cache, the cap, a size limit and the
  recycle limits answer it.
- **A non-loopback bind.** When `OSD_BIND` is not loopback, API writes are refused until checked credentials
  exist. GENERATE stays allowed.

## 7. Phases

| # | what | size | depends on |
|---|---|---|---|
| P0 | A4H probes (below) | S | none |
| P1 | M1 refusal, JS and Go | S | in progress |
| P2 | `ZCL_OSD_DEVELOPMENT` over CREATE, WRITE, DELETE, OBJECT and ACTIVATE (verdict only), `ZCX_OSD_DEVELOPMENT`, ENQ, the dev-only gate; ADT group A routes moved onto it | M | slice 3 adapter, group A host commands |
| P3 | publish after the step: a `publish` continuation (front-up) and the after-step queue in `osd-dialog-step` | M | slice 3 B and the continuation registry (`feat/adt-front-up`), 4b; neither merged |
| P4 | fast path for a new standalone object, with its own verify | M | transpiler #1899, #1900 and #1921 on npm or linked |
| P5 | GENERATE: kernel hook, pool area, cache, error mapping, lifetime, PERFORM USING fix | M | P0, P4 |
| P6 | FUGR and FUNC creation (always cold, after the step) | M | P2, P3 |

**Measure on A4H first (P0),** with throwaway ABAP Unit probes in `$ZOSG_TMP`:

- T000 fields and the system change option for the sandbox clients;
- whether GENERATE works in a client marked production;
- the name pattern and the pool limit per internal session, and what happens past it;
- LINE with leading comments and with `INCLUDE`;
- WORD for other error kinds;
- `PERFORM ... USING` into a pool;
- whether a pool is visible after `SUBMIT ... AND RETURN` or in a new internal session.

## 8. Questions, decided by Alice (2026-10-02)

1. ~~Pools outside `$TMP` or in `$TMP`?~~ **Decided (Alice, 2026-10-02): a transient area outside `$TMP`.**
   On a system the generated pools are believed to be transient and not repository objects at all (no TADIR
   row); UNMEASURED, to be confirmed by a sandbox probe (TADIR / TRDIR after GENERATE).
2. **Decided (Alice, 2026-10-02, accepting the recommendations):** a CLAS or PROG already loaded becomes live
   after the step (option c); a NEW object nobody has loaded may be built during a WAIT-style roll-out and called
   in the same step (option a).
3. **Decided:** both signals, as on a system (`CCCATEGORY` development and `CCNOCLIIND` changes allowed); OSG's own
   client row says "development" by default. Which signal is authoritative stays UNMEASURED until probed.
4. **Decided:** `@KERNEL` in generated code is always refused.
5. **Decided:** without a primed registry GENERATE waits for a prime up to a bound (about 10 s, a chosen bound, not a measurement), then refuses
   with subrc 8; the browser preview and OSGo refuse at once.
6. **Decided:** not now; ADT covers callers outside ABAP. RFC-enabled modules when a caller needs them.
7. **Decided:** yes; subrc, LINE and WORD follow the kernel, the MESSAGE text is abaplint's.
