# Portable AMDP / SQLScript runtime

Branch plan for `feat/amdp-portable-ir`, started from `integration/devux` on
2026-09-21.

## Outcome

An ordinary ABAP Unit test calls an ordinary `FOR HDB LANGUAGE SQLSCRIPT`
AMDP method. In an off-stack OSG runtime the unchanged SQLScript body executes
without HANA and returns the same supported values and types. HANA remains a
native target and a differential oracle, but it is not required to run the
supported test.

The first proof is deliberately small and end to end:

```text
ZCL_OSD_AMDP_DEMO=>SQUARES
  original SQLScript body
    DECLARE + scalar assignment + WHILE
    table assignment + UNION ALL
        ↓
  portable AMDP runtime
        ↓
  PostgreSQL
        ↓
  original ABAP call and assertions
```

No HANA connection or fallback may be available during this test. A refusal
is a valid result for an unsupported construct; silently returning an
approximation is not.

## What already exists

This is not a second compiler project. The repository already contains the
lower half of the design:

- `tools/amdp-extract.mjs` extracts AMDP signatures and original bodies.
- `tools/amdp-gen.mjs` rewrites only the generated transpiler input and keeps
  the repository's ABAP source unchanged.
- the `AMDP` RFC destination is already the dispatch seam used by transpiled
  ABAP;
- `tools/sqlscript/lexer.mjs` and `tools/sqlscript/expressions/index.mjs`
  parse the declarative core and recognise `DECLARE`, scalar assignments,
  `IF` and balanced `WHILE` syntax;
- `tools/sqlscript/to-ir.mjs` binds and types relational plans, but currently
  refuses the imperative statements by name;
- `tools/sqlscript-ir.mjs` carries typed relational operations, schemas,
  parameters and effects;
- `tools/sqlscript-lower.mjs` lowers those plans strictly for HANA, DuckDB and
  SQLite;
- `native()`, relation handles and the fused/eager comparison instrument
  already exist for the supported engines;
- a measured HANA oracle, portable conformance cases and explicit refusal
  tests already protect many expression semantics;
- `ZCL_OSD_AMDP_DEMO=>SQUARES` is exactly the first imperative example we
  need.

The missing pieces are therefore bounded:

1. PostgreSQL support at the parameterised relational seam.
2. A typed procedural IR above the existing relational IR.
3. An interpreter for that procedural IR.
4. Routing an AMDP call to the native HANA executor or portable executor by
   explicit policy.
5. One shared execution context for ABAP SQL and nested AMDP work.

Two existing test behaviours must also be removed from this proof. The AMDP
unit test currently returns immediately when `sy-dbsys <> 'HDB'`, and
`UnitRun.runDetached()` currently changes every non-DuckDB child to
`STG_DB=file`. A green result while either behaviour is active does not prove
portable PostgreSQL AMDP execution.

## Architecture

```text
AMDP source + extracted signature
              │
              ▼
    SQLScript parser and binder
              │
       typed procedure IR
       ├─ scalar/control nodes ───────► TypeScript interpreter
       └─ relational nodes ──────────► existing relational IR
                                                │
                                                ▼
                                     backend-specific lowering
                                                │
                                   PostgreSQL / DuckDB / ...
```

JavaScript/TypeScript is the execution platform, not the semantic IR. The IR
must preserve source spans, SQLScript types, explicit conversions, nullable
state, reads/writes, relation dependencies and observable barriers.

The relational IR remains the only input to dialect lowering. Procedural
nodes must not contain generated SQL strings.

### Initial procedural nodes

The first slice needs only:

- `procedure(parameters, locals, body, outputs)`;
- `declareScalar(name, type, initial?)`;
- `assignScalar(name, expression)`;
- `assignRelation(name, relationPlan)`;
- `while(condition, body)`;
- `returnRelation(name | relationPlan)`;
- source span and inferred/effective type on every executable node.

