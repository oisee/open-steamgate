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

## What a remote database costs, measured

The question "could HANA be the data layer, so AMDP runs native?" is a good
one and the seam allows it. What decides it is the per-statement cost, and it
was measured on 2026-09-18 — the same three statements against the in-process
SQLite this tree uses and against HANA Express in a container on the same
machine:

| statement | SQLite, in process | HANA Express, container | factor |
| --- | ---: | ---: | ---: |
| `SELECT` one row by key | 38 us | 1976 us | **52x** |
| `SELECT` 200 rows | 195 us | 743 us | 3.8x |
| `INSERT` one row | 12 us | 1748 us | **146x** |

The shape matters more than the numbers: **the cost is per statement, not per
row.** One round trip that brings back 200 rows is only 3.8x worse than doing
it in process, because the round trip dominates and it is paid once. A single
row costs the same round trip for almost no work, so it is 52x. An insert,
which in SQLite is twelve microseconds, is 146x.

So ABAP written set-wise — `SELECT ... INTO TABLE`, `FOR ALL ENTRIES` — ports
to a remote database almost for free, and ABAP written row-at-a-time does not.
That is the same rule a real system teaches, and here it is with numbers.

What follows for us:

- **HANA can be the data layer, as an option, and never as the default.** It
  buys fidelity that nothing else does: `sy-dbsys = HDB`, real HANA semantics,
  and AMDP running against the same tables the rest of the ABAP reads, which
  removes the mirroring question in `docs/amdp-in-hana.md` entirely.
- It costs a 4.5 GB image and a container to run anything at all, against
  SQLite's nothing, and it would make the test suite markedly slower: our seed
  alone is 2521 statements, which is about 30 ms in process and about 4.4 s
  over the wire.
- The two pieces of work are a `DatabaseClient` (eleven methods, the npm
  driver `hdb`, the same shape as `tools/duckdb-client.mjs`) and **a DDL
  generator, which does not exist**: the transpiler's `schemas.hdb` is
  literally `["todo"]`, next to three real generators for SQLite, PostgreSQL
  and Snowflake. Both would be contributions upstream rather than local
  patches.
- The same numbers price the Go host-function backend discussed above: in
  process it inherits SQLite's order of magnitude, over a socket it inherits
  this one.

## What `STG_DB=hana` would actually cost, measured against HANA Express

Measured 2026-09-18 against HXE on the i7, because the estimate before it was
guesswork. The three things that cost work when DuckDB was added are the
things to price, and two of the three come out cheaper than they did there.

**1. The DDL is free.** HANA accepts the PostgreSQL schema the transpiler
already generates, **unchanged**: all 77 `CREATE TABLE` statements of this
tree's tables were accepted as written. DuckDB needed one rewrite
(`NCHAR(n)` → `VARCHAR(n)`); HANA needs none. So `schemas.hdb` being
`["todo"]` upstream does not block us — `schemas.pg` is the HANA schema too,
which is worth knowing before anyone writes a generator.

*What this does not say*: acceptance is not semantics. The next point is an
example of a statement that is accepted and behaves differently.

**2. Blank padding: the same problem DuckDB had.** ABAP `CHAR` is
blank-padded and the runtime pads the literals it puts into SQL. SQLite's
columns are `NCHAR ... COLLATE RTRIM`, so `'A  ' = 'A'` holds for free. HANA
does not pad and does not ignore the padding:

```
NCHAR(10) holding 'A'   ->  LENGTH(K) = 1
WHERE K = 'A         '  ->  no rows
WHERE K = 'A'           ->  one row
```

So a HANA client needs the same quote-aware literal trim
`tools/duckdb-client.mjs` already does, and that code is reusable as it
stands.

**3. Savepoints are not needed, and this is where HANA is cheaper than
DuckDB.** The runtime opens a transaction on the first modifying statement
and expects a failed statement to leave the transaction usable. DuckDB aborts
the whole transaction, which is why our client keeps the LUW's successful
statements and replays them. HANA behaves the way the runtime expects:
measured, a duplicate-key `INSERT` was rejected and **the next `INSERT` was
accepted** — the transaction survived. No replay machinery at all.

