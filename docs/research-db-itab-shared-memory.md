# Can an internal table share memory with the SQL engine? Measured, 2026-11-25

Research on the branch `research/db-itab-shared-memory`. Nothing here is a
product feature: the PoC is behind `OSD_LAZY_ITAB=1`, off by default, and
no upstream repository was changed or patched for it.

**The question.** Today `SELECT ... INTO TABLE` copies every row the
database answers into an `abap.types.Table` of `Structure` objects, one
JavaScript object per field per row. Can the transpiled ABAP on Node share
memory with the in-process engine (sql.js, DuckDB) instead, and is it
worth it?

**The answer in five lines.**

1. Building the internal table is 42% of a `SELECT *` of a million rows on
   SQLite and 47% on DuckDB, and on DuckDB another 50% is the client
   turning the result into row objects. The engine itself is 3% there. So
   yes, there is something to take.
2. The PoC leaves the rows in the result as the engine gave it and makes a
   field when ABAP reads it. `SELECT *` of a million rows: 7.1 s to 4.3 s
   on SQLite, 7.4 s to 0.44 s on DuckDB; heap after the SELECT 766 MB to
   331 MB, and to 77 MB plus 206 MB of the engine's own buffers on DuckDB.
   The ABAP Unit suite (1163 methods) gives the same result with it
   switched on as without, on both engines.
3. It is not free: a program that then reads every field of every row pays
   the build inside its loop plus a toll: 13% more for the SELECT and the
   loops together on SQLite, 8% on DuckDB. And what ABAP does with the rows
   afterwards costs more than the SELECT ever did, and no sharing touches
   that.
4. For the cube it changes nothing, by measurement: the aggregation runs in
   the engine and the table that comes back has eight rows.
5. Sharing the engine's memory produced one silent wrong answer on the way:
   rows read out of memory the collector had already freed. A copy cannot
   do that. It is fixed and it is the main thing this PoC has to teach.

The numbers behind each line are below, and so is what the PoC does not
cover.

## The instrument

`research/shmem/measure.mjs`, one tool for every number in this file:

```
export OSD_PACKS=research/shmem/pack
npm run transpile
node research/shmem/measure.mjs 1000000 sqlite,duckdb eager,lazy
```

(`OSD_PACKS` stays set: any tool that checks the build without it, the
cube benchmark for one, makes the generation without the pack live again.)

A child process per (engine, mode) boots the transpiled runtime the way
`tools/bench-cube.mjs` does (`STG_DB`, `STG_DATA_SCALE`, the facts of
`tools/gen-data.mjs`) and calls the static methods of
`ZCL_OSD_SHMEM_BENCH` (`research/shmem/pack/`, an opt-in pack), real
transpiled ABAP, one statement group per method. The sequence runs three
times in the child; a cell is the **median of three, wall time**, and the
heap is `heapUsed` after two forced collections, over the booted runtime.
One run at a time, under the shared heavy lock.

The three layers of a SELECT are told apart by wrapping the real calls, not
by simulating them:

| layer | wrapped call | what it is |
| --- | --- | --- |
| engine | `sqlite.exec` / `connection.runAndReadAll` | the engine, including what its binding does to hand values to JavaScript |
| rows | `DatabaseClient.select` minus engine | the client turning the result into row objects |
| itab | `abap.statements.select` minus the client | the runtime building the internal table |

Controls, so that a zero can be believed: each wrapper must be hit exactly
once per SELECT or the run fails (it did fail, the first time the DuckDB
path went through a method the harness had not wrapped); the row count must
be the scale plus the 24 seed rows; a 100 ms timer reads 100 to 101 ms; a
million small objects read 70.9 MB; and in lazy mode the PoC's own counters
say how many rows and fields each step made.

Machine: 4 cores, 31 GB, Node 26.9, sql.js (WASM) and DuckDB 1.5.5 through
`@duckdb/node-api`.

## Where the time goes today