`IF`, nested calls, handlers and data-changing statements are reserved node
kinds, not half-implemented behaviours. Encountering one before it is
implemented produces a typed `UNSUPPORTED_SQLSCRIPT` diagnostic with its
source location.

### Values and relation versions

Scalar expressions are evaluated according to SQLScript types, not normal
JavaScript coercion. The runtime captures the scalar value used by each
relational assignment at the moment that version is created.

A table variable is a binding to an immutable relation version, not a mutable
JavaScript array and not an untyped saved SQL string. This makes the loop in
`SQUARES` unambiguous:

```text
et_square@0 = empty typed relation
et_square@1 = union(et_square@0, row(lv_i = 1))
et_square@2 = union(et_square@1, row(lv_i = 2))
...
```

The backend may later fuse, materialise or replace these versions with a more
efficient recursive plan, but the binding semantics do not change.

### Execution context

Every ABAP test run owns one explicit context:

```text
backend identity
database connection / transaction
logical-to-physical catalogue
AMDP procedure registry and call stack
temporary relation registry
session values, clock and deterministic trace
```

ABAP Open SQL and every AMDP called by that ABAP execution must use the same
context. A fixture written on one connection and an AMDP read on another is
not a valid passing test. Committing to make it visible would also be wrong.

The first slice is read-only from the AMDP point of view, but it still shares
the caller's connection and transaction.

Session identity is explicit data in this context. `CURRENT_USER`,
`CURRENT_SCHEMA` and literal-key `SESSION_CONTEXT` are captured into bound
parameters before relational lowering. They never inherit the user or schema
of DuckDB/HANA merely because that engine executes the final statement. A
missing fact refuses before database I/O; current date/time remain reserved
until a deterministic clock contract is measured.

## Backend contract

A backend capability has three honest outcomes:

1. native equivalent with measured semantics;
2. an explicit compatibility lowering/helper with tests;
3. `UNSUPPORTED_SQLSCRIPT` before execution.

There is no best-effort mode in ABAP Unit.

The minimum portability proof deliberately uses two complementary tracks:

1. native HANA SQLScript versus the portable procedural runtime using plain
   relational SQL on that same HANA database;
2. the same typed procedural IR on DuckDB, called by the unchanged ABAP Unit
   while no HANA fallback is available.

The first isolates our parser/control/runtime from database-dialect changes.
The second is an embedded but strongly typed proof that the architecture
really crosses a database boundary. Passing both does not claim that every
function is portable: each additional backend still has to implement or
explicitly refuse every capability through the conformance layer.

SQLite/browser execution and further PostgreSQL integration are explicitly
parked until both minimum tracks are green. The existing PostgreSQL seam is
retained as finished infrastructure, but it is not on this milestone's
critical path. SQLite is not the semantic authority for fixed decimals,
casts or database-specific error behaviour.

The current inventory shows one prerequisite: PostgreSQL is an OSG runtime
client, but SQLScript lowering currently has only `hana`, `duckdb` and
`sqlite` dialects, and the PostgreSQL client is not yet wired to the same
parameterised `native()` relation seam. That adapter is milestone P0.

## Milestones

### P0 — PostgreSQL device seam

- add a strict `postgres` lowering dialect;
- expose parameterised `native()` and relation lifecycle operations on the
  PostgreSQL client without interpolating values;
- verify typed empty relations, `UNION ALL`, concatenation, multiplication,
  bound scalar values and deterministic row reads;
- add PostgreSQL rows to the relevant conformance table;
- prove unsupported operations fail before a query with changed meaning is
  sent.

Acceptance: the existing declarative end-to-end body executes on PostgreSQL
and agrees by value and output schema with the established local engines.

### P1 — Typed procedural IR

- lower `DECLARE`, scalar assignment and `WHILE` into typed nodes;
- add `WHILE` to the grammar before lowering it;
- retain the existing relational binder rather than duplicate it;
- derive host-parameter types from the extracted AMDP signature instead of
  the binder's current temporary `STRING` default;
