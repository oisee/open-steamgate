# Evidence-based refactoring of ABAP: smells, recipes, evidence

*Research track, branch `research/amdp-lift`, opened 2026-09-29. A proposal
and a plan, not a result: nothing below is built yet unless it names a file
that exists. Off the 0.3 beta path.*

## The idea (Alice)

We read ABAP well through abaplint and SQLScript through our own parser. Find
the fragments of ABAP programs that can be re-expressed set-based -- as ABAP
SQL, CDS or AMDP -- find them **deterministically**, transform them by
**recipes**, and give every transformation an **evidence record**, the way
evidence-based medicine grades a treatment. The same instrument tells a
developer, or an LLM writing code, that a fragment smells (a `SELECT SINGLE`
inside a `LOOP`), and a smell that is kept has to be **justified** by
evidence.

The academic name for the transformation half is *verified lifting*: QBS
(Cheung, Solar-Lezama, Madden, PLDI 2013) lifts ORM loops in Java into SQL,
Casper (SIGMOD 2018) lifts loops into MapReduce, STNG and Dexter lift to other
targets. Nothing of the kind exists for ABAP, because the evidence needs both
sides executed on the same data, and until now that took a system. This tree
runs both sides offline.

## Reviewed before written

The proposal was read by two independent reviewers on 2026-09-29 (codex
`gpt-6-astra`, and a Claude Fable critic with the tree in front of it), plus a
third review Alice brought in. They agree on three points, and the plan below
is shaped by them:

1. **The first product is an explainable analyser, not an automatic lifter.**
2. **A test never becomes a proof.** Evidence is a matrix of independent
   claims, not a ladder a recipe climbs.
3. **`pure()` and every "not modified" fact is serious analysis work.** A
   dynamic call, a field-symbol alias or a `CHANGING` parameter makes an
   obligation *unknown*; unknown is never counted as proved.

## What exists and what does not

Measured in the tree on 2026-09-29, not assumed:

| Piece | State |
|---|---|
| abaplint rules (`@abaplint/core` 2.120.55) | `db_operation_in_loop`, `unsecure_fae`, `select_performance`, `select_single_full_key`, `index_completely_contained`, `slow_parameter_passing` exist. `db_operation_in_loop` reports only the **first** DB statement per loop, ignores `SELECT ... ENDSELECT` as the outer loop, does not follow calls, and fires on loop-invariant SELECTs. `unsecure_fae` fires on every FAE; its empty-driver check is a `// todo`. |
| abaplint analysis | Typed AST, `MethodReference` with a resolved target, read and write positions on the spaghetti scope, table kinds and primary keys. **No CFG, no dataflow, no dominance** in this build. |
| `tools/osd-xref.mjs` | Object-level, from token scans. No method-level edges, no control flow. Not the fact base this needs. |
| The target side for AMDP (**eAMDP**) | **Exists.** `tools/amdp-gen.mjs` rewrites an AMDP body into `CALL FUNCTION ... DESTINATION 'AMDP'`, and `tools/amdp-destination.mjs` creates the procedure on HANA, calls it and brings the values back into ABAP types (`docs/amdp-in-hana.md`, backlog B.19). |
| Both sides on one database | **Exists.** `STG_DB=hana` (`test/setup.mjs`, `docker/compose.hana.yml`) runs the transpiled ABAP on HANA, so the original loop and the lifted AMDP read the same tables, types and seed. CHAR padding, decimal scale and engine order stop being noise; what differs is the recipe. |
| pAMDP | Parked 2026-09-25. **Not needed here** (Alice, 2026-09-29): eAMDP on HANA Express executes the target side. Its parser and IR stay relevant only to a later formal step (below). |
| SQL trace | **Exists.** `tools/osd-sql-trace.mjs` wraps the one database seam; each entry is `{n, op, sql, ms, ...}`. It counts statements per run. **It does not attribute a statement to an ABAP statement or loop yet.** |
| The regression comparator | `docs/devux-gateway-regression-contract.md` (exact JSON, ordered arrays, JSON-Pointer masks). Stable as a contract; the `.http` runner around it (#238) is not. It sees wire observations only. |
| Determinism hooks | A case-scoped ABAP clock and an ordered UUID sequence arrive with #238. |
| Corpus of real ABAP loops | **Thin.** The local SAP corpus is AMDP bodies and SEGW samples, not report or DPC loops. abapGit (public) gives 743 files: SELECT in LOOP in 18, READ TABLE in LOOP in 87, FAE in 9, BINARY SEARCH in 11, COLLECT in 7, nested LOOP WHERE in 7 (crude count, 2026-09-29). Written by people who know the recipes. |

## What "equivalent" means

Rows are not enough. A recipe preserves the **observable state** of the
fragment, and the comparison is over a canonical record of it:

- the result tables: content, **multiplicity**, and **order** where a later
  statement depends on it;
- the work area after a **miss**: a failed `SELECT SINGLE ... INTO wa` leaves
  `wa` as it was, so a LEFT JOIN with `COALESCE` can erase state carried from
  the previous iteration;
- `sy-subrc`, `sy-tabix`, `sy-dbcnt` wherever they are read afterwards;
- exceptions, and how far the fragment got before one;
- the statements sent to the database (for the performance claim, separately).

The edge cases the reviewers named, each an obligation of some recipe:

- An FAE over an empty driver ignores the **whole** WHERE, not just the
  driver-dependent part.
- FAE removes duplicates from the **projected** rows; `EXISTS` does not.
- `SELECT SINGLE` without the full key returns *any* row; a JOIN multiplies.
- `EXIT`, `CONTINUE`, a `MODIFY` of the driver and a partial prefix before an
  exception are loop-carried control.
- An `AUTHORITY-CHECK` per row disappears silently when the loop does.
- A batched read sees one snapshot where the loop saw many; a commit in
  between is observable. A recipe states a stable-snapshot assumption or
  proves it holds.

## The evidence matrix

Rows are obligations, columns are the ways one can be closed. A recipe's
level is **the profile of closed cells**, not a number.

| Column | Closes | Where it runs |
|---|---|---|
| S-DDIC | key uniqueness, buffering, domain bounds, from `*.tabl.xml` / `*.doma.xml` | static, CI |
| S-code | no write to the driver, no effect in the body, sy-subrc not read, ... -- each proved / disproved / **unknown** | static, CI |
| D-local | differential property tests on OSG (transpiled original vs rewritten), generators for empty, duplicates, misses, initial vs NULL, precision edges; `adversarialRows` in `tools/sqlscript-ir.mjs` is a start | CI |
| D-hana | the same cases with `STG_DB=hana`, and the AMDP target through eAMDP on HANA Express | local (HXE does not run in CI) |
| D-kernel | the same ABAP Unit observation test run on A4H through ADT: the only column that catches the **transpiler** being wrong about ABAP | A4H, only when Alice asks |
| P-trace | statements per run (later per loop) before and after, from `tools/osd-sql-trace.mjs` | CI |
| F-IR | both sides lowered into one relational IR and proved equal | research only |

Why the columns cannot be merged:

- **D-local is not proof.** It is "no counterexample in N draws from
  generator G on runtime R", and it carries G's version and the anomaly list
  with it. The runtime differs from a system exactly where the obligations
  are: `READ TABLE ... BINARY SEARCH` uses only the first key field
  (`@abaplint/runtime` `read_table.js`), FAE is rewritten into per-row reads
  plus SORT / DELETE ADJACENT DUPLICATES, there is no implicit MANDT, packed
  arithmetic differs on several axes, `COLLECT` has no overflow check
  (`ANORMALIES.md`). An obligation the anomaly list touches needs D-kernel.
- **D-hana checks the target, not the source.** HXE says what the SQL does;
  it says nothing about what the original ABAP does on a system.
- **F-IR is mostly circular.** The relational IR fits the SQL side. Lowering
  `LOOP + SELECT SINGLE + READ TABLE` into a join **is** the lift. ABAP
  internal tables have no formal semantics to verify a loop invariant
  against; `ANORMALIES.md` is 1700 lines of "measured, not specified". What
  F-IR can honestly do: prove the rewritten SQL equal to a reference SQL
  (FAE as `IN` against a JOIN), under bag semantics, without ORDER, LIMIT,
  CHAR trimming or decimal scale. Nothing about the loop.

**An evidence record** is a file, not a word: recipe id and hash, fragment
hash, seed hash, generator version, runtime and database versions (HXE
version for D-hana, A4H release for D-kernel), the comparison result, the
date. `measured:<id>` in a justification (below) points at one.

## Smells, metrics, justifications

A smell is a finding with three parts, written for a human and an LLM alike:
what is wrong, which evidence would clear it, and a recipe id if there is one.
Symbolic cost (`N x lookup(M)`) is reported with its assumptions; no runtime is
estimated from syntax.

| Smell / metric | Computed from | False positives | Evidence that clears it |
|---|---|---|---|
| DB operations per loop, weighted by nesting, through calls (bounded depth) | loop structures x DB statements, `MethodReference` into the same registry | loop-invariant WHERE, bounded driver, buffered table | P-trace, or a cardinality bound from DDIC |
| Loop-invariant SELECT inside a loop | the SELECT reads no loop-carried variable | none worth naming | none: hoist it |
| FAE without a dominating empty check | FAE driver, preceding `IS NOT INITIAL` / `lines( )` (approximate dominance) | check done by the caller | the check, or a type that cannot be empty |
| Over-fetch | selected columns minus components read afterwards | whole-structure passing, MOVE-CORRESPONDING, dynamic access | receiver is a public interface |
| Key-miss read in a loop on a STANDARD table (O(n x m)) | access type, READ / LOOP WHERE positions, primary key | small tables | a size bound (domain values, bench) |
| False order confidence | BINARY SEARCH / AT NEW / DELETE ADJACENT with no SORT or ORDER BY on that key prefix before it | sorted by a callee | the SORT / ORDER BY |
| Failed-lookup state dependence | the target of a SELECT / READ read later on the miss path | intended carry-forward | a miss-after-hit test |
| Materialise then discard | a table selected and used only for a count, an existence check or a slice | reuse through aliases | full-use trace |
| Repeated SORT inside a loop | SORT with no mutation of its input in between | hidden alias mutation | alias explanation |
| Unbounded accumulation in a loop | APPEND / INSERT under a loop without a bound | contractual small input | enforced bound, memory test |
| Row-at-a-time ratio per class | SINGLE / ENDSELECT against INTO TABLE | none (trend only) | none |
| **Analysis coverage** | per candidate: obligations proved / disproved / unknown | -- | -- |

The last row is the one that decides the project: if most obligations come
out *unknown* without a control-flow graph, the analysis, not the catalogue,
is the work.

**Justifications.** A smell is silenced only by a structured justification:

```abap
" #OSG justify db_in_loop kind=bounded_driver hash=3f9a... evidence=measured:<id>
```

SAP's `"#EC CI_SEL_NESTED` is the precedent for how this gets gamed, so:

- the **kind** is from a closed list (bounded driver: type or domain proves at
  most k rows; fully buffered table read by full key; ...), never free text;
- the **hash** is of the fragment, so an edit invalidates the justification;
- the **evidence** is executed or recorded, with a threshold: a test that
  asserts nothing does not count, a missing evidence record is an error.

## Recipes

The target is the **lowest rung** that works: an ABAP-side rewrite, then ABAP
SQL (joins, CASE, CTEs, window functions from 7.5x), then CDS, then a table
function or AMDP. AMDP loses client handling, table buffering, AUTHORITY-CHECK
and AnyDB portability, so a fragment one ABAP SQL statement can express is not
lifted into AMDP.

Rung 0 -- no SQL change:

- **Prefetch into a HASHED table + READ TABLE in the loop** for `SELECT
  SINGLE` in a loop. Keeps the loop, its order and its miss handling. This is
  recipe 1. abaplint's own good example for `db_operation_in_loop` is the
  same move (an FAE prefetch, then READ TABLE in the loop), with the empty
  driver guarded by an ASSERT and the lookup on a STANDARD table.
  Obligations: driver non-empty or guarded, key unique, miss path preserved.
- Table-kind or secondary-key advice for keyed reads of a STANDARD table in a
  loop; include the cost of building and maintaining the key.
- `TRANSPORTING NO FIELDS` / `line_exists( )` where the row is unused (check
  later `sy-subrc` / `sy-tabix` use); `UP TO 1 ROWS` / `COUNT(*)` used as a
  boolean into an existence check.
- Hoisting loop-invariant reads and computations (an empty loop must not gain
  an exception or an effect).

Rung 1-2 -- ABAP SQL, CDS:

- A SELECT, then an FAE driven by its result, unmodified in between: one JOIN.
- Per-key aggregates computed in a loop: GROUP BY, or an aggregating CDS view
  (the SADL `GROUP BY` path exists here).
- `LOOP + COLLECT`, `AT NEW` / `AT END OF`: GROUP BY or window functions --
  a **family** of recipes, not one: control-break semantics, the table key
  `COLLECT` actually uses, intermediate packed arithmetic.
- `SORT + DELETE ADJACENT DUPLICATES`: DISTINCT or ROW_NUMBER, deciding which
  representative is kept.

Rung 3 -- AMDP, executed by eAMDP:

- Only where the logic is procedural or HANA-specific. `MAP_MERGE` and
  `PARALLEL EXECUTION` stay in the catalogue as entries, not as sprint work:
  the SQLScript corpus has 0 `MAP_MERGE`, and OSG has one work process
  (`tools/osd-dialog-step.mjs`), so a parallel recipe cannot be measured here.

Catalogue only, not measurable here: parallel fan-out (aRFC,
`CL_ABAP_PARALLEL`) with partition-disjoint writes, no LUW coupling,
RFC-enabled modules.

Refused, always: dynamic WHERE strings, field-symbol aliasing of the driver, a
`CHANGING` driver, dynamic calls in the body -- each reported as the reason.

**A recipe is tested on its own**, apart from any candidate: metamorphic
tests over generated programs (recipe fuzzing), and a comparator that is
mutation-tested so that a known counterexample fails it.

## The query layer

Not a new language. Two things:

1. **abaplint rules in TypeScript** for whatever is intraprocedural and
   shape-like. The AST API already is the query API, and rules go upstream
   into every ABAP CI. First candidates: `db_operation_in_loop` reporting every
   DB statement, `SELECT ... ENDSELECT` as a loop, and loop-variable
   dependence; `unsecure_fae` looking for the empty check.
2. **A fact export** from abaplint as JSON lines -- statement id, parent
   structure, kind, reads, writes, calls (resolved `MethodReference`), table
   access type and key, buffering from DDIC, source position -- loaded into
   DuckDB and queried with SQL. Recursive CTEs give the Datalog shape (call
   closure, effect propagation) with an engine already in the tree. Every
   derived fact carries its provenance and is proved / disproved / unknown;
   negation over missing information never establishes safety.

```sql
-- SELECT SINGLE in a loop that depends on the loop target, driver not written in the loop
SELECT s.id FROM stmt s JOIN loop l ON s.loop = l.id
WHERE s.kind = 'Select' AND s.single AND list_contains(s.reads, l.target)
  AND NOT EXISTS (SELECT 1 FROM writes w WHERE w.var = l.driver AND w.loop = l.id);
```

Surface patterns with holes (`LOOP AT $T ... ENDLOOP`) and pattern induction
by anti-unification of LLM-found fragments are later, and only if the fact
tables prove too awkward to write queries against.

**The LLM proposes, never proves.** It finds fuzzy candidates, drafts a query
or a recipe, explains a finding. None of that fills a cell of the matrix.

## Plan

The analyser, the observation harness and the trace are a product on their
own; the recipes are research on top of them. They are kept apart, and the
first three go first.

Product half:

1. **Fact exporter** over abaplint, run on abapGit (public) and `src/`; counts
   per shape as numbers. No SAP corpus names in tracked files.
2. **Obligation decidability** for recipe 1 over the candidates: proved /
   disproved / unknown per obligation. This is the number that says whether a
   CFG has to be built first.
3. **Upstream**: the two abaplint rule improvements, through the critic gate
   (CLAUDE.md), after running abaplint's own lint.
4. **Observation harness**: ABAP Unit through `npm run unit` writing the
   canonical state record (tables, work area, system fields, exceptions),
   compared with the regression-contract matcher once it is a module (#238).
   The same test run on A4H is the D-kernel column.
5. **Trace per loop**: attribute the entries of `tools/osd-sql-trace.mjs` to
   the ABAP statement that issued them, so "N+1 in this loop" is measured, not
   inferred. Decide first whether statement-level attribution is needed or a
   before/after total is enough for step one.
6. **Justification checker**: closed kinds, fragment hash, evidence record
   resolved.

Research half:

7. **Recipe 1**, prefetch into HASHED, on five candidates: S-DDIC, S-code,
   D-local, D-hana with `STG_DB=hana`, P-trace; one D-kernel run when Alice
   asks.
8. **One AMDP recipe** (a `LOOP + COLLECT` family member into GROUP BY) through
   eAMDP on HXE with the shared seed.
9. Recipe fuzzing on generated loops.

**Stop early if:**

- recipe 1's obligations come out more than half *unknown* without a CFG (the
  analysis is then the project);
- abapGit and `src/` give fewer than 20 candidates (no test bed until a real
  corpus exists);
- D-local and D-kernel disagree on the first A4H run for a reason already in
  `ANORMALIES.md` (fix the runtime first);
- a week of justifications shows they are all free text;
- a rung-0 rewrite gets the same gain as the lift (then the AMDP half stops,
  and the diagnostics stay).