`SELECT * FROM zstg_flightfact INTO TABLE` (8 columns: five CHAR, one NUMC,
one INT4, one DEC 15,2), then what ABAP does with the table. Milliseconds.

| | SQLite 100k | DuckDB 100k | SQLite 1M | DuckDB 1M |
| --- | ---: | ---: | ---: | ---: |
| **`SELECT *` INTO TABLE** | **713** | **746** | **7,134** | **7,433** |
| &nbsp;&nbsp;engine | 391 (55%) | 25.1 (3%) | 3,584 (51%) | 213 (3%) |
| &nbsp;&nbsp;rows (client) | 33.4 (5%) | 367 (49%) | 547 (8%) | 3,763 (50%) |
| &nbsp;&nbsp;itab (runtime) | 288 (40%) | 351 (47%) | 2,953 (42%) | 3,507 (47%) |
| &nbsp;&nbsp;heap after it, MB | 76.8 | 76.9 | 766 | 762 |
| `lines( )` | 0.05 | 0.05 | 0.05 | 0.06 |
| copy of the table | 127 | 126 | 1,474 | 1,352 |
| READ INDEX, every 1000th row | 0.54 | 0.54 | 5.94 | 5.82 |
| LOOP, one field read | 64.5 | 65.8 | 579 | 545 |
| LOOP, every field read | 346 | 344 | 3,246 | 2,994 |
| LOOP + COLLECT by airline | 761 | 748 | 7,424 | 6,927 |
| `SELECT airline seats` INTO TABLE | 222 | 182 | 2,170 | 1,914 |
| the aggregation in Open SQL (GROUP BY) | 118 | 11.8 | 1,233 | 26.5 |
| &nbsp;&nbsp;of which itab | 0.10 | 0.17 | 0.10 | 0.18 |

Read off the table:

- **The engine is not the cost on DuckDB.** 0.21 s of 7.4 s. The other 97%
  is two copies made one after the other: the result into row objects
  (`getRowObjects` plus a conversion per value), then the row objects into
  field objects.
- **On SQLite the engine half cannot be shared at all.** sql.js is SQLite
  compiled to WebAssembly: its rows live in the WASM heap as UTF-8 and
  every value is decoded into a JavaScript string or number on the way out.
  That decoding is inside `exec`, the 3.6 s, together with the scan itself;
  the two were not told apart.
- **The internal table costs 766 bytes a row**, for a row of 8 short
  fields. A million rows are 766 MB of heap; a copy of the table is another
  643 MB.
- **What ABAP does afterwards is the larger half.** Reading every field of
  every row once costs as much as building the table (3.2 s against 3.0 s
  on SQLite), and aggregating in ABAP with `COLLECT` costs 7.4 s, more
  than the whole SELECT. That is interpretation, not copying.
- **The cube is not in this picture.** `select_cube` is the same
  aggregation written in Open SQL: the engine does it (1.2 s on SQLite,
  27 ms on DuckDB) and building its eight-row table takes 0.1 to 0.2 ms.

## The ideas, and which one was built

| idea | lives | verdict |
| --- | --- | --- |
| (a) the result stays in the engine's buffers, rows and fields are made when read | as long as the internal table, but it is an **immutable result**, not the table of the database | **built**, for DuckDB's chunks |
| (b) the same over the client's row objects, for any engine | the same | **built**, it is the same code with a different source |
| (c) an internal table handed to the engine without a copy | one call (`hostRelation`, `tools/ir-host-relation.mjs`) | not built: the contract exists and is per call; the Node reference copies once, and nothing measured here says that copy is where time goes |
| (d) an internal table that is a view of the engine's live table | outlives everything | not built, and should not be without the rule in "Generations" below |