- add immutable relation bindings and scalar snapshots;
- implement an interpreter with an explicit step limit and useful trace;
- define integer, string concatenation and comparison behaviour needed by
  `SQUARES`; refuse all unmeasured coercions.

The empty initial relation in `SQUARES` must take its output schema from the
extracted `ET_SQUARE` signature. Inferring only from `0, '', 0` would lose the
declared character width (and can incorrectly invent `C(0)`).

Acceptance is two-stage: parsing and interpreting the original `SQUARES`
body first agrees with native SQLScript while its relational work uses plain
HANA SQL, then yields the same four typed rows on DuckDB for `iv_count = 4`
with no HANA code path loaded. SQLite and PostgreSQL follow only after both
of these tracks are green.

### P2 — AMDP dispatch and ABAP Unit

- select `native-hana | portable | refuse` through an explicit execution
  policy, never an implicit fallback;
- route generated AMDP RFC calls to the portable executor;
- map ABAP input/output values at one typed boundary;
- share the active ABAP database execution context;
- let detached Unit runs preserve an explicitly selected PostgreSQL backend
  while continuing to isolate ordinary file-backed test runs;
- remove the obsolete `sy-dbsys = HDB` skip from the test; the AMDP source
  and call remain unchanged;
- replace the existing `READ TABLE ... INDEX 3` assertion with a key-based
  assertion for `ID = 3`: the AMDP has no final `ORDER BY`, so row position
  is not part of its contract and the bridge must not invent one;
- record an execution trace proving `engine=postgres`, `fallback=false`.

Acceptance: the repository's ABAP Unit call to `SQUARES` passes against
PostgreSQL while HANA credentials and modules are unavailable. Cases cover
`0`, `4`, an empty typed result and the first measured integer boundary.

### P3 — Composition and real data

- fixture written through ABAP SQL and read by AMDP in the same uncommitted
  context;
- join and aggregation over that fixture;
- nested AMDP call with a bounded call stack;
- rollback leaves no test data behind.

Acceptance: unchanged ABAP assertions observe the AMDP result and the test
can prove it used the caller's transaction.

### P4 — Differential corpus

- store small, synthetic programs with inputs, output values, output types
  and expected errors;
- compare portable PostgreSQL execution with versioned HANA observations;
- never include proprietary source in the repository;
- distinguish value differences, type differences, ordering claims,
  unsupported constructs and infrastructure failures.

HXE or another authorised HANA can refresh observations when available, but
the recorded corpus runs offline.

### P5 — DuckDB and optimisation

- run P1–P4 through DuckDB;
- move accidental PostgreSQL assumptions into backend capabilities;
- optimise only after the two portable engines agree: fuse plans, reduce
  materialisation and batch loop work without changing relation versions.

Substrait may later represent the relational half at an interchange boundary.
It is not needed to validate the first runtime and does not represent the
procedural half.

## Test rules

- Compare rows only with an explicit ordering contract. Without `ORDER BY`,
  compare the relation as a bag with duplicate counts and compare schemas
  separately.
- Preserve SQL `NULL` inside SQLScript. Convert to ABAP initial values only at
  the typed AMDP/ABAP boundary where that conversion is required.
- An empty table still has a schema.
- `UNION ALL` preserves duplicates.
- Every portable built-in or coercion has a conformance case.
- A test for the portable route makes HANA physically unavailable and asserts
  the chosen backend in the trace.
- No test passes by skipping on `sy-dbsys` once its construct is supported.
- Resource limits are part of the runtime contract: maximum steps, nested
  calls, rows and temporary relation bytes.

## Non-goals of the first vertical

- all SQLScript constructs or HANA libraries;
- reproducing HANA's optimiser, parallelism or physical plans;
- translating procedures into PL/pgSQL;
- executing table relations as JavaScript arrays;
- transparent cross-database work inside one ABAP LUW;
- approximate decimal, cast, `NULL` or error behaviour;
- dynamic SQL, data-changing AMDP, autonomous transactions, cursors, arrays
  or exception handlers;
