# What HANA actually does, measured

*The engine's own answers, for the SQLScript splitter
([`sqlscript-splitter.md`](sqlscript-splitter.md)) and the conformance table.
Run on HANA Express through the AMDP sandbox, 2026-09-19. Everything here is
a measurement; where it contradicts something we assumed, the assumption is
named.*

## 1. Is an assignment to a table variable an observable barrier?

The question decides the shape of the whole intermediate representation: if
an assignment is a barrier, a lowering must materialise at each one; if it is
not, splicing is not a liberty an optimiser takes but the semantics of the
language.

The probe is three steps: a projection that can fail (`TO_INTEGER` over a
column holding one non-numeric row), a filter that removes the failing row,
and an observation.

| what was run | HANA Express answered |
| --- | --- |
| the failing cast, observed directly | **raises** `invalid number` |
| assign, then filter, then observe | **two rows**, no error |
| the same with `WITH HINT(NO_INLINE)` | **raises** `invalid number` |
| assign, then read the variable **twice** | **two rows**, no error |

**An assignment is not a barrier.** The default answer is rows: the filter is
pushed into the projection and the failing expression is never evaluated. So
a lowering that materialises every assignment would not be "faithful to
HANA" -- it would be **wrong in the expensive direction**, computing values
HANA never computes and paying for temporary tables HANA never builds.

**And the exception is a property of the plan, not of the program.** The
third row is the finding: one hint, no change to code or data, turns a
successful run into a failure. `NO_INLINE` is the documented way to ask HANA
*not* to inline, and asking produces the exception that inlining avoided.

Two consequences, and the second is uncomfortable:

- **The conformance table must compare values, not exceptions.** If HANA's
  own answer to "does this raise?" depends on a hint -- and, since inlining
  is heuristic, on the plan the optimiser happens to choose -- then byte
  faithfulness on exceptions is unattainable **for anyone, including HANA
  against itself on another day**. This was predicted as the third possible
  outcome before the probe was run, which is the reason to trust it.
- **"Materialise when a variable is read more than once" is not HANA's
  rule.** The fourth row was designed to push the optimiser towards
  materialising and did not: reading `:lt_cast` twice still produced rows
  rather than the exception. Whatever makes HANA materialise, a second read
  is not enough on its own, so our planned heuristic cannot be justified by
  calling it what HANA does.

### What this does not say

- One version of one engine, on a single-node HANA Express with small tables.
  Inlining is heuristic and the heuristic is free to differ with statistics,
  table size and release.
- It says nothing about *which* plan HANA picks, only that two plans exist
  and that they differ in whether an exception is observed.
- `#src` here is a local temporary column table, not a real application
  table; a projection over a large partitioned table may be planned
  differently.

## 2. Notes for the probes that follow

The sandbox holds its HANA session across calls, so a `CREATE LOCAL TEMPORARY
TABLE` survives into the next body and a fixed name collides with itself on
the second run -- which is how the first attempt at the table above failed,
with an error about a duplicate table name that looked like a defect in the
body under test. Every probe gives its temporary tables a name of their own.

## 3. Is the trailing blank stored at all?

fable-osd's hypothesis, 2026-09-19, and it is the cheapest thing measured all
day: the padding of a CHAR column may live in **our data** rather than in the
expressions, in which case the four conformance rows about padding are one
decision at the write boundary rather than four compatibility functions.

Measured on **A4H**, which is a real ABAP system on HANA -- not a probe of
our own writing, which is the point:

| | |
| --- | --- |
| `TADIR-DEVCLASS` in DDIC (`DD03L`) | `CHAR`, length **30** |
| `SELECT LENGTH(devclass) ... WHERE devclass = '$TMP'` | **4** |
| `SELECT COUNT(*) ... WHERE devclass = '$TMP' AND LENGTH(devclass) = 4` | **12132 rows** |

The second form matters more than the first: the predicate is evaluated in
the database, so 12132 rows come back only if HANA itself agrees the stored
value is four characters long. A value trimmed on the way out by the ABAP
layer could not satisfy a filter the database applied.

**So a real ABAP system on HANA does not store the trailing blanks**, and the
local engines' agreement with each other -- `LENGTH` 10, `'abc       |'`,
a padded column not equal to its unpadded literal -- is agreement about a
value that a real system would never have written.

### What follows, and it is cheaper than the alternative

The correct local behaviour is **not to write the padding**, rather than to
emulate trimming inside `CONCAT`, `SUBSTR`, `LENGTH` and every comparison.
One rule at the write boundary for CHAR columns, and four of the five real
conformance differences collapse on their own, leaving the arithmetic family
(browser engine only) and the refusal for casts that cannot fail.

### The limits of this one

- One column of one table on one system. The rule "ABAP CHAR is stored
  unpadded on HANA" is what the evidence supports; whether anything in the
  stack ever stores a padded CHAR deliberately is not settled by it.
- It says nothing about what our own runtime currently writes -- that is the
  thing to change, and changing it is a data-shape change, so it needs its
  own check that nothing reads the padding on purpose.

## 4. Where the padding comes from, and who reads it on purpose

The one unmeasured thing in the plan (fable-osd): "do not write the padding"
is a change of data shape, so before making it — is there anything that reads
the padding deliberately? Measured rather than reasoned about, and the answer
has two halves.

**The padding is not ours. It is the runtime's type.**

```
Character(10).set("abc")  ->  "abc       "   (length 10)
```

`@abaplint/runtime`'s `Character` pads to the declared length on assignment,
which is correct — an ABAP `CHAR(10)` *is* ten characters in memory. So every
value an ABAP program hands to a database client is already padded before any
client of ours sees it. `test/seed.mjs` says so in its own comment and pads to
match; it is following the runtime, not inventing anything.

**And something does read it on purpose — upstream.** The transpiler's SQLite
schema generator emits

```
NCHAR(n) COLLATE RTRIM
```

That collation exists precisely *because* the padded value is stored: it makes
comparisons ignore trailing blanks, papering over the difference that storing
the padding creates.

**So the rule belongs exactly where the real kernel puts it.** On A4H, ABAP
holds `CHAR(30)` padded in memory and HANA stores four characters (section 3).
A real system therefore trims on the way **to** the database, not in memory
and not in every expression. Our clients currently store what they are given,
which is the padded form, and that is the single divergence.

Consequences, stated so the cost is not discovered later:

- The change is **per client, at the write boundary** — the same place
  `trimLiterals` already trims literals in the HANA and DuckDB clients. It is
  not a change to `Character`, which is right as it is.
- Upstream's `COLLATE RTRIM` becomes harmless rather than wrong: with nothing
  padded stored, there are no trailing blanks for it to ignore.
- It is still a data-shape change, so it needs its own before-and-after on a
  real read path rather than only on the conformance fixture.