One prerequisite that falls out of the same probe: the session has to have
autocommit turned off, or `COMMIT`/`ROLLBACK` mean nothing and `SAVEPOINT`
answers `TxSavepoint with autocommit is not supported`.

**So the remaining work is the eleven methods and the connection handling**,
with the literal trim borrowed from the DuckDB client and no dialect work of
consequence. What stays expensive is not the writing — it is the per-statement
latency measured in the section above, which is why this is a mode and not a
default.

## The HANA client, and the ten things that were in the way

Built 2026-09-18, `tools/hana-client.mjs`, `STG_DB=hana`. **Both suites reach
parity with SQLite: the 146 ABAP unit tests all run, and the 22 wire tests all
pass.**

What is worth recording is not that it works but what it cost, because nine
of the ten obstacles were **not** about SQL, and none of them could have been
read out of documentation. Each was found by running the suite and watching
where it stopped.

1. **Identifier case and quoting.** Three shapes were tried and only the third
   works. *As written* (quoted, lower case): HANA accepts all 77 `CREATE
   TABLE` and then nothing can be read, because the runtime's references are
   unquoted and HANA folds those to upper — `invalid column name:
   zosd_test_item.ITEM_ID`. *Unquoted*: both sides fold alike, until a column
   called `cross` turns out to be a reserved word — and `SYS.RESERVED_KEYWORDS`
   also holds `END`, `GROUP`, `ORDER`, `START`, all plausible ABAP field names.
   *Quoted upper case*: unquoted references fold onto it and reserved words are
   safe. That one.
2. **A rerun met its own tables.** `STG_DB_FRESH=1` now drops the schema first.
3. **Seed inserts arrive in two shapes** — columns in single quotes (HANA reads
   those as string literals) and columns already double-quoted in lower case.
   Both are folded.
4. **The driver's packet limit.** node-hdb defaults to 128 KB and refuses
   anything larger with `Packet size limit exceeded`. Our own seed statements
   are tiny — the largest is 2 KB — but the transpiler puts whole ABAP sources
   into `reposrc` and SMW0 media into `wwwdata` as hex, so one `INSERT` is
   megabytes. Raised to 64 MB; the driver's own ceiling is 2^30-1.
5. **The same stream carries both forms.** Most references are unquoted, and
   some statements arrive quoted in lower case — `INSERT INTO "cross" ("type",
   ...)`, written by the runtime at boot. Folding the contents of every quoted
   identifier to upper makes both land on one name.
6. **Row keys come back upper case** and the runtime looks a column up by the
   lower-case name it asked for: `rowsToTarget` reads `row[field]`, gets
   `undefined` and dies inside `Character.set`. Folded back down on return.
   Fold up on the way out, fold down on the way back — one rule, twice.
7. **A double quote is not always an identifier.** A column holding the JSON
   `{"draft":"kept"}` is a *value*, and folding it turned the data into
   `{"DRAFT":"KEPT"}`. A test caught it; nothing threw.
8. **`WHERE true AND true AND ...`**, which the runtime builds when it has no
   condition, is not valid in HANA — `incorrect syntax near "AND"`. Rewritten
   to `1 = 1`. **This is the only genuine dialect rewrite in the whole list.**
9. **`hasSchema()` asked for its own column in the wrong case**, answered
   false against a schema that was plainly there, and the setup then tried to
   create everything twice. The rule introduced in (6) caught its author one
   screen later.
10. **A Buffer does not imply a binary column.** node-hdb returns `BLOB` and
    `VARBINARY` as Buffer, but also returns `CLOB`/`NCLOB` that way. Converting
    every Buffer to hex preserved vectors and silently changed a session JSON
    string into `7B22...`. Prepared-result metadata now decides: character
    LOBs decode as UTF-8; binary LOBs retain the hexadecimal ABAP boundary.

**The rule worth carrying out of this**: a transformation of SQL that
distinguishes literals from the rest cannot be done in two passes. Items 7 and
8 are the same mistake — parse where the literals are, then run a regular
expression over the whole joined string, which no longer knows. Both were
silent data corruption rather than an error, and both were caught by a test
comparing a stored value, not by reading the code.
