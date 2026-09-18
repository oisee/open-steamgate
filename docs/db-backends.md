# The database seam: what a backend has to be

The transpiled ABAP never touches a database driver. Every Open SQL statement
goes through one object, `abap.context.databaseConnections["DEFAULT"]`, which
implements the runtime's `DatabaseClient` interface. Swapping the engine is
swapping that object. This repository already carries two implementations,
which is the best evidence that the seam is real:
`@abaplint/database-sqlite` (sql.js) and `tools/duckdb-client.mjs` (ours).

## The interface

`@abaplint/runtime/build/src/db/db.d.ts`, eleven members, all asynchronous:

| Member | Takes | Gives |
| --- | --- | --- |
| `name` | — | the identifier of the database (`"sqlite"`, `"duckdb"`) |
| `connect()` / `disconnect()` | — | — |
| `execute(sql)` | one statement or an array of them | — |
| `beginTransaction()` | — | no-op when one is open |
| `commit()` / `rollback()` | — | no-op when none is open |
| `insert({table, columns, values})` | strings | `{subrc, dbcnt}` |
| `update({table, where, set})` | strings | `{subrc, dbcnt}` |
| `delete({table, where})` | strings | `{subrc, dbcnt}` |
| `select({select, primaryKey})` | the statement in **ABAP SQL**, the key fields | `{rows}` |
| `openCursor({select, primaryKey})` | the same | `{fetchNextCursor(n), closeCursor()}` |

A row is a flat object of `number | string | Uint8Array | null`. There are no
prepared statements, no bind variables and no cursors in the interface itself:
the runtime hands over finished SQL text, and `openCursor` may be served by
reading everything and slicing, which is what our DuckDB client does.

That is the whole contract. For a Go host-function backend it means eleven
functions taking strings and returning plain data — no objects to model, no
callbacks except the two the cursor returns.

## Where the switch is

Above the clients, in this repository, not inside the runtime:
`test/setup.mjs` is called by the transpiled runtime before anything runs
(`abap_transpile.json`, `options.setup`) and decides:

```js
db = new SQLiteDatabaseClient();                 // or DuckDBDatabaseClient
abap.context.databaseConnections["DEFAULT"] = db;
await db.connect();
await db.execute(schemas.sqlite);                // DDL for that dialect
await db.execute(insert);                        // the transpiler's seed rows
await db.execute(seedStatements());              // ours, from data/*.tabu.json
```

`STG_DB=duckdb` picks the other one, `STG_DB_PATH` makes it persistent, the
browser preview passes a database restored from cache storage. A third
backend needs no change anywhere else: write the object, add a branch here.

## What the runtime emits, and who translates

The runtime emits **ABAP SQL**, not the target dialect, and the client does a
small, known rewrite. `@abaplint/database-sqlite` does exactly seven
substitutions before handing the text to sql.js:

- `UP TO n ROWS` → `LIMIT n`
- `ORDER BY PRIMARY KEY` → the key fields, or dropped when they are unknown
- `ASCENDING` / `DESCENDING` → `ASC` / `DESC`
- `~` → `.` (the ABAP table-field separator)
- `LIMIT 0` dropped
- `LEFT(x, n)` / `RIGHT(x, n)` → `substr(...)`

Everything else is passed through, so a backend over a SQLite-compatible
engine (`modernc.org/sqlite` is one) can reuse those rules verbatim and is
done. `INTO CORRESPONDING FIELDS`, aggregates, joins, `FOR ALL ENTRIES` and
the rest are resolved by the runtime before the client sees them.

What it cost to go to a *different* dialect is the honest measure of how much
dialect there is, and it is documented in
[`docs/handover-database-duckdb.md`](handover-database-duckdb.md). Three
things, no more:

1. **A different DDL flavour.** The transpiler writes the schema in four
   dialects (`schemas.sqlite`, `.pg`, `.hdb`, `.snowflake`); DuckDB takes the
   PostgreSQL one with `NCHAR(n)` rewritten to `VARCHAR(n)`.
2. **Trailing blanks.** ABAP CHAR is blank-padded and the runtime pads the
   literals it puts into SQL. SQLite columns are `NCHAR ... COLLATE RTRIM`,
   so `'A  ' = 'A'` holds; DuckDB compares the blanks, so our client trims
   literals (quote-aware). A SQLite-compatible engine inherits the collation
   and needs none of this.
3. **Savepoints.** The runtime opens a transaction on the first modifying
   statement and expects a failed statement to leave the transaction usable.
   DuckDB aborts the whole transaction instead, so our client remembers the
   successful statements of the LUW and replays them. SQLite behaves the way
   the runtime expects.

