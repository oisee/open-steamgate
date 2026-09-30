# Lazy table providers — design

The decision and its reasons are in [ADR 0005](adr/0005-lazy-table-providers.md).
This page is the shape of the code: the registry, the ABAP interface, the two
hooks, the fill protocol, the first three providers and the tests that have to
fail without the feature. Nothing here is built yet (2026-09-30).

## The registry

One JSON file per layer, `tables.providers.json`, found in `src/` and in each
pack's root. Later layers win a table name, and the build logs the override,
as `tools/osd-inputs.mjs` does for objects.

```json
{
  "groups": {
    "xref": {"provider": "host:tools/osd-xref-provider.mjs", "policy": "lazy",
             "tables": ["CROSS", "WBCROSSGT", "WBCROSSGTX", "D010INC"]},
    "vrsd": {"provider": "host:tools/osd-vrsd-provider.mjs", "policy": "by_key",
             "tables": ["VRSD"], "key": ["OBJTYPE", "OBJNAME"]}
  }
}
```

The registry is keyed by group, and a group lists every table its provider
writes. The status group (all six tables `zcl_osd_status=>refresh` replaces)
is not registered until its snapshot source is designed; see "Open".

- `tables`: every table one fill writes. Ensuring one of them ensures the
  group. The registry refuses a group whose provider writes a table it does
  not list (checked at fill time: the in-LUW writer names its tables).
- `maxStaleSeconds`: the bound on staleness when a trigger is missed. The
  default is 300; the status group uses 30, since process state changes
  without any trigger.
- `provider`: `abap:<CLASS>` or `host:<module>`. A host provider exists only
  where the host has the source (files, git). The preview and the Go binary
  register the ones they can serve and leave the rest out, so a read of an
  unregistered table is an ordinary SELECT.

## The ABAP side

```abap
INTERFACE zif_osd_table_provider PUBLIC.
  TYPES ty_keys TYPE STANDARD TABLE OF string WITH EMPTY KEY.  " one flattened key per line
  METHODS freshness RETURNING VALUE(rv_key) TYPE string.
  METHODS fill IMPORTING it_keys TYPE ty_keys OPTIONAL.        " empty = whole table
ENDINTERFACE.

CLASS zcl_osd_tables DEFINITION PUBLIC FINAL.
  PUBLIC SECTION.
    CLASS-METHODS ensure IMPORTING iv_table TYPE tabname
                                   it_keys  TYPE zif_osd_table_provider=>ty_keys OPTIONAL.
    CLASS-METHODS invalidate IMPORTING iv_table TYPE tabname OPTIONAL.
ENDCLASS.
```

`ensure` is a kernel hook (`@KERNEL`) into the host registry, so one fill state
serves both the implicit and the explicit path. On a real system the class
does nothing: SAP fills its own tables, and the method is empty there. It is
deployable, so ABAP that calls it does not have to be written twice.

## The fill protocol

```
ensure(table, keys?, explicit)
  group  = registry.group(table)
  if !explicit && group.policy == by_key && scope[luw][group]: return   -- reader declared its keys this LUW
  if explicit: scope[luw][group] = true
  if filling.has(group): return                             -- re-entry from inside this group's fill
  wanted = keys ?? WHOLE
  key    = epochMoved(group) || boundPassed(group)
             ? provider.freshness()                         -- the expensive key, recomputed rarely
             : lastKey[group]
  if covered(state[group], wanted, key): return             -- committed fill (WHOLE covers every key)
  if covered(pending[luw][group], wanted, key): return      -- filled earlier in this same LUW
  filling.add(group); saveSy()
  try   provider.fill(wanted)                               -- in-LUW writer, no own transaction
  finally filling.delete(group); restoreSy()
  pending[luw][group][wanted] = key

onStepLuwEnd(outcome)                                       -- after COMMIT WORK, WAIT's commitAll, rollback, step end
  outcome == "commit" ? merge pending[luw] into state : drop pending[luw]
  luw = next
```

`luw` is a counter the dialog-step module advances at every LUW end, so a
`COMMIT WORK` in the middle of a step starts a fresh pending set. The
`outcome` argument is new. Today `onStepLuwEnd` callbacks get none and run in
`finally`, even when `commit()` threw. The change is part of this work, and it
is tested by a commit that fails.

- **Whole covers keys.** A whole-table fill at key K satisfies every by-key
  ensure at K.
- **A key filled at an old freshness is refilled for that key only.** A whole
  table at an old key is refilled whole.
- **A fill that dumps propagates.** The reader's step rolls back as for any
  dump (`tools/osd-dialog-step.mjs`), and nothing is recorded.
- **Eager tables** are ensured at start inside `dialogStep`, as
  `seedAtStartup` is today, and never again unless their freshness changes.

## The two hooks

**Node, Bun binary, preview: the read half of `hookDatabase`.** The hook has
the shape `{read(sqlText) => Promise|undefined}`. The wrapper `await`s it
before `select`, `openCursor`, and `execute`/native when the statement is a
query. The existing write half calls its hooks synchronously; the read half
must await. A test lists the client's methods and fails if one that can
return rows is not wrapped. The match is a whole-identifier test of the text
against the registered names, upper-cased, compiled once into one regular
expression of alternatives. A CDS view name maps to its base tables
transitively, from the generated CDS registry. A dynamic `FROM (lv_table)` is
already resolved in the text the runtime builds.

