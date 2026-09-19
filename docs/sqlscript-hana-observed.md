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