(a) and (b) are one PoC, `tools/osd-lazy-itab.mjs`: the source of a row is
either the client's row object or (chunk, index) into DuckDB's result. It
was chosen because the table above says the two copies are where the time
is, and because it needed **no change to the runtime, the transpiler or
any library**: `abap.statements.select` is replaced on the runtime object
by `test/setup.mjs` when the switch is on, and a row is a `Structure` by
prototype, so LOOP, READ, SORT, DELETE, MODIFY, INSERT, COLLECT, a copy
and a comparison run the runtime's own code unchanged.

The switches, all read once at start: `OSD_LAZY_ITAB=1` turns it on;
`OSD_LAZY_ITAB_CHUNKS=0` keeps DuckDB on its row objects;
`OSD_LAZY_ITAB_FULL_AFTER` is the share of a row's fields after which the
row is made in full (0.5; at 100k rows on SQLite the first loop over every
field took 752 ms with 0, 773 with 0.13, 754 and 829 in two runs with 0.5
and 803 with 1, so it is not where the toll is); `OSD_LAZY_ITAB_REPORT=1` prints the counters
at exit.

How a row works:

- It holds the row type's components (the templates an eager row is cloned
  from) and a reference into the result. No constructor of `Structure`
  runs.
- `get()` answers a view of the fields that makes a field the first time
  it is read, with the two calls the runtime's `rowsToTarget` makes at
  SELECT time: a clone of the component and `set(value)`, or `clear()` for
  NULL. Once more than half of the fields have been read the row is made
  in full and `get()` answers the plain fields, so a second pass over the
  table costs what it costs today.
- Anything that needs the whole row (the private `value` every inherited
  method reads) makes it in full.
- A copy of a row nobody has read in full is another row over the same
  result. That is ABAP's table sharing, by accident: `lt_b = lt_a` of
  untouched rows copies references.
- On DuckDB a column of a chunk (about 2000 values) leaves the engine's
  vector in one tight loop the first time one of its fields is made (item
  by item from inside the ABAP loop, the loop over every field took 1758 ms
  at 100k rows against 1235 ms this way). A column nobody reads never
  leaves the engine.

Is that "shared memory with the engine"? For DuckDB, literally: the
internal table holds the engine's result chunks, and the vectors are the
engine's own buffers seen through `vector_get_data`. For sql.js, no, and
it cannot be: what is shared there is the client's row objects, which is
one copy fewer and not zero.

## Before and after

Same instrument, same statistic, one run at a time.

