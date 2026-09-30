# ADR 0005 — Lazy table providers: derived tables filled on demand

**Status:** Accepted, narrowed (Alice, 2026-09-30, after reviews by astra, Fable and osg-research-c2). Release tier: 0.4 nice (the decision); first slice 0.5 should (`docs/backlog/gogen-osgo.md`, "Release plan with priorities")
**Date:** 2026-09-30
**Deciders:** Alice; open-steamgate (dell)
**Context:** Alice asked for a central way to fill tables lazily, either whole or
by key, on demand and with triggers. The first consumers are the version API
over git (`VRSD`) and the cross-reference tables (`CROSS`, `WBCROSSGT*`). The
design is in `docs/lazy-tables.md`; the backlog entry is
`docs/backlog/gogen-osgo.md`, "Lazy table providers".

## Context

Derived tables are filled today in four different ways, each wired by hand:

| table(s) | filled by | when |
|---|---|---|
| `CROSS`, `WBCROSSGT`, `WBCROSSGTX`, `D010INC` | `tools/osd-xref-seed.mjs` (abaplint parse, ~3 s, cached per `cacheKey(root)` in `build/xref/`) | at every host start, from five callers plus OSGo's build |
| `ZOSD_SYS`, `ZOSD_SVC`, `ZOSD_PACK` | `zcl_osd_status` inside a `dialogStep` | after the runtime starts, and on refresh |
| `data/*.tabu.json` rows | the seed | at start, whole |
| AMDP table parameters | `hostRelation` | per call, never stored |

The rule of 2026-09-24 (AGENDA; `docs/abap-daemons.md`) is that files are the
truth, and tables hold only indices derived from them. Every derived table
therefore has a source it can be rebuilt from. None of them can yet say "not
needed until somebody reads me".

Four facts of the code constrain the design:

1. **A SELECT reaches the database seam as text.** The runtime calls
   `context.defaultDB().select({select, primaryKey})` with ABAP SQL text
   (`@abaplint/runtime` `statements/select.js`, `db.d.ts:15-20`). It carries no
   table name and no structured WHERE. Writes do carry `options.table`.
2. **The seam already has a hook layer, for writes only.** `hookDatabase` in
   `tools/osd-dialog-step.mjs` says "Reads are not hooked yet: the consumers
   that need them ... add that half". Every host's client passes through
   `test/setup.mjs`, so a hook there reaches Node, the Bun binary and the
   preview.
3. **The work-process lock is not re-entrant.** `exclusive()` throws "a nested
   dialog step" inside a step, and `applyRows` refuses inside an open LUW. A
   fill that is triggered by a SELECT cannot open a step of its own.
4. **On Go, the emitter knows the table at compile time.** The static `Select`
   gets SQL text only, but `tables.go`'s registry (`RegisterTables`,
   `TableByName`) is generated from the DDIC and could carry a provider.

## Accepted scope (2026-09-30)

