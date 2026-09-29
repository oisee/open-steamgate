# Verified lift: evidence-based refactoring of ABAP into set-based code

*Research track, branch `research/verified-lift`, opened 2026-09-29. A plan,
not a result: nothing below is built unless it names a file that exists. Off
the 0.3 beta path. Written from Alice's summary of the 2026-09-29 discussion
(session `osg-web-research`, reviews by codex `gpt-6-astra`, a Claude Fable
critic, and dell), with the facts checked against the tree the same day.*

Terms on first use: AMDP -- ABAP Managed Database Procedure; HXE -- SAP HANA
Express; DDIC -- ABAP Data Dictionary; FAE -- FOR ALL ENTRIES; CFG --
control-flow graph; IR -- intermediate representation; ADT -- ABAP
Development Tools. "CI" means continuous integration unless it is written as
a Code Inspector check (`CI_*`).

## 1. The frame

Find, deterministically, the fragments of ABAP that can be rewritten
set-based (ABAP SQL, then CDS, then AMDP), apply transformation recipes to
them, and present evidence that the rewrite is equivalent. In the literature
this is **verified lifting**: QBS (Cheung, Solar-Lezama, Madden, PLDI 2013)
lifts ORM loops into SQL, Casper (SIGMOD 2018) lifts loops into MapReduce,
STNG and Dexter lift to other targets. It has not been done for ABAP, because
the evidence needs both sides executed on the same data, and before this tree
that needed a live system.

The comparison with evidence-based medicine is a way to explain the idea, not
the method: medicine grades how far a finding generalises to a population,
while here every instance of a transformation is argued on its own.

**The LLM proposes, never proves.** It suggests candidates, drafts patterns,
drafts recipes, explains findings. Nothing it says fills a cell of the
evidence matrix (3.4).

Three independent reviews agreed on three points:

- The first product is an **explainable analyser** whose findings carry
  evidence, not a lifter.
- **A test never becomes a proof.** Evidence is a matrix, not a ladder.
- **`pure()` is a large piece of work of its own**, and *unknown* is never
  pure.

## 2. What exists (checked 2026-09-29)

| Piece | State |
|---|---|
| eAMDP: an AMDP body run on HANA | **Exists.** `tools/amdp-gen.mjs` rewrites every AMDP body into `CALL FUNCTION ... DESTINATION 'AMDP'`; `tools/amdp-destination.mjs` cuts out the SQLScript, creates the procedure on HANA, calls it and brings the values back into ABAP types, CHAR padding included (`docs/amdp-in-hana.md`, backlog B.19). |
| Both sides on one database | **Exists.** `STG_DB=hana` (`test/setup.mjs`, `docker/compose.hana.yml`) runs the transpiled ABAP on HANA, so the original loop and the lifted code share tables, types and seed. |
| The oracle | `tools/amdp-oracle.mjs` against HXE, and 953 lines of observations in `docs/sqlscript-hana-observed.md`. |
| pAMDP | SQLScript -> typed procedural IR -> relational IR -> SQL for HANA or DuckDB (`tools/sqlscript-*`). 399 corpus bodies, 39 compiled, no value comparison against HANA. Parked 2026-09-25; not extended by this track. |
| abaplint 2.120.55 | Typed AST, `MethodReference` with a resolved target, read and write positions on the scope, table kinds and keys. `find*` over the tree, **no matching with metavariables**. Rules: `db_operation_in_loop` (only the **first** DB statement per loop; no SELECT...ENDSELECT as a loop; no calls; fires on loop-invariant SELECTs), `unsecure_fae` (fires on every FAE; the empty-driver check is a `// todo`), `select_performance`, `select_single_full_key`, `select_add_order_by`, `cyclomatic_complexity`. All intraprocedural. |
| A CFG in abaplint | **Removed upstream.** `packages/core/src/abap/flow/` (`StatementFlow`, `FlowGraph`, with tests) was deleted in `a9bc3d5b` (2.113.206, 2025-09-20). Neither 2.120.55 nor the latest 2.120.60 has it; vscode-abaplint still lists a `dumpstatementflows` command. The old code (MIT, at `a9bc3d5b^`) is a starting point; the CFG is ours to build. Why it was removed is not known yet. |
| `tools/osd-xref.mjs` | **Object-level**, from token scans, shaped like CROSS / WBCROSSGT. No method-level edges, no reads or writes per unit, no control flow, no effect summaries. |
| SQL trace | `tools/osd-sql-trace.mjs` wraps the one database seam; an entry is `{n, op, sql, ms, ...}`. Counts per run; **no attribution to an ABAP statement or loop**. B17 (`docs/ideas.md`) is the interception layer it belongs to; #182 computes object-level reach to DB writes for the risk check, with known blind spots (a dynamic call "may write"). |
| Regression comparator | `docs/devux-gateway-regression-contract.md` is stable; the `.http` runner of #238 is not. It sees **wire** observations only. |
| gogen IR (branches `spike/go-backend`, `feat/gogen-ir-json`) | A typed, structured IR from the Go-backend spike (`tools/gogen/frontend.mjs`): `loop` / `do` / `while` / `select_loop` / `if` / `case` / `try`; jumps `exit` / `continue` / `return` / `raise`; DB nodes `select_single`, `select_loop`, `select_table`, `db_write`, ...; itab nodes `read_key`, `read_seckey`, `delete_where`, ...; `pos: {file, row}` per statement; JSON export per class with input hashes (`feat/gogen-ir-json`). **Not on `main`**: both branches fork at `9db735de` (2026-09-23), `spike/go-backend` is 237 commits ahead and 348 behind. Its README calls it "a measurement, not a product"; ADR 0004 accepts OSGo as the product runtime. Refuses what it has not measured (`Unsupported`, a caller of a refused method is refused); `CHECK` is not lowered. Coverage of a real corpus is not measured; over OSG and its libraries (821 classes) it leaves 3306 statement stubs. |
| tree-sitter grammar for ABAP | `kennyhml/tree-sitter-abap` exists (active in 2026-09); maturity not measured. |
| Corpus of real ABAP loops | **Thin.** The local SAP corpus is AMDP bodies and SEGW samples. abapGit (public) gives SELECT in LOOP in 18 files, READ TABLE in LOOP in 87, FAE in 9, BINARY SEARCH in 11, COLLECT in 7 (crude count). |

