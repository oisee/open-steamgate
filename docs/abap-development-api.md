# An ABAP development API inside OSG, and GENERATE SUBROUTINE POOL on top of it

*Design note, 2026-10-02; PIA integration plan updated 2026-10-05. The shared development class remains planned; P2a/P3a/P3b STORE commands described in section 2.1 are implemented on this branch. Backlog: [adt.md](backlog/adt.md#an-abap-development-api-and-generate-subroutine-pool-2026-10-02), **should**, 0.7 or later.*

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
- **ZOSD_STORE ACTIVATE.** `tools/osd-store-destination.mjs` checks activation and publishes directly
  unless the calling context supplies `deferActivate`. With that binding it schedules publication after
  the step and returns `EV_ACTIVE = X`, `EV_LIVE` initial, and the note "live after the step".
  That verdict is not confirmation that a subsequent test sees the new generation.
- **The ABAP ADT façade.** It lives in `src/adt/`: `ZCL_OSD_ADT_HANDLER`, `_ROUTER`, `_HOST` (the one host
  seam, `ZOSD_STORE DESTINATION 'STORE'`), `_LOCK` (`ENQUEUE_EZOSD_ADT_OBJ`, `zcl_osd_adt_lock.clas.abap:199`),
  `_SESSION` and `ZCX_OSD_ADT`. OBJECT is exposed through STORE; CREATE and DELETE now appear in the local destination COMMANDS list through P2a below;
  this delivery is not merged, and the public development class remains planned. Port-map risk 2 (`:537-541`) already says that
  a swap or recycle happens after the response, never during it.
- **Slice 3, option B** (`docs/adt-abap-port/slice-3-front.md`). The continuation registry exists in
  `tools/adt-abap-front.mjs`: a HOST verdict carries kind and JSON payload, host work runs outside the
  work-process lock, and `resume()` enters a fresh ABAP step. P3 can reuse this mechanism. A generic,
  queryable activation completion contract for ABAP callers and an after-step path for every entry
  (including jobs, APC and OData) still need implementation.
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

## 2.1 PIA integration contract (agreed plan, 2026-10-05)

PIA is a headless ABAP agent with a local OSG backend and an ADT backend. Its M2 needs explicit
CREATE/DELETE through STORE (W2), activation completion (W6), and a local ABAP Unit entry (W3).
The agreed order is **P2a → P3a → P3b → P4**. These are planned interfaces, not current capabilities.

### P2a: repository operations (W2)

Expose CREATE and DELETE in STORE COMMANDS and CAPABILITIES, with type/name and, for CREATE,
package/description/source. Reuse ObjectStore and the ADT lock and error rules. Direct callers must not
bypass an Eclipse editor's lock; author identity comes from the caller's session. The ABAP development
class is the common operation layer for local callers and ADT adapters, rather than a second write path.
CREATE is limited to the six existing creatable types; FUGR/FUNC remain P6.

Local P2a delivery: STORE CREATE/DELETE and their capabilities are implemented in this branch.

Every cold build, CLI transpile, server start, runtime recovery and warm prime uses the persistent
store view: an inactive object with a previous active version builds from its retained active
source in `build/inactive/active`; an object never activated is excluded entirely. Generators
read the same active view. Draft source remains in the working file and survives restart for
inactive READ and a later ACTIVATE. Failed validation, build or publication leaves that draft
inactive; a journal failure cannot make it executable on the next start. An activation build
includes only the drafts explicitly named by that publication, and its serving child loads that
generation while completion is pending.

CHECK and ACTIVATE also return JSON `{active, live, note, issues}` alongside their existing
scalar/table fields. The ABAP host wrapper imports JSON/SOURCE only; callers must inspect
`active` and `issues`, since a syntax refusal does not raise a transport exception. `active: true`
with `live: false` still does not confirm publication. P3a adds the durable operation state below.
Use IV_TYPE and IV_NAME; CREATE accepts IV_JSON `{ "package": "$TMP", "description": "..." }`
and optional IV_SOURCE. Omitted package defaults to $TMP. EV_JSON contains the ObjectStore result
or the standard error envelope. Author comes from the live ENQ session. PROG/INCL locks are both
checked, and an IPC mutation keeps the caller's lock until the parent acknowledges; a queued mutation
is cancelled when the calling session ends. CREATE rejects any source containing @KERNEL in this
local version. It cannot yet opt in. A source-owning ObjectStore is required; built-only hosts refuse.
The shared ZCL_OSD_DEVELOPMENT class, its dev-system policy and migration of ADT WRITE logic are
still planned. STORE WRITE now also returns EV_JSON `{written:true, type, name, revision}`:
the revision is the store's digest of the saved inactive object, including its class includes.
Existing scalar fields and EV_ERROR behavior are preserved; callers that omit EV_JSON keep working.

### P3a: activation completion (W6)

The shared result has `{state, op_id, generation_id}`. State vocabulary for the first implementation:

| state | meaning | may PIA run tests on the requested revision? |
|---|---|---|
| `checked` | Validation succeeded; publication has not been requested/completed | No |
| `pending` | Publication is scheduled or running; leave the calling step | No |
| `published` | The checked source revision was published and its generation is available for a new execution context | Yes, in that generation |
| `failed` | Validation, build, promotion or publication failed | No |

`op_id` identifies the activation operation, not merely the object. `generation_id` is initial until
publication is confirmed and names the published generation afterwards. Diagnostics distinguish a
validation refusal, build failure and source revision conflict. Polling completion through a local API
is sufficient for the first version; AMC notification may supplement it and is not the source of truth.
### P3a wire contract for implementation

These additions are implemented and advertised by COMMANDS/CAPABILITIES on this branch.
ACTIVATE returns the operation document in EV_JSON. Keep `active`, `live`, `note` and `issues`
for current callers, and add `state`, `op_id`, `generation_id`, `type`, `name`, `created_at`,
`updated_at`, `completed_at`, and `failure_stage`. IDs and timestamps are strings; timestamps are UTC ISO 8601.
`generation_id` and `failure_stage` are empty strings until applicable. `failure_stage` is one of
`validation`, `step`, `build`, `promotion`, `revision`, or `recovery` for a failed operation.
Issues retain the existing OBJ_TYPE/OBJ_NAME/LINE/COL/RULE/MESSAGE rows.

STORE ACTIVATE and ADT activation use `osd-publish-activation.mjs` for the same
revision capture, publication and promotion. When the warm compiler is primed,
its build validates the changed objects and their affected readers; STORE does
not reparse the full registry before that validation. The compiler's existing
eligibility rule decides whether publication builds warm or falls back cold.
Every other inactive object still builds from its last active copy, or is
excluded when it has never been active. A refused swap is followed by an awaited
runtime recycle; failure to load or promote returns `failed` with an existing
failure stage, never `published`.

On the warm path, `published` means the exact checked revision's complete
generation is available for a fresh execution context and, when a serving
runtime exists, that runtime has acknowledged loading that generation. `live`
is true for both a swap and a recycle. Existing objects and stack frames may
retain their old class instances. Publication does **not** claim equivalence
with a cold transpile before the asynchronous comparison has confirmed it.
ACTIVATE and ACTIVATION_STATUS therefore include boolean `verified`: false
for `warm-unverified`, true for a cold generation or a successful comparison.
ACTIVATION_STATUS reads this observation from the generation sidecar; it can
change without changing the historical operation state, generation ID or
timestamps. An inconclusive comparison leaves it false. A differing comparison
uses the existing forced cold rebuild/recycle recovery. The operation's other
completed fields remain immutable.

ACTIVATION_STATUS and RUN_TESTS use the same warm `generation_id`. Tests may
run on a published generation while `verified` is false: they execute its
retained modules in an isolated context, with the existing expected-generation
guard. The ADT activation response also carries the newly published ID in
`X-OSD-Generation`, suffixed with `warm-unverified` until confirmed.

The corresponding ABAP result type uses STRING for these fields, ABAP_BOOL for active/live/verified,
and ZOSD_ISSUE_T for issues. This type belongs to the planned development API; existing
ZCL_OSD_ADT_HOST=>TY_ANSWER stays a JSON/SOURCE carrier.

- **Lookup:** STORE `ACTIVATION_STATUS`, IV_JSON `{ "op_id": "..." }`. The result is the same
  operation document. It is read-only and never schedules publication. Missing/expired IDs return
  `EV_JSON {"state":"not_found","code":"NOT_FOUND","op_id":"..."}` with EV_ERROR empty,
  so ZCL_OSD_ADT_HOST=>STORE returns the refusal without raising. Malformed requests retain
  the standard INVALID_NAME envelope and exception.
- **Ownership:** the source-owning host creates and records the operation before returning pending.
  Its journal lives outside generated modules and outside the serving child. Serving-child recycle
  preserves the journal. Journals are scoped by source root and HTTP instance port, with a single
  source-host owner; another live owner for the same root/port is refused. Resume/lookup must address
  the same instance, and a restart must retain its port. A source-host restart conservatively fails unfinished entries with
  `failure_stage: recovery`; it must not infer publication from a build directory alone.
- **Retention:** keep completed published/failed entries for at least 24 hours from completion.
  Never expire checked/pending entries during a live host's work. Cleanup is lazy on journal access;
  no entry is evicted early merely to satisfy a count limit. After expiry, NOT_FOUND means the caller
  must reconcile its checkpoint and the active object; it does not mean activation succeeded.
- **Completion:** published requires promotion of the exact checked revision and confirmation that
  its generation is available to a new execution context. A changed source, dumped calling step,
  failed build, failed promotion or lost unfinished work produces failed with diagnostics.

Repeated lookup is idempotent. A repeated ACTIVATE is a new operation, rather than a lookup;
PIA persists op_id before leaving its calling step and uses ACTIVATION_STATUS after resuming.
ACTIVATE allocates an op_id even for a validation refusal: checked is its intermediate validated
state, followed by pending and then published/failed. Refusal can go directly to failed.
CHECK remains a validation-only response without a tracked operation. `completed_at` is empty
until published/failed, then immutable. The generation verification observation may change;
lookup does not change timestamps or extend retention.
Run-test readiness is determined by `state == published`, not the legacy active/live flags.
Published is historical: a later activation may replace that generation. RUN_TESTS must still
check expected_generation and refuse an unavailable generation explicitly; this contract does
not promise to keep every published generation loaded for the journal's retention period.

OSG owns operation status, the checked revision, publication and generation identification. PIA owns
persisting its checkpoint, leaving the step, and resuming in a new step. Operation status must survive
any serving-process recycle needed to finish publication. Querying the same operation must not enqueue
another activation. `published` does not mean that stack frames already running in the old generation
have changed. No serialization of PIA's call stack is promised by this API.

### P3b: local ABAP Unit (W3)

Implemented on this branch: STORE `RUN_TESTS`, callable through
`ZCL_OSD_ADT_HOST=>STORE( iv_command = \`RUN_TESTS\` iv_json = ... )` using the
same ZOSD_STORE destination and parent IPC path as other commands. No HTTP loopback.
COMMANDS and CAPABILITIES include RUN_TESTS. The response is synchronous EV_JSON,
with EV_ERROR empty for the structured states below; there is no op_id.

IV_JSON:

```json
{
  "targets": [{"type": "CLAS", "name": "ZCL_X"}],
  "expected_generation": "<id>"
}
```

`targets` is a nonempty list of repository objects, deliberately named for a future
where-used closure. This delivery supports CLAS with local test classes. PROG and other
types return `not_run` with `error.code: NOT_SUPPORTED` and a precise explanation.
Malformed requests return `not_run`/INVALID_NAME. Names and types are normalized to upper case,
and identical normalized targets execute once. Requests are capped at 50 entries before
de-duplication; exceeding the cap returns `not_run`/INVALID_INPUT with the cap in the explanation.
Omit expected_generation to use the current published generation; supplying null or an
empty string is invalid. Classes without local tests produce an empty `ran` result.

EV_JSON (optional diagnostic fields shown):

```json
{
  "state": "ran",
  "generation_id": "<generation the tests ran on>",
  "expected_generation": "<echo or null>",
  "ms": 120,
  "failure_stage": "runner|timeout (only for failed)",
  "error": {"code": "...", "text": "..."},
  "counts": {"classes": 1, "methods": 1, "pass": 0, "fail": 1, "error": 0, "skipped": 0},
  "classes": [{
    "target": {"type": "CLAS", "name": "ZCL_X"},
    "name": "LTCL_X",
    "state": "ok",
    "error": {"stage": "not_found|class_setup|setup|execution|...", "text": "..."},
    "methods": [{
      "name": "M", "verdict": "fail", "ms": 5,
      "alerts": [{
        "kind": "failedAssertion", "title": "Unit test assertion failed",
        "details": ["Expected [43]", "Actual [42]"],
        "expected": "43", "actual": "42",
        "stack": [{"type": "CLAS", "name": "ZCL_X", "include": "testclasses", "line": 12}]
      }]
    }]
  }]
}
```

- **Run state vs verdict:** `ran` means the runner completed, including red assertions.
  A red assertion is `verdict: fail`, with class state `ok`; it is never counted as an
  execution error. Non-assertion execution failures give `verdict: error`. A missing
  target or a broken class has class `state: error` and `error {stage,text}`, while the
  run continues with the other classes and targets. A missing target is represented by
  one class entry named after its target, stage `not_found`, with no methods.
  Per-target discovery/parse failures likewise produce one entry, stage `discovery`, with no methods.
  A single-class child that dies during boot without JSON produces stage `execution` and other targets continue.
  Class setup/teardown failures have their corresponding stage; method setup/teardown
  execution failures make both that method and class error; failed assertions always
  keep method verdict `fail`, including in setup/teardown. Only a runner failure uses run-level
  `failed`, with `failure_stage: runner|timeout` and `error {code,text}`.
- **Assertions:** expected/actual are optional strings from the existing ADT Unit alert
  data, including known empty strings. Stack entries use the existing source map
  resolution; unavailable locations are omitted. Counts sum method verdicts;
  class errors without methods increase `classes`, not method `error`.
- **Generation guard:** a supplied expected_generation different from the generation
  selected for a new context returns `state: not_run`, no tests execute, and
  `error {code:"GENERATION_MISMATCH", text, expected_generation, current_generation}`.
  Every refusal, including NOT_SUPPORTED and invalid targets/timeouts, carries the current
  selection in top-level generation_id when known; it is empty if no generation is known.
  expected_generation is echoed even when target validation fails. Omission echoes null and runs on the current selection.
  There is no fallback to a historical requested generation.
- **Published source only:** selection uses the source host's last confirmed publication
  checkpoint, retained with the activation journal. Before the first tracked activation,
  the baseline is the serving generation (or `build/live` on a source-only host) only when
  the store has no inactive objects; otherwise it refuses GENERATION_UNAVAILABLE. A source
  host without a serving process can publish a complete generation for a fresh detached
  context without recycling. An activation in `checked`/`pending`, or a runtime transition,
  returns `not_run`/PUBLICATION_PENDING. A mismatch between the checkpoint, `build/live`
  and the serving runtime, or missing snapshot/modules, returns
  `not_run`/GENERATION_UNAVAILABLE. Thus an unpromoted build cannot masquerade as published,
  including after a failed promotion or a restart. A short source-lock turn selects the
  generation, reads only its digest-verified retained source for discovery, and copies its
  complete modules to a disposable run directory. Inactive working source is never used.
  Subsequent activations and generation GC cannot change the copied modules in a run.
  ObjectStore promotion updates this same checkpoint for ADT activations as well as STORE.
  Recording the checkpoint is best-effort: failures log once per owner, never fail publication
  or leave a completed ticket pending, and make RUN_TESTS refuse GENERATION_UNAVAILABLE until recording succeeds.
- **Isolation:** the existing `UnitRun.runDetached` runs each local test class in a fresh
  child process and its own database/runtime, separate from the agent's LUW and static
  state. It does not acquire or nest the caller's work-process lock; synchronous STORE
  calls from ABAP dialog steps are safe. Each class continues past ordinary method errors.
- **Timeouts:** `OSD_STORE_TEST_METHOD_MS` defaults to 60000 ms per method, including
  constructor/setup/execution/teardown. The existing runner's child deadline and parent
  watchdog produce `verdict: error`, alert `kind: timeout`. A synchronous loop is killed;
  remaining methods of that child are marked skipped, and other classes continue.
  `OSD_STORE_TEST_RUN_MS` defaults to 300000 ms total, including preparation and boot;
  whole-run timeout kills the child and returns `failed`, `failure_stage: timeout`,
  `error.code: RUN_TIMEOUT`. A stuck class_setup is covered by this whole-run deadline.
  Completed class results may be retained on runner failure. Run directories and child
  database files are removed on success, error and timeout.
  Invalid timeout values return `not_run`/INVALID_INPUT.

Known limitations retained for this slice:

- P3-2: STORE plans do not apply the ADT runner's HARMLESS-write risk guard.
- P3-3: On Windows, early child rejection may leave its cwd busy and disposable-directory removal can fail.
- P3-4: Source locks are per process; external build replacement or GC can race the module copy without a modules digest.

### Joint acceptance and interim path

From ABAP: create a class, write an intentionally failing test, activate, checkpoint and leave the step,
wait for `published`, resume and obtain the failing assertion. Fix the test, repeat activation and get
a passing result. Delete the disposable object and confirm its absence. Exercise the same repository
operations through ADT to check lock, revision and error compatibility. PIA adopts this as M2 acceptance;
OSG covers this sequence through the compiled ABAP host in test/store-destination.mjs,
including a stale-generation refusal and deletion of both disposable classes.

Existing content edits already have a measured warm path: PR #618's isolated lifecycle run measured
median CLAS/INTF/INCL activation around 2.3–2.4 s, while REPORT/DDLS remained around 27 s locally.
PIA's separate live probe measured roughly 29 s for its edit/activation cycle; that observation alone
does not establish a warm-path regression without matching generation, mode and compiler readiness.
P4's new-object acceleration remains separate from the completion contract.

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

**The speed model.** The prime (11 to 17 s as measured: vsp `osd.log`, "primed 1166 files in 11029 ms") is paid
**once**: after a start, and again after a cold build. Every fast-path build after it compiles one standalone
object warm, and the target is sub-second, the cost of a warm class edit (about 0.5 to 1.5 s measured,
`docs/warm-compile.md`). **The prime is eager:** with `OSD_WARM` on it already runs in the background once the
runtime is up, and again `OSD_WARM_REPRIME_MS` (5 s) after a cold build (`warmUp` in `tools/osd-store.mjs`,
`WARM_REPRIME_MS`; `docs/warm-compile.md`, "How it works" step 1). So a GENERATE normally finds it ready, and
nothing new is needed for eagerness.

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
- **NAME.** The kernel's shape: `%_T` plus five characters, eight in all, counting up per generation
  (measured in PR #469, one increment observed: `%_T002QE`, then `%_T002QF`); here unique per process. The forms register as
  `abap.Forms['PROG-%_Txxxxx-<FORM>']`, which is what `PERFORM ... IN PROGRAM (name)` looks up at call time
  (transpiler `perform.js`). A gap to fix first: that branch passes only CHANGING parameters, while the
  oracle's `USING 21` needs USING passed as well.
- **Errors.** The first issue gives sy-subrc 4, LINE (the issue row) and WORD (the token at the issue start).
  A parser error gives WORD `SYS$$INCOMPLETE$$`. MESSAGE is abaplint's text, not the kernel's. The tests
  compare subrc, LINE and WORD, and MESSAGE only for the few messages mapped. Anything else (a prime that
  fails or goes silent) gives the M1 refusal, subrc 8.
- **Speed.** On a primed registry a GENERATE is a warm compile of one pool, with a sub-second target (section 3),
  and a cache hit costs nothing. The 11 to 17 s prime is paid once, eagerly, not per GENERATE.
- **No registry yet (rare).** GENERATE waits for the prime rolled out, with the work process released,
  through `rollOut`/`rollIn`
  (`tools/osd-dialog-step.mjs`), so other requests run meanwhile. The limit is silence, like #466's transition
  wait (`#bounded` in `tools/osd-store.mjs`): it waits while the prime reports progress and refuses with subrc 8
  only when the prime fails or says nothing for `OSD_TRANSITION_MS`; the overall bound is the boot timeout. The
  browser preview and OSGo refuse at once (decision 5, section 8).
  Today `prime()` in `tools/osd-warm.mjs` reports nothing
  until its last line (`warm: primed N files in M ms`) and blocks the process that holds the store, so the
  progress heartbeat is phase P4a.
- **Lifetime.** A pool lives for the internal session: the step for a stateless request, and the session
  token for a stateful one (ADT, APC, webgui). At the end its `abap.Forms` entries are removed. An ES module
  cannot be unloaded, so pools count toward the catch-up recycle's heap limit (`OSD_WARM_HEAP_MB`), and there
  is a cap per session and per process (the per-process cap is ours, not a kernel number). Measured on the
  sandbox (PR #469, `test/fixtures/kernel-oracle/subpool.json`):
  - a `PERFORM` into a pool after `COMMIT WORK` in the same internal session still answers, so a WAIT-style
    roll-out and roll-in, which commits, must not drop the pool's `abap.Forms` entries;
  - a second internal session (`SUBMIT ... AND RETURN`) does not see it (`PERFORM ... IN PROGRAM (name) IF FOUND`
    finds nothing);
  - in a fresh internal session 36 pools fit (`DO 36` succeeded) and the 37th GENERATE (`DO 37`) ends in the
    runtime error `GENERATE_SUBPOOL_DIR_FULL` ("Maximum number of temporary subroutine pools exceeded."),
    which is not catchable and sets no sy-subrc. Whether pools made by called programs count was not probed.

  Decision: OSG's cap per internal session is 36, and the 37th GENERATE ends the step the way a dump does
  (the dialog-step rollback), not with a subrc.
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
| P3 | publish after the step through the continuation registry and an after-step queue for other entries | M | existing slice 3 continuation mechanism; generic entry coverage remains |
| P2a | PIA W2: CREATE/DELETE through STORE, capabilities, shared operation and lock/error rules | M | existing ObjectStore and ADT session/lock mechanisms; first delivery of P2 |
| P3a | PIA W6: activation status `{state, op_id, generation_id}`, completion lookup across recycle | M | P2a; existing continuations; before P3b |
| P3b | PIA W3: local RUN_TESTS on the expected generation, isolated execution and structured verdicts | M | P3a; existing Unit runner |
| P4 | fast path for a new standalone object, with its own verify | M | transpiler #1899, #1900 and #1921 on npm or linked |
| P4a | progress heartbeats from `prime()` (none today), so a waiter can tell slow from silent | S | P4 |
| P5 | GENERATE: kernel hook, pool area, cache, error mapping, lifetime, PERFORM USING fix | M | P0, P4, P4a |
| P6 | FUGR and FUNC creation (always cold, after the step) | M | P2, P3 |

**Measure on A4H first (P0),** with throwaway ABAP Unit probes in `$ZOSG_TMP`:

- T000 fields and the system change option for the sandbox clients;
- whether GENERATE works in a client marked production;
- ~~the name pattern and the pool limit per internal session, and what happens past it~~ (measured, PR #469: see
  NAME and Lifetime in section 4);
- LINE with leading comments and with `INCLUDE`;
- WORD for other error kinds;
- `PERFORM ... USING` into a pool;
- ~~whether a pool is visible after `SUBMIT ... AND RETURN` or in a new internal session~~ (measured, PR #469: it
  is not).

## 8. Questions, decided by Alice (2026-10-02)

1. ~~Pools outside `$TMP` or in `$TMP`?~~ **Decided (Alice, 2026-10-02): a transient area outside `$TMP`.**
   On a system the generated pools are transient and not repository objects at all: measured in PR #469, a
   generated pool has no TADIR, TRDIR or REPOSRC row.
2. **Decided (Alice, 2026-10-02, accepting the recommendations):** a CLAS or PROG already loaded becomes live
   after the step (option c); a NEW object nobody has loaded may be built during a WAIT-style roll-out and called
   in the same step (option a).
3. **Decided:** both signals, as on a system (`CCCATEGORY` development and `CCNOCLIIND` changes allowed); OSG's own
   client row says "development" by default. Which signal is authoritative stays UNMEASURED until probed.
4. **Decided:** `@KERNEL` in generated code is always refused.
5. **Decided (Alice, 2026-10-02):** hot activation must be fast. The prime is eager and paid once; a GENERATE on
   a primed registry is a warm compile; the rare wait releases the work process and is silence-bound. The
   earlier 10 s cap is withdrawn (a prime takes 11 to 17 s as measured, vsp `osd.log`: "primed 1166 files in
   11029 ms", so the cap would have refused the first GENERATE after nearly every start).
6. **Decided:** not now; ADT covers callers outside ABAP. RFC-enabled modules when a caller needs them.
7. **Decided:** yes; subrc, LINE and WORD follow the kernel, the MESSAGE text is abaplint's.