Three reviews (astra, Fable, osg-research-c2) all said ACCEPT WITH CHANGES, for one reason: **no ABAP under `src/`
or `packs/` SELECTs a registered table today.** Every reader of `CROSS`, `WBCROSSGT*`, `D010INC` is host-side
(`tools/osd-data.mjs`, `tools/adt-facade.mjs`, `osd-unit-risk.mjs` through `rows()`), and versions are already read
from git at read time (#288, ADR 0001). So the decision is accepted and the mechanism is gated on a reader.

**Accepted now**
- **Derived tables are declared by group** (the tables one fill writes), with a policy (`eager` / `lazy` /
  `by_key`) and a provider. The registry is **internal**: no public manifest format, no pack override semantics,
  no ABAP interface yet. Those are one-way doors; they stay closed until a second consumer and the shared-DB model
  are proven (astra).
- **A fill is bound to an immutable source identity** (the generation for the cross-reference, a pinned commit
  plus the layer mapping for git history) and publishes that identity with its rows. Freshness means "the rows
  carry the identity the reader asks for"; a timer only decides when a read re-checks, it bounds nothing else
  (astra).
- **The first slice is the cross-reference only**, and outside any reader's LUW: an `eager` fill in a dialog step
  of its own right after the host starts listening, and the closed list of host readers awaits that fill's promise
  (Fable). This moves the ~3 s parse off the critical path of start without a fill under anybody else's lock.
- **Measure before the policy changes**: host start and the cold first read of the cross-reference, with one
  instrument, before `lazy` is switched on (osg-research-c2, astra).
- **Keys are name/value pairs**, not a flattened string: CHAR loses trailing blanks and NUMC keeps leading zeros,
  so a string built in ABAP and one built by the host would differ for the same key. A `--check` verifies every
  registered table and key field against the DDIC (`tools/dsl-ddic.mjs`), in key order (osg-research-c2).
- **One work process today, several in 0.6.** While there is one, fill state may live in the process. On a shared
  DB (the OSGo dispatcher track) the group's source identity is a row beside its rows, rebuildable by dropping it,
  a fill takes an ENQUEUE on the group, and rows plus identity publish atomically; an older publisher is rejected.
  That row is cache metadata, not authoritative state, so it is not what ADR 0001 keeps out of tables (astra, Fable).
- **Fill bookkeeping hangs off the step token**, never module scope, so the 0.5 Session refactor carries it (Fable).

**Gated, not accepted yet: until the first ABAP SELECT of a registered table enters the tree**
- The implicit read hook at the seam, fills in the reader's LUW, the pending/committed protocol, the `sy`
  save/restore and re-entry guard, and the Go emitter's `Ensure`: decisions 3, 5, 6 and 8 below.
- `ensure` in application ABAP (decision 4). By-key preparation happens inside our runtime implementations of
  standard APIs (for example `SVRS_GET_VERSION_DIRECTORY_46`), and ordinary reads stay complete (astra). The rule
  "an explicit ensure suppresses later implicit fills in the LUW" is dropped; a neighbouring reader could miss rows.
  The sentence "the contract for such a reader is to ensure every key it reads, in the same LUW" stays as the
  internal contract that verified lift R1 cites (osg-research-c2).
- `VRSD` as a table: only when standard ABAP that reads `VRSD` enters the tree; until then #288 answers from git.
- When the gate opens: match a table name only in table position (after `FROM` / `JOIN`), because `CROSS` is an SQL
  keyword; map CDS SQL-view names and classic DDIC views to their base tables; in development, log every implicit
  fill as a named event so no ABAP comes to rely on an implicit fill unnoticed (Fable, osg-research-c2).

## Full design (the gated part follows the accepted scope above)


1. **A registry of providers**, one entry per table, layered like the input
   folders so that a pack can add a provider. Each entry names:
   - the provider: an ABAP class implementing `zif_osd_table_provider`, or a
     host module for data that only the host can derive (git history, the
     abaplint parse);
   - a policy: `eager` (filled at start), `lazy` (filled whole on first read)
     or `by_key` (filled for the keys asked).
2. **Freshness has two levels: an epoch pushed by triggers, a key pulled
   when the epoch moved, and a time bound behind both.** Every provider
   answers `freshness( )`: a string that changes when its source changes
   (`cacheKey(root)` for the cross-reference, the HEAD commit for `VRSD`, the
   generation plus a host snapshot for the status tables). These keys are not
   cheap. `cacheKey` walks the inputs and hashes generated files, and HEAD
   spawns `git`. So a read compares only a per-group **epoch** counter, which
   the triggers bump: `store.onChange`, `applyRuntimeHotSwap`, a new
   `fs.watch` on `.git/HEAD` and the ref it names. `freshness( )` is
   recomputed only when the epoch moved, **or** when the group's
   `maxStaleSeconds` has passed since the last check. A missed event therefore
   leaves a table stale for at most that bound, never forever, and the bound is
   declared per table.
3. **Implicit, whole-table, at the seam, over every read method.** A read
   hook is added to the existing `hookDatabase` layer and awaited before the
   client runs. It covers **every** client method that can return rows:
   `select`, `openCursor`, and `execute`/native when the statement is a query.
   A test enumerates the client's methods, so a new read path fails the build
   instead of silently bypassing the hook. The hook matches whole identifiers
   of the statement text against the registered names. CDS names map to their
   base tables transitively, from the generated CDS registry. A dynamic
   `FROM (lv_table)` arrives already resolved in the text the runtime builds,
   so it is matched after resolution. A false positive (the name in a string
   literal) costs one idempotent fill, never a wrong answer. Readers that do
   not go through the ABAP runtime (the freestyle SQL of `tools/osd-data.mjs`,
   vsp's queries through it) call the same host `ensureFor(sqlText)` before
   they run. They are not inside a dialog step (the SQL door takes only
   `exclusive()`), so `ensureFor` runs any needed fill in a `dialogStep` of its
   own, committed, **before** the reader takes the lock for its query. The
   injected and the stand-alone `Data` paths do the same. **Outside a dialog
   step the implicit hook never fills**: it has no LUW to ride, so it only
   passes the read through, and `ensureFor` is the one fill path of an
   external reader. A trigger landing between `ensureFor` and the query leaves
   that one query on the previous freshness, inside the `maxStaleSeconds`
   contract. That list of entry
   points is closed and tested; anything outside it is a reader that has to
   call `ensure` itself.
4. **By key is explicit, never guessed from a WHERE.** ABAP that wants a by-key
   fill calls `zcl_osd_tables=>ensure( table = ... keys = ... )` before its
   SELECT. Deriving keys from ABAP SQL text would be a parse of a language we
   do not own at the seam, which is the thing `tools/osd-sql-trace.mjs`
   already calls a guess. An explicit `ensure` declares the reader's scope for
   the rest of the LUW. The implicit hook, reaching a `by_key` table that was
   explicitly ensured in the current LUW, trusts that scope and fills nothing
   more. The contract for such a reader is to ensure every key it reads, in
   the same LUW. A `by_key` table reached implicitly with no explicit ensure in
   the LUW is filled whole, which is correct and costs more.
5. **A fill runs in the reader's LUW, and counts only after a commit that
   succeeded.** The provider writes its own table inside the current LUW,
   through an in-LUW writer (not `applyRows`, which opens and commits its own
   transaction). Pending fills are keyed by group and by key (or WHOLE), and
   belong to one **LUW**, not one step. A `COMMIT WORK` mid-step, the
   `commitAll` inside `WAIT`, and a rollback all end it. `onStepLuwEnd` gains
   an outcome argument (`commit` after a commit that returned, `rollback`
   otherwise). Pending fills become recorded state only on `commit`; on
   `rollback` they are dropped with the rows. `eager` fills at start run in a
   `dialogStep` of their own, as `seedAtStartup` does today.
6. **No re-entry during a fill.** A fill in progress marks its group, and an
   `ensure` of the same group from inside it is a no-op. The hook saves the
   runtime's `sy` fields before a provider runs and restores them after, so the
   outer SELECT's `sy-subrc`/`sy-dbcnt` are its own. Host providers are
   preferred for fills that happen inside a read, since they run no ABAP. An
   ABAP provider inside a suspended SELECT needs its own test, with a provider
   that itself runs ABAP SQL.
7. **Fill state lives in the serving process, not in a table.** It is a map
   from table and key to freshness. A recycled process refills on first read.
   The cross-reference keeps its disk cache, so the refill is a copy, not a
   parse. This keeps the "tables hold only derived rows" rule: there is no
   bookkeeping table to go stale.
8. **Go gets the same contract at compile time.** The emitter emits
   `abap.Ensure("<TABLE>")` before a static `Select` of a registered table.
   `SelectDyn` calls `Ensure` itself, after `TableByName` has resolved the
   dynamic name. `Table` gains a provider and policy field. There is no text
   scan on Go.
9. **The provider owns only its tables (its group).** It writes nothing else and shares no
   state between processes (the no-shared-table-state decision).
10. **Order of adoption:**
   1. the cross-reference moves into the registry as `eager`: same behaviour,
      one wiring for the three runtime hosts. The preview keeps its build-time
      rows (it has no files), and OSGo keeps its build-time seed until Go
      providers exist;
   2. then it becomes `lazy`, taking ~3 s off host start;
   3. `VRSD` over git is the first `by_key` table;
   4. the status tables follow, last, and only after the snapshot question
      below is designed. Until then they keep today's refresh route.

## Consequences

- Host start stops paying for tables nobody reads. The cross-reference parse
  is the largest such cost today.
- Freshness is relative to a named source identity. A missed trigger delays
  the re-check by at most `maxStaleSeconds`; it does not bound the fill's
  duration or a transaction snapshot that is already open (astra).
- The first SELECT of a lazy table pays for its fill inside the reader's step.
  For the cross-reference that is the cached copy (milliseconds) or the parse
  (~3 s cold). How slow a cold first read is gets measured, not guessed.
- A fill inside a step extends that step's LUW, so a rollback in the reader
  undoes the fill. That is correct, and costs a refill.
- The preview (no files, no git) registers only providers whose source it has.
  `VRSD` answers "no history" there rather than an empty list.
- ABAP deployed to a real system never sees any of this. On SAP, `VRSD` and
  `CROSS` are filled by the system itself, so providers are runtime (kernel)
  concerns and are not part of what `segw:zip` or abapGit carry.

## Rejected, with the reason

- **Deriving keys from the WHERE at the seam.** The seam gets ABAP SQL text.
  Parsing it per SELECT is a second SQL front end, and a wrong parse is a
  silently missing row. An explicit `ensure` is visible and testable.
- **A push event bus as the only source of truth.** A missed event would be a
  stale table forever. The time bound caps it.
- **Pulling the full freshness key on every read.** Measured shape, not
  measured time: `cacheKey` walks and hashes the tree, and HEAD spawns a
  process. That is the wrong cost for a read path; the epoch comparison is a
  number.
- **A bookkeeping table as authoritative state.** Rejected. A source-identity
  row beside the rows, rebuildable by dropping it, is cache metadata and is
  accepted for the shared-DB case (see Accepted scope).
- **A separate connection or step for the fill.** There is one work process,
  and the lock is not re-entrant. A second step would wait for the reader
  that is waiting for it.
- **Views or table functions instead of tables.** Consumers (vsp's where-used,
  the Readers CodeLens, standard ABAP reading `VRSD`) read plain tables with
  plain SELECTs. The providers keep that contract.

## One-line summary

Derived tables register a provider with a freshness key, checked when a
trigger moved the epoch or a time bound passed. A read is preceded by an
ensure: implicit and whole at every read method of the seam, explicit by key
from ABAP, and compiled in on Go. The fill rides the reader's LUW and counts
only after a commit that succeeded.