**Readers outside the runtime.** `tools/osd-data.mjs` (freestyle SQL, which
vsp's where-used reaches) calls `ensureFor(sqlText)` before it runs. So do
the ADT facade's readers of the cross-reference. These readers hold only
`exclusive()`, never a dialog step, so there is no LUW for a fill to ride:
`ensureFor` runs the fill in a `dialogStep` of its own and commits it
**before** the reader takes the lock for its query. The injected and the
stand-alone `Data` runtime take the same path. The implicit hook, called
with no dialog-step token (the query under `exclusive()`), never fills: it
passes the read through, so `ensureFor` is the only fill of an external
reader. A freshness change between `ensureFor` and the query costs that one
query the previous freshness, within `maxStaleSeconds`. The list is closed and
named in the test, and the test covers a trigger fired between the two.

**Go: compiled in.** `Table` in `tools/gogen/go/abap/tables.go` gains
`Provider string` and `Policy string`. The emitter writes `abap.Ensure(s,
"<TABLE>")` before a static `Select` of a registered table. `SelectDyn` calls
`Ensure` itself, after `TableByName` has resolved the dynamic name; an
emitted call there would come too early. Host
providers on Go are Go packages of their own under `tools/gogen/go/<name>`
(git history through `os/exec` of `git`, or a library later).

## The first three providers

1. **Cross-reference** (`host:tools/osd-xref-provider.mjs`, group `xref`, four
   tables).
   - `freshness` is `cacheKey(root)`.
   - `fill` is today's `rows(root, {cache: true})` plus a new in-LUW writer:
     `insertStatements` executed on the reader's connection without
     `applyRows`' own transaction, which refuses an open LUW. The disk cache
     stays, so a refill after a recycle is a copy, not a parse.
   - The preview keeps its build-time rows (no files to parse) and registers
     no xref provider. OSGo keeps its build-time seed until Go providers exist.
   - Step 1 registers it as `eager` and deletes the five hand-wired calls.
     Step 2 turns it `lazy` and measures host start before and after with the
     same instrument.
2. **`VRSD` over git** (`host:tools/osd-vrsd-provider.mjs`, `by_key` on
   `OBJTYPE` + `OBJNAME`).
   - `freshness` is `git rev-parse HEAD`, cached for the life of one step.
   - `fill` maps the object to its files in layer order, runs
     `git log --follow`, and writes one row per commit. It carries the author
     mapped to a user name and the short SHA in `KORRNUM`.
   - Outside a git work tree the provider is not registered, and
     `SVRS_GET_VERSION_DIRECTORY_46` answers "no history" rather than zero
     rows.
   - Clean room: the row shape comes from measuring `VRSD` and the
     function-module signatures on A4H first.
3. **Status** (`host:tools/osd-status-provider.mjs`, group `status`, all six
   tables `refresh` replaces). **Not in the first slices.**
   - A host provider, because the facts come from the host. `refresh` takes a
     snapshot JSON of processes, listeners and the generation, which
     `test/start.mjs` builds today.
   - `fill` builds that snapshot and calls `zcl_osd_status=>refresh` with it.
     That is an ABAP call inside the fill, so it runs under the re-entry guard
     and the `sy` save.
   - `freshness` is the generation plus the snapshot's hash, bounded by
     `maxStaleSeconds: 30`.

## Tests that must fail without the feature

- A lazy table is empty after start and full after the first SELECT. The
  SELECT sees the rows in the same step.
- A reader that rolls back leaves the table unfilled and the state unrecorded.
  The next read fills again. There is exactly one fill per committed read.
- A freshness change behind a moved epoch refills on the next read. A change
  with no trigger refills after `maxStaleSeconds` and not before.
- Two by-key reads for different keys in one LUW fill both. A `COMMIT WORK`
  between them records the first before the second is filled.
- `WAIT` in the middle of a step (its `commitAll`) ends the LUW: fills before
  it are recorded, fills after it are pending.
- A `commit()` that throws records nothing.
- A provider that runs ABAP SQL inside a suspended outer SELECT: the outer
  `sy-subrc`/`sy-dbcnt` are unchanged, and a recursive ensure of the same group
  is a no-op.
- Every read method of every client is wrapped: `select`, `openCursor`, and
  query `execute`/native. `osd-data`'s freestyle SQL ensures too.
- Explicit `ensure` with keys fills only those keys, and the SELECT after it
  does not trigger a whole fill. A whole fill afterwards covers them. A
  by-key table read with no `ensure` in the LUW is filled whole.
- `osd-data`'s freestyle SQL on a lazy table: the fill commits in its own
  step before the query, and the query sees the rows.
- A SELECT naming the table only inside a string literal triggers a fill (a
  false positive) and returns the same rows as without it.
- Go: generated code calls `Ensure` before a registered table's `Select` and
  not before any other table's. Checked on the emitted text and by running.
- The preview without git: `VRSD` is unregistered and the FM says "no
  history".

## Open

- A JOIN of a lazy table with a by-key table: the implicit hook ensures both
  whole. That is correct and possibly slow; it will be measured before it is
  optimised.
- The status snapshot in pooled mode. The façade holds the pool, listener
  and child facts (`test/start.mjs`, `tools/osd-status.mjs`) and posts the
  snapshot to the child about to answer. A provider running inside a child's
  SELECT does not have them. Two candidates: the child asks the façade for a
  snapshot over the existing parent-child channel, or the façade keeps
  pushing and the provider only checks freshness against the last push.
  Until one is chosen and measured, status keeps today's route.
- An explicit by-key reader that forgets a key gets no row for it. That is
  the price of an explicit scope; the test for it asserts the empty answer,
  so the contract is visible.
- Measure the cost of `cacheKey(root)` and of `git rev-parse HEAD` on the full
  tree, so that `maxStaleSeconds` defaults come from numbers.
- The runtime version: the `sy` behaviour was read off `@abaplint/runtime`
  2.13.92, while the lock pins 2.13.89. Verify against the pinned one.