## 3. Decisions

### 3.1 Target: the lowest rung that works

The ladder is: an ABAP-side rewrite with no SQL change (rung 0), ABAP SQL
(rung 1), CDS (rung 2), a table function or AMDP (rung 3). A recipe takes the
lowest rung that works; lifting into AMDP what one ABAP SQL statement can
express makes the code worse (AMDP loses client handling, table buffering,
AUTHORITY-CHECK and AnyDB portability). AMDP is for what has no other home:
procedural logic, window functions on old releases, `MAP_MERGE`, recursion.

For the first recipe the reviewers recommend rung 0 before rung 1:

- **1a, prefetch:** `SELECT SINGLE` in an iteration -> one `SELECT ... FOR ALL
  ENTRIES` or `WHERE ... IN` into a HASHED table, `READ TABLE` in the loop.
  The loop, its order and its miss handling stay, so the equivalence
  obligations are the fewest. abaplint's own good example for
  `db_operation_in_loop` is this move.
- **1b, JOIN:** the same fragment -> one JOIN, when the loop does nothing but
  collect. More gain, more obligations (multiplicity, the work area after a
  miss, order).

Both sides of rungs 0-1 run on one engine already: the transpiler executes
the original loop and the rewrite.

### 3.2 eAMDP instead of pAMDP

An AMDP target runs on HXE directly (eAMDP, section 2). Both sides of a
differential test run on one database: the original through the transpiler
with the HANA backend, the lifted AMDP on HXE, with the same tables, types and
seed. A whole class of false differences goes away (CHAR trailing blanks
against NVARCHAR, decimal scale, order without ORDER BY); what is left is what
the recipe introduces.

pAMDP splits. Its front end (the SQLScript parser and typed IR) is needed for
the rewrite column (3.4). Its back end (SQL generation for DuckDB), the only
unverified part, stays parked. A construct outside what is supported answers
"unknown / not supported locally" and goes to HXE; pAMDP is not grown for
this track.

### 3.3 Equivalence is declared per recipe

The observable behaviour of a fragment is more than its result table. A
recipe compares what it declares:

```
equivalence: multiset | ordered | ordered_by(key)
observes: [sy-subrc, sy-tabix, sy-dbcnt, ...]
```

What can be observed: `sy-subrc`, `sy-tabix`, `sy-dbcnt` where they are read
afterwards; the **work area after a miss** (a failed `SELECT SINGLE ... INTO
wa` leaves `wa` as it was, so a LEFT JOIN with COALESCE can erase state carried
from the previous iteration -- the exact behaviour per release is taken from
measurements, not from memory); exceptions, and how far the fragment got
before one; writes to global data; the database snapshot (a batched read sees
one, the loop saw many, and a commit in between is observable).