| | SQLite 100k | DuckDB 100k | SQLite 1M | DuckDB 1M |
| --- | ---: | ---: | ---: | ---: |
| `SELECT *` INTO TABLE | 713 → 407 | 746 → 41.9 | 7,134 → 4,254 | 7,433 → 435 |
| &nbsp;&nbsp;engine | 391 → 350 | 25.1 → 24.3 | 3,584 → 3,713 | 213 → 163 |
| &nbsp;&nbsp;rows | 33.4 → 32.1 | 367 → 7.23 | 547 → 509 | 3,763 → 117 |
| &nbsp;&nbsp;itab | 288 → 16.2 | 351 → 8.68 | 2,953 → 188 | 3,507 → 148 |
| &nbsp;&nbsp;heap after it, MB | 76.8 → 33.3 | 76.9 → 8.50 | 766 → 331 | 762 → 77.0 |
| &nbsp;&nbsp;external memory, MB | 0.00 → 0.00 | 0.00 → 20.6 | 0.00 → 0.00 | -0.01 → 206 |
| copy of the fresh table | 127 → 20.7 | 126 → 19.9 | 1,474 → 202 | 1,352 → 169 |
| &nbsp;&nbsp;heap with the copy, MB | 141 → 41.1 | 141 → 16.3 | 1,409 → 409 | 1,405 → 156 |
| READ INDEX, every 1000th row | 0.54 → 0.81 | 0.54 → 11.5 | 5.94 → 7.79 | 5.82 → 25.2 |
| LOOP, one field read | 64.5 → 112 | 65.8 → 108 | 579 → 1,001 | 545 → 849 |
| &nbsp;&nbsp;heap after it, MB | 141 → 64.0 | 141 → 39.9 | 1,409 → 638 | 1,405 → 392 |
| LOOP, every field read (first time) | 346 → 754 | 344 → 1,135 | 3,246 → 7,161 | 2,994 → 10,517 |
| &nbsp;&nbsp;heap after it, MB | 141 → 103 | 141 → 98.6 | 1,409 → 1,027 | 1,405 → 978 |
| the same LOOP again | 344 → 334 | 341 → 335 | 3,231 → 3,020 | 2,943 → 2,879 |
| LOOP + COLLECT by airline | 761 → 721 | 748 → 748 | 7,424 → 7,020 | 6,927 → 7,013 |
| copy of the table once read | 134 → 158 | 136 → 148 | 1,911 → 1,884 | 1,802 → 1,814 |
| `SELECT airline seats` INTO TABLE | 222 → 135 | 182 → 22.5 | 2,170 → 1,313 | 1,914 → 204 |
| the aggregation in Open SQL | 118 → 111 | 11.8 → 15.3 | 1,233 → 1,256 | 26.5 → 25.9 |
| **sum: SELECT + LOOP one field** | 777 → 519 | 812 → 149 | 7,713 → 5,255 | 7,978 → 1,284 |
| **sum: SELECT + copy** | 839 → 427 | 872 → 61.8 | 8,608 → 4,457 | 8,785 → 604 |
| **sum: SELECT + both LOOPs (every field read)** | 1,123 → 1,273 | 1,156 → 1,284 | 10,959 → 12,416 | 10,972 → 11,801 |

- **A SELECT nobody reads much of is where it pays**: at a million rows
  1.7 times faster on SQLite and 17 times on DuckDB, with less than half
  the heap. `lines( )` and a copy stay cheap, and the SELECT plus a loop
  over one field is 32% less on SQLite and 84% less on DuckDB.
- **A program that reads everything pays it back, with interest.** The
  first loop over every field of a lazy table is 2.2 times the eager loop
  on SQLite and 3.5 times on DuckDB, because it is the eager loop plus the
  build (plus, on DuckDB, the decoding the client used to do) plus the
  view's toll. The SELECT and both loops together are 13% slower than
  eager on SQLite and 8% on DuckDB at a million rows; the toll is one
  microsecond a row on SQLite and a quarter of one on DuckDB.
- **After that the table is an ordinary table**: `loop_again`,
  `abap_cube` and `copy_read` are within noise of eager.
- **A sparse READ on DuckDB got slower** (6 ms to 25 ms for 1000 rows out
  of a million): rows spread over the table decode one column of every
  chunk they fall into. Small in absolute terms, and the wrong direction.

### The cube

`npm run bench:cube`, the repository's own instrument, off and on:

| median of 5, ms, SQLite / DuckDB | 100k off | 100k on | 1M off | 1M on |
| --- | ---: | ---: | ---: | ---: |
| total | 32 / 14 | 26 / 15 | 162 / 18 | 157 / 15 |
| by_airline | 117 / 22 | 117 / 22 | 1,225 / 31 | 1,240 / 28 |
| by_airline_month_status | 268 / 98 | 262 / 104 | 2,339 / 110 | 2,368 / 105 |
| filtered_by_month | 31 / 22 | 30 / 24 | 237 / 27 | 237 / 23 |

No difference beyond noise, as predicted from the table above: the cube's
SELECT returns the aggregated rows. The PoC's counters for a whole run of
the benchmark, per engine: 24 SELECTs went lazy, with 1854 rows between
them. The switch was on and had nothing to work on.

## What it does not cover

Every case below goes to the runtime's own `select`, the whole statement,
and is counted by reason (`globalThis.osdLazyItab.read()`,
`OSD_LAZY_ITAB_REPORT=1` prints the totals at exit). Nothing is answered
half lazily.