- making SQLite the decimal reference;
- requiring a live D15, A4H or HXE to run the supported offline tests.

## Immediate implementation order

1. Pin the current `SQUARES` source and signature as the acceptance fixture.
2. Add the PostgreSQL native seam and relational lowering with focused tests.
3. Introduce procedural IR types independently of execution.
4. Lower and interpret only the constructs present in `SQUARES`.
5. Compare native HANA SQLScript with portable control plus plain HANA SQL.
6. Connect the existing `AMDP` destination to the portable DuckDB executor.
7. Run the ABAP Unit with HANA disabled and publish the trace beside the test
   result.

This order keeps every commit executable and makes the first new language
feature answer a user-visible question rather than merely increasing parser
coverage.

## Progress

### 2026-09-21 — P0 device seam

Implemented the initial PostgreSQL lowering and the parameterised native
channel, including:

- numbered placeholders with explicit PostgreSQL types;
- packed decimals bound as text rather than rounded through JavaScript;
- `DUMMY` represented as a one-row source rather than a physical table;
- native work on the caller's transaction connection, fenced by a savepoint;
- fail-stop behaviour after a poisoned COMMIT;
- bounded, collision-resistant relation names and diagnostic cleanup;
- a live test using a session-local temporary fixture rolled back with the
  transaction.

The live PostgreSQL run passed 14 tests, including the relational pipeline,
typed multiplication, concatenation, decimal division, transaction reuse and
bound values. Functions measured only on the earlier HANA/DuckDB/SQLite
matrix are explicitly refused on PostgreSQL until PostgreSQL gains its own
conformance rows. P1 (procedural IR) is next.

### 2026-09-22 — P1a procedural semantics

The first P1 slice now fixes the execution semantics independently of parser
binding:

- typed procedure, scalar declaration/assignment, relation assignment and
  `WHILE` nodes;
- SQL `NULL` preservation and strict INTEGER/boolean boundaries;
- immutable table-variable versions and assignment-time scalar capture,
  including parameters inside window partitions;
- explicit host-step, expanded-plan, nesting and bound-parameter budgets;
- refusal of `NO_INLINE` until a real materialisation barrier exists, and of
  non-deterministic relations in this initial subset;
- one final parameterised database statement with a trace that names the
  engine and states `fallback=false`.

The hand-built `SQUARES`-equivalent IR passes on DuckDB, including zero rows,
four rows, NULL input, integer overflow and adversarial plan growth. The
grammar retains a nested, balanced `WHILE` tree and the old relational binder
refuses it by name instead of flattening it. P1 is not complete yet: the next
slice maps the parser tree and extracted AMDP signature into these nodes,
then runs the original body on PostgreSQL.

### 2026-09-22 — P1b original source on HANA and DuckDB

The source of `ZCL_OSD_AMDP_DEMO=>SQUARES` now travels unchanged through
AMDP extraction, the SQLScript parser, the shared expression/relational
binder and the procedural IR. The same compiled program has two green paths:

- native HANA SQLScript and portable host control plus plain HANA SQL return
  the same values for zero and four iterations;
- DuckDB returns the four expected rows and the correctly shaped empty
  result while the trace states `engine=duckdb` and `fallback=false`.

The live HANA probe uses a collision-resistant disposable procedure, removes
only an object created by that run, and refuses to start if
`STG_DB_FRESH=1` could reset a schema. Numeric HANA placeholders now carry
explicit casts so that one INTEGER scalar is not reinterpreted as text merely
because it appears in concatenation.

This remains a deliberately narrow semantic claim: exactly one structured
OUT/RETURNING table, INTEGER scalar inputs and locals, assignments and
`WHILE`. Extra outputs, INOUT, narrower scalar declarations, trailing result
sets and unresolved named types are refused rather than widened or dropped.

### 2026-09-22 — Clean-room corpus baseline