Most silent breakages in the catalogue (section 5) are a mismatch of
equivalence relations, not a wrong transformation. The differential test
compares exactly what is declared; the test is part of the recipe.

### 3.4 The evidence matrix

Rows are obligations, columns are ways of closing one. A recipe's level is
**its profile of closed cells**, not a number; the weakest obligation bounds
what can be claimed.

| Column | What it is | Where it runs |
|---|---|---|
| S-DDIC | table key, MANDT, types, buffering, domain bounds | CI |
| S-code | purity of the body, the driver not modified, no AUTHORITY-CHECK / COMMIT, early exits -- each proved / disproved / **unknown** | CI |
| D-local | property tests on OSG; generators for empty, duplicates, NULL vs initial, precision edges (`adversarialRows` in `tools/sqlscript-ir.mjs` is a start) | CI |
| D-hana | the transpiler on the HANA backend against eAMDP on HXE, shared seed | local (HXE is not in CI) |
| D-kernel | the same ABAP Unit test on a real kernel through ADT | A4H, only when Alice asks |
| P-trace | statements per run (later per loop) before and after | CI |
| F-IR | both sides in the relational IR, equal by rewrite rules or a solver (the Cosette / SQLSolver line) | CI, research |

Only F-IR may say "proved" without quotes, and only for what it covers: for
ABAP SQL -> ABAP SQL both sides are already relational; for a loop, lowering
it into a join **is** the lift, so F-IR is circular there unless the loop is
lifted by a separate, checked step (the QBS approach). ABAP internal tables
have no formal semantics to prove a loop invariant against; `ANORMALIES.md` is
1700 lines of "measured, not specified".

The differential columns are **agreement of independent implementations**:
the transpiler gives ABAP semantics by observation, HXE gives SQLScript
semantics by observation. D-local is "no counterexample in N draws from
generator G on runtime R", and the runtime differs from a system exactly where
obligations live: `READ TABLE ... BINARY SEARCH` uses only the first key field
(`@abaplint/runtime` `read_table.js`), FAE becomes per-row reads plus SORT /
DELETE ADJACENT DUPLICATES, there is no implicit MANDT, packed arithmetic
differs on several axes, `COLLECT` has no overflow check. **D-kernel is the
only column that catches the transpiler disagreeing with SAP's kernel**; it is
a column of its own, not a variant of D-hana. An obligation the anomaly list
touches needs it.

Example: "`SELECT SINGLE` by the full primary key, as a JOIN, yields at most
one row" is closed by S-DDIC entirely; no test adds confidence to it.

### 3.5 The evidence record

HXE and A4H do not run in CI (licence, memory). So a local column is a file in
the tree, not a word:

```
recipe_hash | fragment_hash | seed_hash | generator_version | runtime | hxe_version | result | date | (reference_system_release)
```

It is what `measured:<id>` in a justification (3.7) points at, and it is the
same thing the observation harness (3.8) writes: one entity, not two.

### 3.6 Purity

The weakest part of the plan. ABAP is full of implicit effects: global data
of function groups, `sy-` fields, field symbols on globals, `EXPORT TO
MEMORY`. Transitive purity through `CALL FUNCTION` is undecidable in general.

The working boundary: `pure(U)` is derived **only positively** -- every call in
the fragment resolves to a unit whose body passes a whitelist of statements,
transitively. Everything else is "not proved", not "impure". No negation as
failure. Sprint 0 measures what fraction of candidates this cuts off.

### 3.7 Smells that must be justified

Code Inspector already has `CI_SEL_NESTED`, `CI_NOWHERE`, `CI_NOORDER`,
`CI_NOFIELD` and suppression by `"#EC`. The checks are not new. What is new:
**a suppression without resolvable evidence fails the build**, the discipline
of `.leak-allow.json`. The checks are mapped to their `CI_*` codes, which is
the entry point for people from the SAP world.

```abap
" #OSG justify db_in_loop kind=bounded_driver hash=3f9a... evidence=measured:<id>
```

`"#EC CI_SEL_NESTED` is the precedent for how a pseudo-comment gets gamed, so:
the **kind** comes from a closed list (bounded driver: type or domain proves at
most k rows; fully buffered table read by full key; ...), never free text; the
**hash** is of the fragment, so an edit invalidates the justification; the
**evidence** is executed or recorded with a threshold -- a test that asserts
nothing does not count, a missing record is an error.

