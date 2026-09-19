# The native channel: what the database seam needs before a SQLScript
# splitter can be written

*Proposed 2026-09-19. The blocker with no owner, now owned here: the splitter
([`sqlscript-splitter.md`](sqlscript-splitter.md)) lowers a relational
expression into whatever engine is present, and the seam we have cannot carry
it. This is the contract; the implementation comes after, locally first.*

## Why the eleven methods cannot carry it

The seam (`docs/db-backends.md`) is shaped for **transpiled Open SQL**, and
that shape is wrong for a lowered plan in three separate ways:

- **`execute()` returns nothing.** It is `Promise<void>`. The only method
  that returns rows is `select()`.
- **`select()` takes ABAP SQL, not SQL.** Its contract is "a statement in
  ABAP SQL syntax", and every client rewrites it before sending: the SQLite
  client applies seven substitutions (`~` to `.`, `UP TO n ROWS` to `LIMIT`,
  `ORDER BY PRIMARY KEY`, `ASCENDING`/`DESCENDING`, and so on), and the HANA
  client folds identifiers up on the way out and down on the way back.
  Sending lowered SQLScript through it means a rewriter written for another
  language runs over it.
- **There are no bind parameters at all.** Every value reaches the database
  interpolated into the statement text. For a splitter that means each scalar
  has to be rendered as a literal, with its own type and quoting rules per
  engine -- which is the exact class of problem this project has already paid
  for twice, where a transformation that has to tell a literal from the rest
  of the statement is attempted in one pass over text.

So a splitter built on today's seam would be building a per-engine literal
renderer as its first component, and that component is a defect generator.

## The contract

Four methods beside the eleven. A client that does not implement them says so
(`supportsNative === false`) and the splitter refuses that engine rather than
degrading quietly.

```
supportsNative: boolean

native({sql, params, expect}) -> {rows?, columns?, value?, rowCount?}
  sql      a statement in THIS ENGINE's dialect, sent unchanged. No
           rewriting, no folding, no trimming. The caller has already
           lowered it.
  params   [{name, value, type, isNull}], bound by the driver, never
           interpolated. `type` is an ABAP type letter with length and
           decimals, because that is what the caller knows; the client maps
           it. `isNull: true` means SQL NULL and is the only way to say it --
           ABAP has no NULL, so "an empty CHAR(10)" and "NULL" are different
           requests and a client must not guess which was meant.
  expect   "rows" | "scalar" | "none". Explicit, so a client need not read
           the text to find out, and so a scalar does not drag a result set
           into memory.
  rows     plain objects, keys exactly as the engine named them -- no
           lower-casing, no trimming, no padding.
  columns  [{name, type}], the engine's **declared** column types. Without
           them the caller converts by guessing from the JavaScript value,
           which is precisely where this project's old defects live: blank
           padding, decimals, dates.

defineRelation({name, sql, params, materialise}) -> handle
  A named relation later statements may refer to. `materialise` is a
  **reason**, not a boolean: "scalar-read" | "dml" | "dynamic" | "no-inline"
  | "lowering-declined" | undefined (no preference). See below for why a
  reason rather than a flag.

relationRef(handle) -> string
  The identifier to splice into a statement, already quoted and escaped for
  this engine. The seam generates names; the caller only inserts them, and
  never invents one. This is the line the contract draws: **values are
  bound, identifiers are generated.** A handle is not a parameter -- a
  parameter is a value and never becomes text, while a relation reference
  must become text, at a position only the statement's author knows. Allowing
  a handle in `params` would put text substitution back inside the contract
  built to remove it, and would force the seam to understand SQL syntax in
  order to know where to put it.

relationKind(handle) -> {kind: "definition" | "materialised", reason?}
  What the client actually did, and why. A client may materialise a
  definition it was not asked to materialise; it must then say so.

dropRelation(handle) -> void
```

## The one property the contract must not hide

Measured on HANA ([`sqlscript-hana-observed.md`](sqlscript-hana-observed.md)):
an assignment to a table variable is **not an observable barrier**. A
projection that would fail never fails if a later filter removes the offending
row, and the same body **does** fail when `NO_INLINE` forces materialisation.

So `materialise` is not a performance hint -- it changes whether an exception
happens. A client that silently materialises a definition changes the meaning
of the program. That is why `relationKind` exists: the caller must be able to
find out what it got, and a conformance run must be able to record it.

It is also why `materialise` carries a **reason** rather than a boolean
(fable-osd, 2026-09-19). Recording "materialised because a scalar was read
out of it" costs nothing at the moment of the decision and saves an hour when
a difference has to be explained later: the question is never only *what*
became a table, it is *why* this one did.

It also means the caller cannot promise exception-faithfulness to anybody,
and should not try. The conformance table compares **values**.

## What this is not

- **Not a query builder.** The seam does not parse, plan or optimise. It
  carries a statement the caller has already decided on, and binds values.
- **Not upstream yet.** This is implemented first in `tools/hana-client.mjs`
  and `tools/duckdb-client.mjs`, over the eleven methods rather than instead
  of them: a client may have more methods than the runtime calls, and nothing
  but the splitter will call these. When there is working code and a
  measurement behind it, it goes to `abaplint/transpiler` as a proposal --
  with the code, not as a request.
- **Not a licence to send native SQL from ABAP.** Nothing transpiled reaches
  this channel. Its only caller is the splitter's lowering.

## Implemented, and what each engine could actually promise

| | HANA | DuckDB | SQLite |
| --- | --- | --- | --- |
| `supportsNative` | yes | yes | yes |
| values bound, not interpolated | yes | yes | yes |
| `isNull` distinct from an initial value | yes | yes | yes |
| blank padding preserved (`"a "` comes back `"a "`) | yes | yes | yes |
| `columns` carry a **declared** type | yes | yes | **no** |
| a definition stays a definition | yes | yes | yes |

The one row that differs is the honest one. SQLite has no declared type for a
column of an expression and `node:sqlite` does not report one, so the client
returns the names with an undefined type rather than inventing it from the
JavaScript value. A caller that needs the type must take it from the lowering,
which knows it. Saying "no" here is the whole reason the field exists.

The cross-join idiom of 60 corpus bodies -- a scalar carried into a set
through a one-row projection -- works on all three with the scalar as a
**bound value** rather than as text, which is what the parameters were for.

## Measured: a chain of definitions is one statement

Three `defineRelation` calls, each built on the last, none materialised, then
one `native()` over the final reference. `EXPLAIN PLAN` is unreachable through
`hdb` (the driver answers "Invalid or unsupported FunctionCode" on both the
prepared and the unprepared path), so the question was put to the plan cache,
which records what actually ran:

```
plan cache entries mentioning the chain: 1
  x1 SELECT * FROM "OSD_NATIVE"."OSD_D_..." ORDER BY "K"
```

**One entry, for the final statement only.** The three views never ran as
statements of their own: HANA spliced them. That confirms three things at
once -- definitions are not materialised behind our back, the splicing happens
at the engine, and a lowering that reports one statement is telling the truth.

(A trap met on the way, of a family this repository keeps: `_` is a
single-character wildcard in SQL `LIKE`, so `'%OSD_A_%'` matched unrelated
statements until the names were escaped. The first answer looked like eleven
plan entries and was eleven false positives.)