A two-room process converted four restricted input archives into an
independently authored synthetic corpus. Repository fixtures contain no
source excerpts, original identifiers, literals, paths, fingerprints or
statement sequences. Ten synthetic AMDP methods cover the generalized shape
of table parameters, joins, subqueries, grouping/windows, control flow,
set difference, approximate search, arrays, session values and optional or
scalar returns.

The baseline initially reported `0 supported / 10 named refusals / 0
crashes`: it prevents parser coverage from being mistaken for runtime
support. Typed table inputs are represented as relation bindings rather than
JavaScript arrays, and their schemas reach the existing relational binder.
The next corpus slices remove refusals one semantic capability at a time;
unknown session tokens and every unimplemented feature remain loud refusals.

### 2026-09-22 — Explicit session identity and context

The ledger reaches `7 executable / 3 named refusals / 0 crashes`.
`identity_cells` and every branch of `transform` execute on DuckDB and agree
with native SQLScript versus portable ordinary SQL on HANA. Session values
are typed IR nodes captured from the AMDP execution context; a raw node is
refused at the dialect boundary, preventing an adapter from silently using
its own database identity. The generated demo, including original `SQUARES`,
therefore reports `8 executed / 0 partial / 3 refused`.

### 2026-09-22 — Typed STRING inputs

ABAP `STRING` input parameters now retain an exact typed scalar across source
extraction, procedural IR, host capture and database binding. An omitted
`OPTIONAL STRING` becomes the ABAP type-initial empty string before SQLScript
execution; an explicitly supplied SQL NULL remains NULL, and a non-string
runtime value is refused before database I/O. A disposable native HANA
procedure and portable plain-HANA execution agree for explicit empty,
non-empty and NULL values, while DuckDB exercises the same source and binding
path. The omitted portable argument is separately proven to become the ABAP
initial empty string; the SQL procedure oracle receives that initial value
explicitly because it cannot model ABAP call-site omission.

The supported use is intentionally narrower than “all host string
semantics”: STRING may be captured into a relational expression, but the host
interpreter refuses STRING-dependent assignment, comparison and control flow.
It also accepts only the exact scalar type shapes `{abap: "I"}` and
`{abap: "STRING"}` from public hand-built IR. This prevents JavaScript number
coercion or ordering from silently defining SQLScript behaviour.

This is deliberately an input-boundary milestone, not an array claim. It
advances `search_cells` to its measured `COALESCE`/fuzzy-search boundary and
`expand_values` to its table-function boundary. The next array slice will use
the actual SQLScript `ARRAY` declaration and `UNNEST ... WITH ORDINALITY`
surface; the synthetic `array_expand` spelling will not be presented as a
native HANA feature.

### 2026-09-22 — P1i fixed INTEGER ARRAY expansion

The tracked `expand_values` method now uses real SQLScript rather than the
old parse-only placeholder: a top-level `INTEGER ARRAY = ARRAY(...)`, an
assignment from `UNNEST(:array) WITH ORDINALITY AS (value, position)`, and an
ordered read of that table variable. The parser retains ARRAY and UNNEST as
named constructs; the procedure compiler turns the fixed constructor into a
typed immutable relation, so the database still performs the relational
work rather than receiving a JavaScript row array.

The direct source agrees between native HANA SQLScript, portable ordinary
HANA SQL and DuckDB for `[2, 2, NULL, 5]`: duplicates remain, NULL remains,
and positions are one-based. The portable trace reports one database
statement and no fallback. Empty constructors, non-INTEGER elements, unknown
arrays, conditional declarations, multiple arrays, mutation, concatenation
and `ARRAY_AGG` remain named boundaries. The demo advances to `9 executed / 0
partial / 2 refused`.

### 2026-09-22 — P1j measured textual COALESCE widening

`COALESCE` no longer requires byte-for-byte identical text type descriptors.
Two fixed character operands produce the greater declared length; if either
operand is ABAP STRING, the measured result remains STRING. This is a narrow
text rule, not generic implicit conversion: text/numeric mixing, extra
arguments and decorated/windowed calls remain named refusals.