A finding for a human or an LLM has three parts: what is wrong, which evidence
would clear it, and a recipe id if one exists. Symbolic cost (`N x lookup(M)`)
is reported with its assumptions; no runtime is estimated from syntax.

| Smell / metric | Computed from | False positives | Clears it |
|---|---|---|---|
| DB operations per iteration, transitive through calls, weighted by the iteration's `bound` (4.1) | iterations x DbRead / DbWrite, `call` | loop-invariant WHERE, bounded driver, buffered table | P-trace, or a bound from DDIC |
| Loop-invariant SELECT in a loop | the SELECT reads nothing loop-carried | -- | nothing: hoist it |
| FAE without an empty check | no dominating `IS NOT INITIAL` / `lines( )` | check in the caller | the check |
| Over-fetch | selected columns minus components read afterwards | structure passing, dynamic access | receiver is a public interface |
| O(n x m) | READ / LOOP WHERE on a STANDARD table without a key inside an iteration | small tables | size bound |
| False order confidence | BINARY SEARCH / AT NEW / DELETE ADJACENT with no SORT or ORDER BY on that key prefix before it | sorted by a callee | the SORT |
| Failed-lookup state dependence | the target of SELECT / READ read later on the miss path | intended carry-forward | a miss-after-hit test |
| Materialise, then count | a table selected only for a count or an existence check | reuse through aliases | full-use trace |
| Row-at-a-time ratio | SINGLE / ENDSELECT against INTO TABLE, per class | -- | trend only |
| **Analysis coverage** | per candidate, obligations proved / disproved / unknown | -- | -- |

The dynamic evidence for N+1 is the SQL trace: statements per run before and
after the recipe. A total is enough for before/after; naming *which* loop
needs attribution to the statement. Step one decides which of the two it
needs.

### 3.8 The observation harness

The `.http` comparison cannot see `sy-subrc`, `sy-tabix` or a work area. The
harness is on the ABAP side: an ABAP Unit test (through `npm run unit`, risk
level aware) writes the state into a canonical record, and the records are
compared by the regression-contract matcher once it is a module. The same
test through ADT on A4H is D-kernel. The record is the evidence record of 3.5.

**Align before building:** stoker's B18 (the `.http` contract with `@osd.*`,
the determinism core, reference records) already defines a record. The
canonical state record takes its format from there rather than inventing a
second one (dell, 2026-09-29). D-kernel runs through the vsp MCP `test`
action (ABAP Unit on A4H over ADT), which is a different path from B18's
harvest of reference results out of cluster tables; both only when Alice
asks.

### 3.9 The HXE parser: clean-room only

HXE binaries are not decompiled or inspected: the licence forbids it, and
anyone who has read that code cannot write a clean parser afterwards. The
parser is learned from outside, as now. The research variant is **grammar
inference by oracle** (Glade, PLDI 2017; Arvada): mutate programs by our
grammar, send `CREATE PROCEDURE` to HXE, and use accepted / refused plus the
error position as the signal. Everything inferred goes into
`docs/sqlscript-hana-observed.md` with its date. SAP's public SQLScript
documentation is an admissible source. This answers parser acceptance, not
semantics.

## 4. Architecture

### 4.1 Semantic categories over the abaplint AST

The first artefact of sprint 0; counting, metrics and patterns all need it,
and it is cheap. abaplint gives syntactic classes; the export adds a category
node or attribute on top (as CodeQL's abstract `Loop` class does, and as the
`CI_*` checks categorise, only available to any query).

```xml
<Iteration kind="loop_at"     bound="table:lt_items"/>
<Iteration kind="do_times"    bound="expr:n"/>
<Iteration kind="while"       bound="unknown"/>
<Iteration kind="select_loop" bound="db"/>
```

- **Iteration**: LOOP AT, DO n TIMES, DO / WHILE, SELECT ... ENDSELECT,
  PROVIDE, OPEN CURSOR / FETCH in a loop, LOOP AT SCREEN, FOR in VALUE /
  REDUCE; recursion is a cycle in the call graph. `bound` = table | expr |
  unknown | db gives a metric a weight, not only a depth. SELECT ... ENDSELECT
  is both an Iteration and a DbRead: as a DB operation it counts once (it
  fetches in packages), as an iteration it multiplies what is nested.
