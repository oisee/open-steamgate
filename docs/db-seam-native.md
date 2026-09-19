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

native({sql, params, expect}) -> {rows?, rowCount?}
  sql     a statement in THIS ENGINE's dialect, sent unchanged. No rewriting,
          no folding, no trimming. The caller has already lowered it.
  params  [{name, value, type}], bound by the driver, never interpolated.
          type is an ABAP type letter plus length/decimals, because that is
          what the caller knows; the client maps it to its own.
  expect  "rows" | "none". Explicit, so a client need not guess from the text
          whether a result set is coming.
  rows    plain objects, keys exactly as the engine named them -- no
          lower-casing, no padding, no trimming. Conversion belongs to the
          caller, which is the only party that knows the ABAP target type.

defineRelation({name, sql, params, materialise}) -> handle
  A named relation the following statements may refer to. `materialise`
  false is a request to keep it as a definition (a view, a CTE the client
  splices, whatever the engine offers); true forces a temporary object.
  The client may materialise anyway and must say which it did, because the
  difference is observable (see below).

dropRelation(handle) -> void

relationKind(handle) -> "definition" | "materialised"
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