So: a Go backend over `modernc.org/sqlite` is the cheap case. It inherits the
SQLite DDL, the `COLLATE RTRIM` semantics and real savepoints, and its whole
job is the eleven methods plus the seven rewrites.

## What a host-function backend still has to solve

Everything in the interface is `Promise`-returning and the transpiled ABAP is
`await`-ed all the way down. A JavaScript engine embedded in Go therefore
needs a microtask queue and, if Go work happens off the JS thread, an event
loop that resolves promises from Go. If the Go side answers synchronously,
the methods can return already-resolved promises and no loop is needed.

Two things this repository can say about the JS side, from carrying the
browser build: the runtime needs no WebAssembly to have a database, because
`webpack.config.cjs` already aliases `sql.js$` to `sql.js/dist/sql-asm.js`,
the asm.js build (plain JavaScript, one file, no `.wasm` to route); and the
whole gateway plus runtime plus that engine already bundles to **one classic
script** (`build/sw.js`, 14 MB, service worker, no ESM at load time). Whether
a given engine executes a 4 MB asm.js blob fast enough is a separate
question, and a Go-backed client removes it entirely.

## What the vsp session measured on top of this (2026-09-13)

The question behind the write-up was whether the transpiler's runtime plus
this gateway can be embedded into a single static Go binary instead of
shipping a Node sidecar. Their result, for the record:

- **goja runs it, after one down-level.** As published, the runtime does not
  load: `abap.statements.loop` is an async generator and goja has none. With
  Babel lowering the async-generator syntax it runs, byte-identical output,
  three small shims, and 40 to 85 times slower than V8 **with the database
  stubbed**. That makes it an envelope for the runtime, not a measurement of
  a request: the Go path still needs the modernc backend before any number
  means something end to end. Bun sidesteps it with a native SQLite, and
  runs JavaScriptCore rather than V8.
- **The blocker was never WebAssembly.** Our browser build already uses the
  asm.js build of sql.js, so a database without wasm exists today. The case
  for a Go backend over `modernc.org/sqlite` is speed and dropping a 14 MB
  bundle, not feasibility.
- If the embed path is chosen, the first build item is exactly the eleven
  methods and seven rewrites above, as Go host functions.

## Not measured here

Speed of a Go-hosted engine against ours. `npm run bench:cube -- 1000000` compares SQLite and DuckDB through this
same seam; nothing comparable exists for a Go engine yet.

## The LUW, and the fact that there was not one

Measured 2026-09-18, while making a `$batch` changeset atomic (backlog B.2):
**nothing in this system ever committed.** All three clients implement the
bracket — `beginTransaction` is called by every write, and `commit` /
`rollback` end it — so the server ran from boot to disconnect inside a single
open transaction, and the rows survived only because `export()` and
`disconnect()` commit on the way out.

That is not harmless once anything rolls back. A `ROLLBACK WORK` issued to
undo one failed request would have undone everything written since the
process started, including the tables the generation writes at boot (`tadir`,
`wwwparams`, `t100`).

So the rule is: **a rollback is always preceded by a commit that fences it.**
`zcl_stg_batch` issues `COMMIT WORK` before it dispatches a changeset, which
ends whatever LUW was open, and only then can its `ROLLBACK WORK` reach no
further back than the changeset itself. The same shape is what any other
transactional boundary here has to use until something owns the LUW properly.

`COMMIT WORK` reaches every open connection (`abap.statements.commit` loops
over `context.databaseConnections`), so this holds for SQLite, the file-backed
client and DuckDB alike — DuckDB emulates savepoints by replay, which is why
it too needs the fence rather than a nested transaction.

### What the fence fixed in the DuckDB client as a side effect

`tools/duckdb-client.mjs` has no savepoints. It keeps every successful
modifying statement of the open LUW in `this.luw` and, when a failing
statement aborts the DuckDB transaction, rolls back and **replays the array**
into a fresh one. `beginTransaction`, `commit` and `rollback` each reset it.

While nothing committed, `commit` was never called, so that array grew from
boot until disconnect — and every failed statement replayed the entire
history of the process, the generation's boot writes included. The behaviour
was correct and quietly quadratic.

With the fence the array lives exactly one LUW, which gives a cheap check
that the bracket is really there: **the length of `luw` must stay within one
LUW's worth of statements.** Noticed by the workstation session, 2026-09-18,
reading the client rather than the symptom.

Verified after the change, on all three clients rather than assumed, because
they only behaved alike while the bracket was unused: `npm run unit:duckdb`
passes, and the wire suite against a DuckDB-backed server is 22 of 22,
including the changeset rollback and the composition cascade.
