# The SQLScript splitter: control moves to the host, data does not

*Baseline architecture, 2026-09-19, decided with Alice and an opus critic who
measured the engines rather than reasoning about them. This file records the
model and, just as importantly, the measurements that are still owed and the
things it deliberately does not promise.*

## What this is, and what it is not

It is **not** a dialect port. Neither DuckDB nor ClickHouse nor SQLite has a
procedural language at all, so there is nothing to port SQLScript *to*. It is
a **splitter**: the procedural half of an AMDP body is compiled to JavaScript
and runs in the application server beside the transpiled ABAP that called it;
the relational half is lowered to whatever database is present.

    control flow, scalars, loops, exceptions  →  host (our JS runtime)
    scans, joins, filters, aggregates, windows →  device (the engine)

One line: **control moves to the host, data does not.** A table variable never
becomes a JavaScript array; it is a handle to a relation that lives in the
engine.

And what it buys, stated honestly, because the motivation is thinner than the
design: AMDP already runs on HANA. This buys AMDP **where there is no HANA** —
the browser preview above all — and it buys an **oracle**, because the same
body can be run natively on HANA and split elsewhere and the two answers
compared. It does not buy a customer anything by itself: nobody wants their
AMDP to behave *nearly* like HANA. The deliverable is an instrument, not
portability.

## The execution model

A table variable is a **relation handle**, which is either a lazy plan or a
materialised temporary table. Transformations (project, filter, join,
aggregate, set operations) extend the plan without touching the database.
Execution happens only at a **semantic barrier**:

| barrier | why it is one |
| --- | --- |
| a scalar is read (`SELECT … INTO`, `RECORD_COUNT`, `IS_EMPTY`) | the value crosses to the host |
| a branch or loop depends on a database result | the host must know before it can go on |
| DML | the effect must be ordered against what reads it |
| dynamic SQL | the text names an object, so the relation must have a name |
| a non-deterministic source read more than once | one evaluation or two is observable |
| an explicit `NO_INLINE`, or a lowering we refuse to fuse | stated, not inferred |

`RECORD_COUNT` and `IS_EMPTY` appear in 62 bodies between them, and each is a
barrier as well as a round trip. **The performance measure of this design is
therefore the number of synchronisations per body, not the absence of network
latency.** Count them from the first day.

## Why lazy rather than eager, and the measurement that decides it

Eager materialisation of every assignment is the obvious way to preserve the
order in which errors happen — and it is probably **not** what HANA does.
SQLScript's optimiser inlines table-variable assignments into one dataflow by
default, which is why a `NO_INLINE` hint exists at all. If that is right, then
forcing eager execution is not fidelity; it is a divergence in the opposite
direction, and an expensive one: five assignments over a large table would
become five full materialisations where HANA built one plan. Since AMDP is
written precisely for heavy set processing, the most "faithful-looking" model
would be slowest exactly on the bodies the language exists for.

**So the model is lazy by default, with barriers.** The measurement that
settles it is one body on HANA Express: an assignment whose projection can
raise (`TO_INTEGER` over a column holding one non-numeric row), a second
assignment that filters the offending row away, and an observation of the
result. If HANA raises, an assignment is a barrier and we must materialise. If
HANA returns the row, fusion is not a liberty we are taking — it is the
semantics, and eager execution would be the bug.

**A third outcome is the likely one, and it changes what we promise.** HANA's
behaviour here is *plan-dependent*: inlining has heuristics, and the same body
can fuse or not depending on how the variable is used. If error timing is
optimiser-dependent on HANA itself, then bit-exact error fidelity is not
achievable by anyone, including HANA across two releases. The honest response
is to define **our** model, state that the moment an error is raised may
differ, and compare **values** rather than exceptions in the conformance
suite.

## The two compatibility problems, which are not one problem

Splitting host from device splits the work as well, and the smaller half is
solved once instead of per engine:

- **Host compatibility** — integer division, decimals, NULL scalars, dates and
  times, casts, comparison, exceptions, parameters. Implemented **once**, in
  our runtime, which already carries the ABAP value model: padding, character
  widths and decimal handling are solved there and come for free.
- **Device compatibility** — the same arithmetic, but **over columns**, inside
  a `SELECT`. This does not go away and it is where the measured divergence
  lives: `1/2` is 0.5 in DuckDB and 0 in SQLite; `CAST('x' AS INTEGER)` raises
  in one and returns 0 in the other. `CONCAT` (38 bodies), `SUBSTR` (33),
  `CAST` (20), `IFNULL` (13) are column expressions in the corpus, not scalar
  ones. Each backend lowers a typed plan node into its own correct form, or
  into a compatibility expression.

The relational IR must therefore carry **HANA's expected result type** on every
expression node; without it the lowering cannot choose. Those type rules are
not documented anywhere we can rely on, so they are established the same way
as everything else here: measured on the corpus, and **refused** rather than
guessed where the corpus is silent.

## What is not yet owned, and blocks everything

1. **The database seam.** Today `execute()` returns no rows, `select()` takes
   "a statement in ABAP SQL syntax" and rewrites it seven ways in the SQLite
   client, and there are **no bind parameters anywhere**. A splitter needs a
   parameterised query that returns typed rows, and a way to register or name
   a relation. Until that exists there is nowhere to send a plan. **No owner.**
2. **The front end.** Parser, binder and HANA type rules for SQLScript. There
   is no open-source grammar. This is the largest unestimated piece in the
   track and nothing in this design reduces it.
3. **The target.** The coverage curve has no cliff and a 5% hard ceiling
   (`XMLTABLE`, `HIERARCHY`). A number of bodies has to be named from outside
   the data, or the track will run on attention until attention runs out.

## The order of work

1. **One question to HANA**: is an assignment an observable barrier? (above)
2. **The value-conformance table**: the ten most frequent functions plus
   division, decimal arithmetic, NULL ordering and empty `SELECT … INTO`,
   across HANA Express, DuckDB and sql.js, compared **by value**, each row
   classified — identical natively, trivial rewrite, typed rewrite,
   compatibility expression, host-side, or cannot reproduce. It prices the
   part of the design that was assumed free.
3. **Twenty hand-built IR fixtures and their lowering**, with no parser at
   all. If the model cannot express the semantics, that is known before a
   thousand lines of parsing exist.
4. Only then the front end.

And one facility to build early because it pays for itself: the ability to run
a body **both ways** — lazy and forced-eager — and diff the results. That is
how the fusion defects will be found, and it is the same instrument as the
branch comparison in track W, one storey down.