- **DbRead / DbWrite**: SELECT, OPEN CURSOR / FETCH, INSERT / UPDATE / MODIFY /
  DELETE on a database table, COMMIT / ROLLBACK; plus calls that reach the
  database.
- **Call**: method, form, function, CALL TRANSACTION, SUBMIT.
- **Escape**: EXIT, CONTINUE, CHECK, RETURN, LEAVE, RAISE. CHECK inside a loop
  is CONTINUE, outside one it leaves the procedure: `effect="continue|leave"`
  is computed during the export.
- **Effect**: MESSAGE, AUTHORITY-CHECK, EXPORT TO MEMORY, a write to global
  data, `sy-`. The whitelist for `pure` is the negation of this category.

In a pattern a category is the type of a metavariable:
`$L:Iteration ... $S:DbRead[single] ... $L:end` catches `SELECT SINGLE` in
LOOP AT, DO and WHILE alike, and the `bound` obligation decides which recipe
applies (loop_at over a table -> 1a / 1b; while with unknown -> smell only).

### 4.2 Fact tables in DuckDB

Interprocedural conditions and metrics are joins and aggregations, not a
Datalog engine of our own. Datalog without recursion is SQL, linear recursion
is a recursive CTE. DuckDB and sql.js are already in the stack; this is in
effect the CodeQL for ABAP that does not exist publicly.

```
stmt(id, unit, kind, category, loop_depth, parent_iter)
iteration(stmt, kind, bound_kind, bound_ref)
db_op(stmt, table, kind)            -- read | write | commit
call(from_stmt, from_unit, to_unit)  -- resolved MethodReference, not osd-xref
reads(stmt, var) / writes(stmt, var)
escape(stmt, kind, effect)
ddic_key(table, field, pos)
ddic_field(table, field, type, len)
succ(from_stmt, to_stmt, kind)      -- CFG: seq | branch | back | exit | exception
```

`call` comes from abaplint's resolved references, because `osd-xref` is
object-level. Every derived fact carries its provenance and a status of
proved / disproved / unknown; negation over missing information never
establishes safety.

```sql
with recursive reach(unit, callee, depth) as (
  select from_unit, to_unit, 1 from call
  union all
  select r.unit, c.to_unit, r.depth + 1 from reach r
  join call c on c.from_unit = r.callee where r.depth < 8
)
select s.unit, count(*) as db_ops_in_loops
from stmt s join db_op d on d.stmt = s.id
where s.loop_depth > 0
group by s.unit;
```

### 4.3 The CFG

Three views: the AST (what is nested in what), the call graph (who calls
whom), the CFG (in which order statements can run: nodes are statements,
edges are transitions, including the back edge of a loop, EXIT past ENDLOOP,
CHECK by context, TRY into CATCH).

Obligations of the form "on every path from A to B there is no X" are
statements about paths, not nesting; `... when != X` in Coccinelle is exactly
this.

**Source: decided by measurement, sprint 0.** Two candidates:

- **The gogen IR** (section 2): control constructs, DB and itab operations
  are already typed nodes with the semantics the backends execute, and a DELETE
  inside a LOOP holds its loop. Three gaps: positions are per row, not per
  statement (chained or same-line statements collide); `CHECK` is not
  lowered; which statements inside a `try` can throw is not marked (the
  conservative rule: an edge to each fitting CATCH from every call and every
  statement that can raise a runtime exception). And it refuses what it has
  not measured, so every refused method is an *unknown* for the analysis.
- **A walk over the abaplint structure tree**, which parses everything the
  corpus contains. abaplint had such a CFG (`StatementFlow` / `FlowGraph`)
  and removed it in 2.113.206 (section 2) with no reason given; the old code
  at `a9bc3d5b^` (MIT) is a start. Coverage to check: CHECK by context, EXIT /
  CONTINUE in nested loops, RAISE / CATCH, LEAVE.

The rule: if the gogen front end compiles most candidate methods of the
corpus, the gogen IR is the source and the old `FlowGraph` cross-checks it on
the overlap; if it does not, the structure-tree walk is the source and the
gogen IR enriches what it compiles. The track does not wait for OSGo to reach
`main`, and does not depend on a spike being kept.

The export is the table `succ`; an obligation `A ... when != X ... B`
compiles into "no path A -> X -> B", two reachabilities in recursive CTEs.

The back edge: "the table is not modified" concerns the whole loop; the path
`MODIFY -> CONTINUE -> header -> SELECT` through the back edge exists, and the
CFG rightly refuses the recipe. The CFG wins over the tree where the path to B
ends after X: MODIFY followed by EXIT, RETURN or RAISE. The tree refuses, the
graph accepts, and the graph is right.

