# What moves from the host into ABAP

*2026-09-23. A proposal, not a change. It assumes that the ABAP of this tree
compiles and runs fast outside the transpiler (the Go spike on
`spike/go-backend`: the whole ZO4D demo matches A4H frame for frame, Zork
plays, and all 805 classes of OSG and its libraries build into one Go binary
that registers the SEGW services and starts dispatching).*

## The line to draw

SAP draws it for us. The **kernel** is C: ICM, the dispatcher, the database
interface, the roll area, the enqueue server, the update task, the APC
framework, dynamic calls. **Everything above the kernel is ABAP**, including
most of Basis: ICF handlers, the SICF tree, the Gateway runtime, the SEGW
generator, abapGit. If OSG keeps that line, the same code runs in OSG and on
a system, and the host keeps only what a kernel does.

Today several pieces that are ABAP on a system are JavaScript here. They
exist because the transpiled runtime could not do something at the time.
They are the candidates.

## Inventory

| Today (host, JS) | On a system | Move? | Blocked by |
| --- | --- | --- | --- |
| `tools/segw-registry.mjs`: reads `*.iwsv.xml` / `*.iwmo.xml` and generates `ZCL_STG_SEGW_REGISTRY` | `/IWFND/` registration tables, ABAP | **Yes, into ABAP.** A registry class reads the IWSV/IWMO objects from the object store at start, and no generated class is needed | dynamic `CREATE OBJECT ... TYPE (name)` |
| `tools/segw-shlp.mjs`: search helps into `ZCL_STG_SHLP_REGISTRY` | DD30V/DD32P plus the F4 framework, ABAP | **Yes, into ABAP**, same shape as the SEGW registry | dynamic instantiation |
| `tools/osd-fm-registry.mjs`: a *generated typed dispatcher*, because the transpiler has no `CALL FUNCTION ... PARAMETER-TABLE` | the kernel calls a module by name | **Into the Go host, not ABAP.** `PARAMETER-TABLE` becomes a host call over a name registry, and the generator goes away | a name and signature registry for function modules |
| `tools/osd-icf-apply.mjs`: ICF nodes into `ICFSERVICE` / `ICFHANDLER` | SICF, tables plus ABAP | **Yes, into ABAP** over the same tables | nothing in principle |
| `tools/stg-compile.mjs`: YAML to SEGW objects | SEGW, an ABAP generator | **Partly.** Generation already exists in ABAP (`zcl_stg_segw_gen`, byte-identical to `tools/segw-gen.mjs` by test); the YAML front stays a developer tool | none |
| `tools/cds2ddic.mjs`, `stg-compile --all`, the build | DDL compiler, activation | **No.** Build time, not run time | none |
| `tools/osd-dialog-step.mjs`: commit at the end of a dialog step, rollback on a dump | kernel | **Into the Go host**: one implementation for every host | the Go host |
| The APC host's `ON_MESSAGE` lines in the demo stands | APC framework plus the handler's own method | **Into ABAP**: the handler's method runs as written, and the host only delivers the text | `RETURN` inside `TRY` |
| Portable AMDP `runProcedure` (JS) | HANA | **No.** It is "the database"; it moves to Go over the shared relational IR (`docs/pamdp-ir-portability.md`) | none |

## Why it is worth it

- **Fewer twins.** SEGW generation exists twice, in JS and in ABAP, and a
  test keeps the two byte-identical. Each generator that moves to ABAP is one
  pair less to keep in step.
- **One behaviour everywhere.** A registry or an ICF tree written in ABAP
  behaves the same in OSG and on a system; a JS generator only imitates it.
- **A smaller host.** The Go host keeps exactly what a kernel keeps: the
  wire, the dispatcher, the database, the LUW, dynamic calls.

## Two conditions first

1. **Dynamic calls in the runtime.** `CREATE OBJECT ... TYPE (name)`,
   `CALL METHOD (name)`, `CALL FUNCTION (name) PARAMETER-TABLE`, all through a
   generated name registry. The ABAP registries cannot work without this.
2. **Statics per session.** In one Go process, class statics are shared by
   every session. A registry in ABAP statics is fine; per-user state in
   statics is not. The first step is deciding which statics are session state
   (roll area) and which are shared, read-only caches.

Both are on the path of the next milestone anyway (the OData service document
answered by the Go binary through `ZCL_STG_DISPATCHER`), so the shift costs
little extra once that milestone is reached.

## Rules for moving (osg-i7's review)

1. **A generator that stands in for missing dynamics is fixed in the
   runtime, not rewritten in ABAP.** `osd-fm-registry.mjs` exists because
   there is no `PARAMETER-TABLE`. Once the host can do dynamic calls, it
   disappears. The ABAP registries depend on the same thing.
2. **Twins go one at a time, and the JS twin stays as the oracle.** The ABAP
   SEGW generator becomes the one that is used. The JS one moves into the
   tests and is deleted only once the ABAP side has tests of its own.
   Otherwise the one check that the ABAP generator is right is lost.
3. **Measure the cost first.** For each candidate, count what it needs from
   the runtime: dynamics, statics per session, `ASSERT 1 = 'todo'` stubs in
   open-abap-core. It is five minutes of counting, the way the pAMDP work
   was done.
4. **Hot paths are measured before they move.** A registry read once at start
   moves at no cost. Anything run on every request is timed first, on the
   transpiler runtime as well as in Go.
5. **Portable AMDP stays in the host.** It stands in for HANA, the database.
   The ABAP side keeps only the dictionary, which is already read from the
   objects.

## Order

1. The ICF apply in ABAP: nothing stands in its way.
2. The SEGW generator: ABAP becomes the one that is used, JS the oracle.
3. Dynamic calls in the host (`CREATE OBJECT ... TYPE (name)` in the Go
   runtime since 2026-09-23). `osd-fm-registry.mjs` goes, and the service
   registries can move to ABAP.
4. Statics per session. Without them an ABAP registry in a shared process
   is state shared by everyone.
5. The dialog step in the Go host, with its test from `test/mocha.mjs`.