A disposable native HANA procedure, portable ordinary HANA SQL and DuckDB
agree for a NULL fallback and a supplied non-empty STRING. This advances the
tracked `search_cells` body past null substitution to its optimizer-hint
policy boundary; mapping and approximate scoring remain separate milestones.

### 2026-09-22 — P1k real plan hint and mapping surface

The tracked search case no longer relies on invented spellings. Its plan-only
hint is the already allowlisted `NO_USE_HEX_PLAN`, which the portable path
drops by name while unknown hints still refuse. Its default mapping is now a
real SQLScript `MAP(...)`, represented by the existing typed CASE IR rather
than a backend-specific function call. The whole method therefore compiles;
execution still refuses before SQL because approximate score typing and
matching semantics have not been defined. The demo count intentionally stays
`9 executed / 0 partial / 2 refused`.

### 2026-09-22 — P1l simple search baseline; fuzzy profiles deferred

[ADR 0002](adr/0002-portable-and-native-fuzzy-text-profiles.md) separates two
contracts that must not be reported as interchangeable. The first is a small
`portable-deterministic` profile whose normalisation, score, classification
and ordering agree exactly across supported backends. The second is
`native-fuzzy`: backend scores may differ, while a published synthetic corpus
enforces behavioural invariants, top-K recall, precision, false-positive
bounds and deterministic OSG-owned tie breaking. Implementing those profiles
is now explicitly deferred in `docs/backlog.md` until the remaining general
corpus milestones are complete.

To avoid making specialised fuzzy work a gate, the synthetic `search_cells`
body now uses an honest `simple-search-v0`: over its measured ASCII fixture,
`LOWER` plus `LOCATE`, a CASE score of 1000 for equality and 700 for
containment, with NULL rows retained at zero. Empty and NULL queries select no
non-null rows. The original tracked body executes in one statement on DuckDB
and agrees value-for-value between native SQLScript and portable ordinary SQL
on HANA. This is not declared a portable linguistic profile. The demo advances
to `10 executed / 0 partial / 1 refused`; the remaining refusal is
`control_rows` cursor/block execution.

### 2026-09-22 — P1m complete showcase: unused cursor and sequential block

The original `control_rows` body now moves the demo to `11 executed / 0
partial / 0 refused`. HANA itself first rejected the synthetic spelling
`DECLARE name CURSOR FOR`; the oracle established and the grammar now requires
the canonical `DECLARE CURSOR name FOR`. The old reversed spelling has a
negative parser test so the portable frontend cannot remain accidentally
broader than SQLScript.

This is deliberately narrower than general cursor support. The declaration
must be top-level, unconditional and unused. Its query is limited to a direct
projection of known columns from one table input and is fully bound and
type-checked; functions, predicates, joins and set operations refuse before
the unopened resource is erased. Any reference to the cursor refuses;
`OPEN`, `FETCH` and cursor loops are not claimed. Likewise,
the accepted block is exactly `BEGIN SEQUENTIAL EXECUTION` with one assignment
to the procedure output; parallel, local-declaration, other-target and
multi-statement blocks remain named refusals.

The case also added an exact AMDP output-boundary conversion from INTEGER to
packed decimal. It lowers as an explicit DECIMAL cast, never through floating
point. DuckDB executes the original source for zero, NULL and populated
limits; native SQLScript and portable ordinary HANA SQL return equal typed
rows for the same inputs. The full offline SQLScript/AMDP run is 411 passing
with 17 live cases pending, and the focused live HANA suite is 15 passing.

### 2026-09-22 — P2a real ABAP call reaches portable DuckDB

`amdp-gen` now compiles each supported method while the extractor still owns
its local ABAP type map and writes the typed IR into `procedures.json` beside
the native HANA description. Unsupported methods keep a named portable
refusal. Consequently the application runtime loads neither the lexer nor the
parser when an AMDP is called.