Without a CFG (sprint 0) the conservative substitute is lexical: "on the path"
= every statement between A and B in the same body, all branches included. The
over-approximation is sound for "absence of X" obligations and useless for
"every path has Y".

The transpiler's JS output with a source map is a way to cross-check a CFG
(CHECK is already resolved there, every DB operation is an explicit runtime
call), not a source: the output is not a contract, it is noisy, and the source
map is line-level.

An interprocedural CFG as one graph is not needed: `succ` inside units plus
`call`; "no DB write on the path from A to B" = the statements reachable plus
the units reachable through calls, and no DbWrite in the union.

### 4.4 Languages: three syntaxes, three roles

The criterion: each fits in a head within an hour, because recipes will be
written by people from the SAP world and by LLMs, not by the authors of the
engine.

| Role | Syntax | Why |
|---|---|---|
| Human recipe format | SmPL-like semantic patch (Coccinelle) | reads like a diff; the header declares the metavariable types = categories; `-` / `+` put shape and rewrite in one text; `... when != X` are path obligations |
| Canonical intermediate form | S-expressions in the syntax of tree-sitter queries (the syntax, not the engine) | a de facto standard, captures `@x`, predicates `#eq?`; XQuery, SQL over the facts and a TypeScript unifier are generated from it |
| Executable recipe test | Refaster style: an ABAP class with `before` / `after` methods, metavariables as parameters | abaplint parses it with no preprocessor; ABAP Unit runs it on OSG and through ADT on A4H with the same inputs; recipe and differential test are one object |
| Graph conditions | Cypher (Kuzu, Node / WASM) or SQL/PGQ (SQL:2023) in DuckDB through duckpgq | graph patterns read better than recursive CTEs; duckpgq's maturity is not checked |

```
@ select_single_in_loop @
itab T; wa W; dbtab DB; field F, K, C;
@@
  LOOP AT T INTO W.
  ... when != MODIFY T
      when != DELETE T
-   SELECT SINGLE F FROM DB INTO W-F WHERE K = W-C.
  ...
  ENDLOOP.
+ " lifted: see recipe select-single-in-loop-prefetch
```

```scheme
(Iteration
  (DbRead single: true
    (Where (Eq (Field) @key (Component table: (_) @wa)))) @sel) @loop
(#eq? @wa (Iteration target))
```

```abap
METHOD before. LOOP AT t INTO w. SELECT SINGLE f FROM (db) INTO w-f WHERE k = w-c. ENDLOOP. ENDMETHOD.
METHOD after.  SELECT ... FOR ALL ENTRIES IN t ... INTO TABLE lookup. LOOP AT t INTO w. READ TABLE lookup ... ENDLOOP. ENDMETHOD.
```

Tree search with bindings: the abaplint AST as XML, XQuery through
`fontoxpath` (XPath 3.1 + XQuery 3.1, plain JS). Plain XPath struggles with
metavariable equality (`deep-equal()` exists and is clumsy) and returns no
bindings; an XQuery FLWOR returns maps. JSONPath has no ancestor axis,
deep-equal or joins. `unist-util-select` (CSS selectors over a JSON tree) is
enough for counting shapes and gives no bindings.

Not used as the engine: semgrep / ast-grep / GritQL / tree-sitter need a
tree-sitter grammar for ABAP -- one exists (section 2) but its maturity is
unmeasured, and parsing twice duplicates abaplint; semgrep's generic mode is
comby, and worse at rewriting. CodeQL has no ABAP and is not open. TXL, Rascal
and Stratego are whole transformation languages, a world of their own, on the
JVM. Comby works as ready-made text rewriting with `:[x]` if every result goes
through abaplint, but it cannot tell a SELECT in a comment from one in code.

Prolog (SWI-Prolog WASM with tabling; Tau Prolog and Trealla to check) is one
language for shape (unification is the matcher), conditions (tabled
predicates are Datalog) and rewrite (substitution): more elegant, and a new
runtime. It stays a research option for F-IR, where terms and unification beat
tables. Datalog as a library: CozoDB, Logica (Datalog -> SQL for DuckDB),
datascript.

### 4.5 The recipe format