| not lazy | why |
| --- | --- |
| a sorted or hashed target | inserting compares keys, which would make the key fields of every row at once |
| a target with a header line | not looked at |
| a row type with a nested structure, a table or an include group | the group fields of an include alias each other, and a lazily made field would not |
| an unstructured row type (`TABLE OF i`) | nothing to be lazy about |
| `INTO (a, b)` by position, `INTO` a work area or a field | not a table |
| `OPEN CURSOR` / `FETCH` | it does not go through this call (`fetchNextCursor` fills its target itself) |

`SELECT ... ENDSELECT` does go lazy: the transpiler selects everything into
a buffer table and loops over it.

The ABAP Unit suite with the switch on, SQLite: **1163 methods, 0 failed**;
1824 SELECTs went lazy (213,930 rows) and 2895 fell back (2473 not a table
target, 202 include group, 133 unstructured, 82 positional, 5 hashed).
On DuckDB, where every lazy SELECT takes the chunk path (1802 of them,
215,832 rows): 1163 methods, **3 failed, the same three that fail there
without the switch** (all in one class, a fleet proof, unrelated to this).

`ZCL_OSD_SHMEM_BENCH=>SEMANTICS` runs some forty statements on selected
tables (index and key reads, a change through a field symbol and its
absence from a copy, `ASSIGN COMPONENT`, LOOP WHERE and FROM/TO, DELETE,
INSERT, APPEND, MODIFY with and without TRANSPORTING, two SORTs, DELETE
ADJACENT DUPLICATES, APPEND LINES OF, sorted and hashed targets, INTO
CORRESPONDING and APPENDING) and returns one text of 5487 characters. It is
identical for SQLite and DuckDB, eager and lazy.

### What sharing the engine's memory cost: one silent wrong answer

The first DuckDB run of that suite had five failures, not three. Two tests
of one class select a table into an attribute in their setup, change the
table, and in the teardown delete everything and insert the saved rows
back. With the switch on the insert failed, and nothing had raised before
it.

A DuckDB vector is a **view** of its chunk's memory and does not keep the
chunk alive. The PoC held the vectors of a result and not the chunks, so
nothing stopped the collector from freeing a chunk whose rows had not been
read yet, and a row read long after its SELECT was then made of whatever
was in that memory. No exception from the read, no crash, different
values. (The mechanism is inferred from the cure: the freed memory was not
inspected.) The measurement runs had not shown it: there every row is read
within seconds of its SELECT.

The fix is one reference (`owner` in `selectChunks`, held by the chunk's
shape until its last column has been decoded), and after it the suite has
the three failures it has without the switch. It is written up here
because it is the whole risk of this idea in one example: **a copy cannot
dangle and a view can**, the failure is silent, and only a test that reads
late finds it. Anything that goes further in this direction needs such a
test before it needs a benchmark.

### What does change, and is not caught by a fallback

- **A value the type refuses raises where the field is first read**, not at
  the SELECT. Same exception, later place. A `TRY` around the SELECT alone
  would miss it.
- **Two answers of `get()` on one row are the same fields but need not be
  the same object** (the view first, the plain fields once the row is
  full). Nothing in the runtime compares them; hand-written JavaScript in
  a kernel class could.
- **The SQL trace does not see a chunk SELECT.** `selectChunks` is a new
  method of the DuckDB client and `tools/osd-sql-trace.mjs` wraps the ones
  it knows by name. A product version would go through `select` with an
  option.
- **A table that is read in part keeps its result.** Heap falls as rows
  are read in full, but one unread row of a chunk keeps that chunk. DuckDB's
  buffers are reported to V8 as external memory (206 MB for a million
  rows), so the collector does see them. Peak RSS of the whole sequence was
  the same with and without (2.7 GB on DuckDB, 2.1 against 2.2 on SQLite),
  because the sequence ends by reading everything.
- **A small SELECT gains nothing** and pays for a shape object. No
  threshold was built; a product version would want one.