On DuckDB, the existing generated `CALL FUNCTION ... DESTINATION 'AMDP'`
uses the system's already-open `DEFAULT` database client. Scalar and typed
table inputs cross the ordinary runtime signature; table rows become a
bounded typed relation plan, never procedure-local mutable JavaScript state.
The boundary refuses more than 2,000 rows or 10,000 cells before constructing
an expanded UNION. Empty input retains the declared schema.

The transpiled `ZCL_OSD_AMDP_TEST` now proves the path twice: the original
`SQUARES` call, and Open SQL rows passed to an unchanged aggregating SQLScript
method. Full ABAP Unit passes on DuckDB with no HANA fallback. Both AMDP tests
also completed natively on HANA. A later full-HANA failure exposed that the
adapter treated an `NCLOB` Buffer like binary `BLOB`; metadata-aware LOB
conversion now keeps character LOBs as UTF-8 and binary LOBs as ABAP hex.
The full HANA ABAP Unit run is green.

### 2026-09-22 — P2b first nested AMDP remains relational

The SQLScript frontend now retains an internal `CALL` as a procedural node.
The deliberately narrow first contract is one typed table input and one typed
table output; scalar, `INOUT`, multiple-output and dynamic calls remain named
refusals. At runtime the child receives the parent's already-frozen relation
and returns a relation plan. DuckDB therefore executes one final statement for
the whole parent/child composition: no intermediate JavaScript row array and
no second connection appear at the call boundary. Captured parent scalars are
covered explicitly, and a configurable call-depth limit stops recursion before
the database is touched.

`ZCL_OSD_AMDP_DEMO=>TOTAL_AMOUNT_NESTED` is unchanged native SQLScript using
`CALL "ZCL_OSD_AMDP_DEMO=>TOTAL_AMOUNT"(...)`. The generated destination
resolves the child from the same precompiled manifest. Native HANA deployment
walks the same dependency first, even when the parent hash itself is unchanged.
The ordinary ABAP Unit call is green on DuckDB and on HANA, and the complete
isolated HANA ABAP Unit run now finishes successfully.

### 2026-09-22 — P1c first corpus method on HANA and DuckDB

The unchanged synthetic `mix_rows` method moves the ledger to `1 executable /
9 named refusals / 0 crashes`. It executes typed table inputs, scoped inner
and left joins, a derived table, a correlated `EXISTS`, `DISTINCT`, ordering
and a scalar INTEGER `LIMIT`.

Source aliases are now first-class IR facts. Query scopes type qualified
columns from the correct input, retain outer aliases for correlation, and
refuse unknown or ambiguous columns rather than assigning STRING by default.
Lowering keeps joins, filtering and projection in one query block when a
source alias must remain visible.

Fixtures are materialised as physically typed engine tables. DuckDB covers
empty, zero, bounded and full results plus an independent correlation case.
On live HANA, native SQLScript and portable plain HANA SQL return the same
values. The oracle also established two boundary rules:

- ABAP `D/DATS` and `T/TIMS` procedure fields use their character storage
  forms (`NVARCHAR(8)` and `NVARCHAR(6)`), not SQL types named DATS/TIMS;
- HANA's LIMIT grammar accepts a typed bound `?` and rejects
  `CAST(? AS INTEGER)` in that position, while ordinary numeric expression
  placeholders retain their explicit casts.

### 2026-09-22 — P1d grouped windows and ranking

The tracked synthetic `rank_rows` body executes directly, without runtime or
test-harness rewriting, and moves the ledger to `2 executable / 8 named
refusals / 0 crashes`. A grouped SELECT now permits a ranking-window output
only when every column read by its partition and ordering is a GROUP BY key;
an ungrouped dependency is refused before reaching a database. Ranking calls
carry their measured natural BIGINT type rather than the old STRING default;
the procedure boundary converts ranking columns to the declared ABAP `I`, as
native AMDP does.