```yaml
id: select-single-in-loop-prefetch
target: abap                # abap | abap_sql | cds | amdp
form: |                     # SmPL-like patch or the canonical S-form
  ...
equivalence: ordered        # the loop stays, so its order does
observes: [sy-subrc, sy-tabix]
obligations:
  - id: key-multiplicity
    check: sql:ddic_full_key($DB, [$K])          # S-DDIC
  - id: driver-stable
    check: cfg:no_path($L, write($T), $S)        # S-code (succ)
  - id: no-leave
    check: cfg:no_path($L, escape[effect=leave], $L.end)
  - id: body-pure
    check: sql:pure($...A, $...B)                # unknown -> not applied
  - id: empty-driver
    check: cfg:dominated_by($PREFETCH, not_initial($T))
rewrite: refaster:zcl_recipe_ssl_prefetch
tests: [empty_driving, missing_key, duplicate_key, trailing_blanks, miss_after_hit]
evidence: []                                     # records of 3.5
```

The form finds and binds metavariables; the conditions take the bindings and
ask DuckDB; the rewrite substitutes; abaplint checks that the result parses;
ABAP Unit runs before / after. A recipe is also tested on its own, apart from
any candidate: metamorphic tests over generated programs, and a comparator
that is mutation-tested so that a known counterexample fails it.

## 5. Catalogue and its traps

| Shape | Target | Equivalence | Obligations (where it breaks silently) |
|---|---|---|---|
| SELECT SINGLE in an Iteration | 1a prefetch + HASHED; 1b JOIN | 1a ordered; 1b ordered_by(key) | key multiplicity (SINGLE takes one row, a JOIN gives N); explicit MANDT (an AMDP has no implicit client); the work area after a miss; empty driver in the prefetch |
| FAE | JOIN / EXISTS | multiset | an empty driver ignores the **whole** WHERE; FAE removes duplicates from the projected rows, EXISTS does not |
| LOOP + READ TABLE ... BINARY SEARCH | LEFT JOIN | ordered | NULL vs initial -> COALESCE; is the table really sorted |
| LOOP + COLLECT, AT NEW / AT END | GROUP BY / window | ordered_by(group) | a family, not one recipe: control-break semantics, the key COLLECT uses, packed overflow, group order |
| SORT + DELETE ADJACENT DUPLICATES | DISTINCT / ROW_NUMBER | ordered | stability, which row is "first" |
| per-row call of a pure function | MAP_MERGE / PARALLEL EXECUTION | multiset | read-only only; 0 MAP_MERGE in the SAP corpus and one work process in OSG, so catalogue only |
| any | -- | -- | CHAR trailing blanks vs NVARCHAR; decimal scale (`dec_mult` was measured); AUTHORITY-CHECK lost silently; early exits from the body |

Also rung 0, and not about SQL: a table-kind or secondary-key advisor (with
the cost of building and maintaining the key), `line_exists( )` or
`TRANSPORTING NO FIELDS` where the row is unused, hoisting loop-invariant
work, early exit from a search. Catalogue only, not measurable here: parallel
fan-out through aRFC or `CL_ABAP_PARALLEL`.

Refused, always, with the reason reported: dynamic WHERE strings,
field-symbol aliasing of the driver, a `CHANGING` driver, dynamic calls in
the body.

Pattern induction by anti-unification is a research item, not a mechanism:
too general a pattern catches everything, too narrow one catches one file. The
working loop is: the LLM proposes candidates, a human writes the pattern, a
count over the corpus shows it catches what it should and nothing else.
Anti-unification drafts a pattern, no more.

## 6. Where it meets the extension track