## Generations and hot-swap

The decision of 2026-09-24 keeps shared state research-only because state
that outlives a call ties data to a generation of compiled classes
(`docs/warm-compile.md`, `tools/osd-hot.mjs`). Per idea:

- **(a), (b), as built: outlives the call, needs no rule.** A lazy table
  lives exactly as long as the eager table it replaces, and holds nothing
  an eager table does not hold in another form: the row type's components
  (an eager row's fields are clones of them) and an immutable result. No
  compiled class is referenced, no table of the database is aliased, so a
  later UPDATE is not visible through it and a hot swap finds it in the
  state it finds any internal table in class data. The one thing a swap
  must know is that `abap.statements.select` was replaced on the runtime
  object: a swap that keeps the runtime keeps it, a recycle runs
  `test/setup.mjs` again.
- **(c): per call, safe by its contract.** The handle is dropped in a
  `finally`, and the rows are read in place because IN is by value and the
  call is synchronous.
- **(d): outlives the call and needs a rule, which would be this.** A view
  of live storage is valid until the first of: a write to that table by
  anybody, the end of the LUW (commit or rollback), the end of the dialog
  step, or a generation whose DDIC for that table differs. At any of them
  every unread row is made in full first or the view is dead. That is
  cursor stability rebuilt in a runtime that has one work process, and
  nothing measured here asks for it: the result of a SELECT is already a
  stable thing to share.

## Against AMDP on HANA

AMDP's promise is that the data never leaves the database. **There is no
HANA timing in this file**, so there is no sentence here that says faster
or slower than AMDP.

What can be said from these numbers is which side of that promise this PoC
is on. It is on the other side: the rows still leave the engine, later and
only the ones read. The measurement that corresponds to AMDP's idea is the
pair `select_cube` against `select_all` + `abap_cube`, the same answer
computed in the engine and in ABAP:

| 1M facts, ms | SQLite | DuckDB |
| --- | ---: | ---: |
| aggregated in the engine (`select_cube`) | 1,233 | 26.5 |
| fetched, aggregated in ABAP, eager | 14,558 (12x) | 14,361 (541x) |
| fetched lazily, aggregated in ABAP, at least | 11,274 (9x) | 7,448 (287x) |

"At least": the COLLECT loop was timed on a table already read; on a
fresh lazy table it also makes three fields of every row.

Leaving the work in the engine wins by one order of magnitude on SQLite
and more than two on DuckDB, and lazy rows halve the DuckDB ratio without
changing which side wins. Sharing memory makes fetching cheaper; it does
not make fetching the right thing to do. The portable AMDP track is this
repository's answer to that question, not this.

## Is it worth pursuing

**As a general switch, not yet; as two narrow things, yes.**

- Half of the DuckDB number is not laziness. `rows` is 3.8 s of 7.4 s
  because `tools/duckdb-client.mjs` builds a row object per row and then
  maps every value of it again. How much of that a client converting
  column by column would take was not measured here; it is a change to our
  own client only, it needs no new kind of table, and it is the first
  thing to try.
- Lazy rows are the right tool for the code that selects wide and reads
  narrow: `SELECT *` followed by a loop over two fields, a table passed
  on and copied, a `lines( )`. It is the wrong tool for select-then-read-
  everything, where it costs 8 to 13% more. Without a corpus count of
  which shape real `_DPC_EXT` code has, switching it on for everything is
  a guess. The counters this PoC already has (`rowsFull` against
  `lazyRows`, per SELECT) are how to get that count from a real service.
- If it goes on, it belongs in the runtime (`rowsToTarget`, upstream),
  where the view's toll could be removed by making `Structure` itself lazy
  instead of putting a Proxy in front of it. That is a change to the
  transpiler's runtime, so it would go upstream as a small self-contained
  piece with its own numbers, or not at all.
- Nothing here argues for sharing live table storage.