The method exercises an `IN` subquery, GROUP BY, HAVING, `ROW_NUMBER`, `RANK`,
`DENSE_RANK`, window partitions and ordering, a table-variable re-read and
`UNION DISTINCT`. A physical tie fixture proves the gap between `RANK` and
`DENSE_RANK` on DuckDB and in the live HANA differential. `ROW_NUMBER` uses a
complete tie breaker over the grouped row, while `RANK` and `DENSE_RANK`
deliberately order only by amount. This matters because the table-variable
plan is inlined into both UNION branches: a non-deterministic row number could
otherwise turn two logically identical branches into additional distinct rows.

### 2026-09-22 — P1e selected procedural branches

The tracked `transform` body now compiles to host-side `IF / ELSEIF / ELSE`.
SQL three-valued conditions treat NULL as not true, only the selected branch
is rebound into the final relational plan, and an unsupported function in an
unselected branch cannot poison a portable branch. Selecting it still yields
a named `UNSUPPORTED_SQLSCRIPT` refusal before database execution.

The zero/NULL branch lowers text with `LOWER`. The 1..9 branch carries the
exact measured `REPLACE_REGEXPR('x' IN column WITH '' OCCURRENCE ALL)` shape as
one semantic IR call and renders DuckDB's explicit global flag, preserving
each dialect's textual bind order. Other patterns, replacements and expression
subjects are refused: HANA regex and DuckDB regex are not claimed to be
generally equivalent. Decimal casts and the packed-number output boundary are
limited to packed-to-packed precision changes at unchanged scale.
DuckDB value tests cover both branches and NULL/text/filter edges; native and
portable HANA agree for switches 0, 1 and 9. The session-context ELSE branch
remains outside the capability set, so the ledger is `2 fully executable / 1
partially executable / 7 named refusals / 0 crashes`.

Each arm is bound from the same pre-`IF` type environment. Only table/scalar
facts identical on every reachable path survive after `END IF`; a consumer of
branch-dependent state is refused rather than typed from whichever arm the
compiler happened to visit last. At one condition level, mixed unparenthesised
`AND`/`OR` is likewise refused until precedence is represented explicitly.

### 2026-09-22 — P1f scalar RETURNING and OPTIONAL

The clean-room `scalar_value` and `optional_value` database functions now use
the same typed host evaluator as procedural conditions. A scalar `RETURNING`
signature carries its output type in procedure IR, its selected execution path
must actually assign the value, and INTEGER overflow remains a named host-side
failure. The measured scalar `COALESCE` subset is exactly two arguments with
identical types.

`OPTIONAL` is preserved by extraction rather than inferred later. Omitting an
ABAP `TYPE i` actual supplies ABAP's type-initial zero before SQLScript sees the
parameter; an explicit SQL NULL is a distinct direct-runtime case and reaches
`COALESCE`. Scalar-only bodies require no database client and report zero
database statements. A disposable HANA procedure wrapper maps ABAP
`RETURNING` to an equivalent scalar OUT and retrieves it through an anonymous
block, allowing the original assignment body to remain unchanged for the
differential oracle. This shortcut is deliberately scalar-only: compiler and
runtime both refuse table inputs or relational statements rather than report
an unexecuted query as a zero-statement success. Scalar output and OPTIONAL
input types are limited to ABAP `I`; table OPTIONAL and INOUT remain named
unsupported boundaries. The corpus ledger is now `4 fully executable / 1
partially executable / 5 named refusals / 0 crashes`.

### 2026-09-22 — P1g typed set difference

`difference_cells` now carries `EXCEPT` as its own two-input relational node;
it can no longer be mistaken for `UNION`. Both branches must have identical
column order and measured types. Mixed/multi-branch set expressions,
`INTERSECT`, and unmeasured backends remain named refusals. DuckDB fixtures
prove DISTINCT duplicate removal and NULL row equality, while native HANA
SQLScript and portable ordinary HANA SQL agree on the same edge rows. The
ledger is `5 fully executable / 1 partially executable / 4 named refusals / 0
crashes`.