- The regression comparator is the before / after bench (the contract, not
  the #238 CLI).
- Smells as diagnostics in the extension, with a CodeLens "justify / apply
  recipe / show evidence" beside the risk-level grouping.
- The reference system harvested through ADT gives seed data and the kernel
  oracle.
- B17 and the SQL trace give the dynamic evidence for N+1.
- Later: a page that shows where old and new code diverged, over the sql.js
  preview.

## 7. Scope and priority

Five things: the analyser, the observation harness, the SQL trace
attribution, eAMDP use, the recipes. The first three are a product on their
own (a loop "smell -> evidence -> record" with no lifting at all); the last
two are research on top. They are kept apart, or a `research/*` branch starts
pulling extension features into itself.

A branch, not a repository: everything that produces evidence (runtime,
oracle, transpiler, trace) lives here. The fact exporter and query layer are
one package with no dependency on OSG, to be split out or offered to abaplint
once its API settles.

From the SAP corpus, only shapes and numbers go into tracked files; names only
from the open corpus.

## 8. Sprint 0: measure first

1. Semantic categories (4.1) and fact tables in DuckDB (4.2) for abapGit,
   `src/`, and the SAP corpus (counts only).
2. Candidates per shape; the share whose obligations close from DDIC and
   code; the share with provable purity. These three numbers decide whether
   the query layer is worth building.
3. The CFG: measure the gogen front end's coverage of the candidate methods
   (abapGit, `src/`) beside the three numbers of item 2, uncovered methods
   counted as unknown; choose the source by the rule of 4.3; export `succ`
   (from the gogen IR JSON if it wins); move "absence of X" obligations from
   lexical "between" to reachability. How the coverage is counted:
   - **Refusal propagation off.** gogen refuses a method that calls a refused
     one; for an intraprocedural CFG the callee is an opaque `call` node with
     unknown effects, so propagation would make gogen lose unfairly. Per
     candidate: the fragment's own statements lowered, callees unknown.
   - **One ratio per run, with its denominator**: stubs / statements seen, over
     everything and over candidate methods only. The README's 3306 stubs over
     821 classes has no denominator.
   - **Read the IR JSON documents** (`feat/gogen-ir-json`), never call
     `frontend.mjs`: the track then depends on a document format, not on a
     spike 348 commits behind `main` being merged or rebased.
   - **`CHECK`**, if lowered: CONTINUE inside LOOP, DO, WHILE and SELECT ...
     ENDSELECT, leaving the procedure outside them. `CHECK` directly in `LOOP
     AT SCREEN` and in report event blocks is measured on A4H before it is
     relied on.
4. The observation harness: ABAP Unit -> canonical record -> the regression
   matcher; the evidence record format (3.5); the checker that
   `#OSG justify ... measured:<id>` resolves; the record format aligned with B18 first.
5. Recipe 1a (prefetch) in the format of 4.5, up to D-hana with the
   transpiler on the HANA backend, the Refaster class as its test; then 1b
   (JOIN).
6. One AMDP recipe (a `LOOP + COLLECT` family member into GROUP BY) through
   eAMDP on HXE with the shared seed.
7. Upstream, through the critic gate: `db_operation_in_loop` reporting every
   DB statement, SELECT ... ENDSELECT as a loop, loop dependence;
   `unsecure_fae` checking the empty driver.

pAMDP value parity is not on the list; the SQLScript parser is needed only
when F-IR is reached.

## 9. Stop early if

- recipe 1's obligations come out more than half *unknown* without a CFG (the
  analysis is then the project);
- abapGit and `src/` give fewer than 20 candidates (no test bed until a real
  corpus exists);
- D-local and D-kernel disagree on the first A4H run for a reason already in
  `ANORMALIES.md` (fix the runtime first);
- a week of justifications shows they are all free text;
- a rung-0 rewrite gets the same gain as a lift (the AMDP half stops, the
  diagnostics stay).

## 10. Not checked yet

- Why abaplint removed `StatementFlow` / `FlowGraph`: the release is titled
  "bugfixes" (#3701) and removes 1334 lines with the language server's
  `dumpStatementFlows`; nothing in the abaplint organisation replaces it.
  Only Lars can say; ask only if it matters. What the old code covered is
  still to read.
- The gogen front end's coverage of a real corpus (sprint 0, item 3).
- Whether the gogen IR becomes the long-term IR: it follows OSGo (ADR 0004)
  and is not on `main`.
- The maturity of `kennyhml/tree-sitter-abap`.
- duckpgq (SQL/PGQ in DuckDB).
- Tabling in Tau Prolog and Trealla.
- The exact work area after a failed `SELECT SINGLE`, per release: from
  measurements on A4H, not from memory.

## 11. References

- Verified lifting: QBS (Cheung, Solar-Lezama, Madden, PLDI 2013); Casper
  (SIGMOD 2018); STNG; Dexter.
- SQL equivalence: Cosette; SQLSolver.
- Grammar inference by oracle: Glade (PLDI 2017); Arvada.
- Pattern languages: Coccinelle SmPL; Refaster (Google); IntelliJ Structural
  Search and Replace; OpenRewrite (YAML recipes); tree-sitter query syntax;
  comby.
- Engines: fontoxpath; unist-util-select; jsonpath-plus; Kuzu; duckpgq;
  CozoDB; Logica; datascript; SWI-Prolog WASM; Tau Prolog; Trealla.
- Transformation languages, for comparison: TXL; Rascal; Stratego / Spoofax;
  CodeQL.
